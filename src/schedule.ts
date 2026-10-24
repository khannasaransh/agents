import { execFileSync, spawnSync } from 'node:child_process'
import { appendFileSync, existsSync, mkdirSync, readdirSync, rmSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { writeText } from './files.ts'
import { acquireLock, RunActiveError } from './lock.ts'
import { agentsRoot, dataDir } from './paths.ts'
import type { RunRecord } from './run.ts'

/** In launchd's order: its Weekday 0 is Sunday. */
const weekdays = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'] as const
export type Weekday = (typeof weekdays)[number]

/** A Schedule definition: when a Pipeline runs on its own. */
export interface Schedule {
  pipeline: string
  days: Weekday[]
  /** On this machine's local clock, as HH:MM. */
  time: string
}

/** A Schedule, named after the file that defines it. */
export interface NamedSchedule extends Schedule {
  name: string
}

/** Every Schedule definition, from the schedules folder, in name order. */
export async function loadSchedules(): Promise<NamedSchedule[]> {
  const folder = join(agentsRoot, 'schedules')
  const files = readdirSync(folder)
    .filter((file) => file.endsWith('.ts'))
    .sort((a, b) => a.localeCompare(b))
  return Promise.all(
    files.map(async (file) => {
      const schedule: Schedule = (await import(pathToFileURL(join(folder, file)).href)).default
      return { name: file.slice(0, -'.ts'.length), ...schedule }
    }),
  )
}

/** What a launchd entry needs from the machine it is installed on. */
export interface LaunchdInstall {
  /** The node executable that runs the agents command. */
  node: string
  /** The PATH of the shell installing it, which has loaded the shell profile that launchd doesn't. */
  shellPath: string
  /** The data area the entry's Runs use, where launchd also writes the entry's own output. */
  dataDir: string
}

const labelPrefix = 'local.agents.'

/** The launchd entry for a Schedule: its label, the plist that defines it, and the PATH it runs with. */
export function launchdEntry(schedule: NamedSchedule, install: LaunchdInstall): { label: string; plist: string; path: string } {
  const label = `${labelPrefix}${schedule.name}`
  const [hour, minute] = clockTime(schedule)
  const args = [install.node, join(agentsRoot, 'src', 'cli.ts'), 'run', schedule.pipeline, '--scheduled']
  // The Worker CLIs are node scripts, so node's own folder goes first; git and the system tools live in the system folders.
  const path = [...new Set([dirname(install.node), ...install.shellPath.split(':'), '/usr/bin', '/bin', '/usr/sbin', '/sbin'].filter(Boolean))].join(':')
  const log = join(install.dataDir, 'launchd', `${schedule.name}.log`)
  const times = schedule.days.map(
    (day) => `      <dict>
        <key>Weekday</key>
        <integer>${weekdays.indexOf(day)}</integer>
        <key>Hour</key>
        <integer>${hour}</integer>
        <key>Minute</key>
        <integer>${minute}</integer>
      </dict>`,
  )
  const plist = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
  <dict>
    <key>Label</key>
    <string>${xml(label)}</string>
    <key>ProgramArguments</key>
    <array>
${args.map((arg) => `      <string>${xml(arg)}</string>`).join('\n')}
    </array>
    <key>WorkingDirectory</key>
    <string>${xml(agentsRoot)}</string>
    <key>EnvironmentVariables</key>
    <dict>
      <key>PATH</key>
      <string>${xml(path)}</string>
      <key>AGENTS_DATA_DIR</key>
      <string>${xml(install.dataDir)}</string>
    </dict>
    <key>StandardOutPath</key>
    <string>${xml(log)}</string>
    <key>StandardErrorPath</key>
    <string>${xml(log)}</string>
    <key>StartCalendarInterval</key>
    <array>
${times.join('\n')}
    </array>
  </dict>
</plist>
`
  return { label, plist, path }
}

/** The commands a scheduled Run needs to find on its PATH: git and the Worker CLIs. */
const neededCommands = ['git', 'claude', 'codex', 'agy']

/**
 * Writes the launchd entry of every Schedule into ~/Library/LaunchAgents and loads it, replacing
 * the entry an earlier install wrote for it, and removes the entries of Schedules no longer defined.
 * Unloading an entry stops a Run it started, so it refuses while a Run is active.
 * Returns the files written, and the needed commands missing from the entries' PATH.
 */
export async function installSchedules(): Promise<{ files: string[]; missing: string[] }> {
  if (process.platform !== 'darwin') throw new Error('Schedules install into launchd, so only on the Mac for now')
  const release = acquireLock()
  try {
    const folder = join(homedir(), 'Library', 'LaunchAgents')
    const domain = `gui/${process.getuid!()}`
    // launchd writes an entry's output there, but doesn't create the folder.
    mkdirSync(join(dataDir(), 'launchd'), { recursive: true })
    mkdirSync(folder, { recursive: true })

    const install = { node: process.execPath, shellPath: process.env.PATH ?? '', dataDir: dataDir() }
    const entries = (await loadSchedules()).map((schedule) => launchdEntry(schedule, install))
    const labels = new Set(entries.map((entry) => entry.label))
    for (const file of readdirSync(folder)) {
      const label = file.replace(/\.plist$/, '')
      if (!file.startsWith(labelPrefix) || !file.endsWith('.plist') || labels.has(label)) continue
      unload(domain, label)
      rmSync(join(folder, file))
    }
    const files = entries.map(({ label, plist }) => {
      const file = join(folder, `${label}.plist`)
      unload(domain, label)
      writeText(file, plist)
      launchctl('bootstrap', domain, file)
      return file
    })
    // Every entry runs with the same PATH.
    const path = entries[0]?.path.split(':') ?? []
    const missing = neededCommands.filter((command) => !path.some((dir) => existsSync(join(dir, command))))
    return { files, missing }
  } finally {
    release()
  }
}

/**
 * Unloads an entry if launchd has it loaded, waiting until launchd has let go of it, since loading
 * its replacement before then fails.
 */
function unload(domain: string, label: string): void {
  const loaded = () => spawnSync('launchctl', ['print', `${domain}/${label}`], { stdio: 'ignore' }).status === 0
  if (!loaded()) return
  launchctl('bootout', `${domain}/${label}`)
  for (const deadline = Date.now() + 10_000; loaded(); ) {
    if (Date.now() > deadline) throw new Error(`launchd still has ${label} loaded 10s after unloading it`)
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 100)
  }
}

function launchctl(...args: string[]): void {
  try {
    execFileSync('launchctl', args, { stdio: ['ignore', 'pipe', 'pipe'] })
  } catch (error) {
    const stderr = String((error as { stderr?: Buffer }).stderr ?? '').trim()
    throw new Error(`launchctl ${args.join(' ')} failed${stderr ? `: ${stderr}` : ''}`)
  }
}

/** A Schedule's time as hour and minute, refusing anything that isn't a time of day. */
function clockTime(schedule: NamedSchedule): [number, number] {
  const match = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(schedule.time)
  if (!match) throw new Error(`Schedule ${schedule.name}: time ${schedule.time} is not HH:MM`)
  return [Number(match[1]), Number(match[2])]
}

function xml(text: string): string {
  return text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
}

/**
 * Records what became of a scheduled start of a Pipeline in the data area's scheduled-starts.log,
 * since no one is watching when it happens: the Run it started and how that ended, or why it didn't
 * start, such as the lock refusing it while another Run was active.
 */
export function recordScheduledStart(pipeline: string, outcome: { run: RunRecord } | { error: unknown }): void {
  let line: string
  if ('run' in outcome) line = `started Run ${outcome.run.id}, which ended ${outcome.run.status}`
  else {
    const message = outcome.error instanceof Error ? outcome.error.message : String(outcome.error)
    line = `${outcome.error instanceof RunActiveError ? 'refused' : 'failed to start'}: ${message}`
  }
  mkdirSync(dataDir(), { recursive: true })
  appendFileSync(join(dataDir(), 'scheduled-starts.log'), `${new Date().toISOString()} ${pipeline}: ${line}
`)
}
