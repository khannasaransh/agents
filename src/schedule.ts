import { execFileSync, spawnSync } from 'node:child_process'
import { appendFileSync, existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join, win32 } from 'node:path'
import { pathToFileURL } from 'node:url'
import { findOnPath } from './command.ts'
import { writeText } from './files.ts'
import { acquireLock, RunActiveError } from './lock.ts'
import { agentsRoot, dataDir } from './paths.ts'
import type { RunRecord } from './run.ts'

/** In launchd's order: its Weekday 0 is Sunday. */
export const weekdays = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'] as const
export type Weekday = (typeof weekdays)[number]

/** The weekday a Run started on, by its id, which is its local start date and time. */
export function runWeekday(runId: string): Weekday {
  const [year, month, day] = runId.split('-').map(Number)
  return weekdays[new Date(year, month - 1, day).getDay()]
}

/** The month a Run's monthly review is of, YYYY-MM: the month before, when the Run started on the first Saturday of a month; else null. */
export function monthReviewed(runId: string): string | null {
  const [year, month, day] = runId.split('-').map(Number)
  if (runWeekday(runId) !== 'saturday' || day > 7) return null
  const before = new Date(year, month - 2, 1)
  return `${before.getFullYear()}-${String(before.getMonth() + 1).padStart(2, '0')}`
}

/** The machines Schedules run on: the Mac, which installs them into launchd, and the Windows machine, into Task Scheduler. */
const machines = { mac: 'darwin', windows: 'win32' } as const
export type Machine = keyof typeof machines

/** A Schedule definition: when a Pipeline runs on its own, and on which machine. */
export interface Schedule {
  pipeline: string
  machine: Machine
  days: Weekday[]
  /** On that machine's local clock, as HH:MM. */
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
      const name = file.slice(0, -'.ts'.length)
      if (!Object.hasOwn(machines, schedule.machine)) throw new Error(`Schedule ${name}: machine ${schedule.machine} is not one of ${Object.keys(machines).join(', ')}`)
      return { name, ...schedule }
    }),
  )
}

/** The Schedules that run on the machine of `platform` (process.platform's), the only ones it installs. */
export function machineSchedules(schedules: NamedSchedule[], platform: NodeJS.Platform): NamedSchedule[] {
  const machine = (Object.keys(machines) as Machine[]).find((name) => machines[name] === platform)
  if (!machine) throw new Error(`Schedules install on the Mac (launchd) and on Windows (Task Scheduler), not on ${platform}`)
  return schedules.filter((schedule) => schedule.machine === machine)
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

/** What a Task Scheduler entry needs from the machine it is installed on. */
export interface TaskSchedulerInstall extends LaunchdInstall {
  /** Windows' own folder (SystemRoot), whose tools go on the entry's PATH. */
  systemRoot: string
  /** The day it is installed, as YYYY-MM-DD, from which its trigger starts. */
  today: string
}

/** The Task Scheduler folder the entries go in, one per Schedule, named after it. */
const taskFolder = '\\agents\\'
/** In Task Scheduler's spelling. */
const taskDays: Record<Weekday, string> = { sunday: 'Sunday', monday: 'Monday', tuesday: 'Tuesday', wednesday: 'Wednesday', thursday: 'Thursday', friday: 'Friday', saturday: 'Saturday' }

/**
 * The Task Scheduler entry for a Schedule: its name, the task definition (Task Scheduler's XML),
 * and the arguments and PATH it runs with. Task Scheduler can't give a task environment variables,
 * so the entry hands them to the agents command, which sets them before the Run starts.
 */
export function taskSchedulerEntry(schedule: NamedSchedule, install: TaskSchedulerInstall): { name: string; xml: string; args: string[]; path: string } {
  const name = `${taskFolder}${schedule.name}`
  const [hour, minute] = clockTime(schedule)
  const system = win32.join(install.systemRoot, 'System32')
  // The Worker CLIs are node scripts, so node's own folder goes first; Windows' own tools go after the shell's PATH.
  const folders = [win32.dirname(install.node), ...install.shellPath.split(';'), system, install.systemRoot, win32.join(system, 'Wbem'), win32.join(system, 'WindowsPowerShell', 'v1.0')]
  // Windows' names are case-insensitive, so a folder is listed once however it is spelled.
  const path = folders.filter((folder, i) => folder && folders.findIndex((other) => other.toLowerCase() === folder.toLowerCase()) === i).join(';')
  const args = [join(agentsRoot, 'src', 'cli.ts'), 'run', schedule.pipeline, '--scheduled', '--env', `PATH=${path}`, '--env', `AGENTS_DATA_DIR=${install.dataDir}`]
  const days = schedule.days.toSorted((a, b) => weekdays.indexOf(a) - weekdays.indexOf(b)).map((day) => `<${taskDays[day]} />`)
  const definition = `<?xml version="1.0" encoding="UTF-16"?>
<Task version="1.2" xmlns="http://schemas.microsoft.com/windows/2004/02/mit/task">
  <RegistrationInfo>
    <Description>${xml(`The ${schedule.pipeline} Pipeline's Schedule (schedules/${schedule.name}.ts in the agents repo). Written by agents schedule install: install again rather than editing it here.`)}</Description>
    <URI>${xml(name)}</URI>
  </RegistrationInfo>
  <Triggers>
    <CalendarTrigger>
      <StartBoundary>${install.today}T${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}:00</StartBoundary>
      <Enabled>true</Enabled>
      <ScheduleByWeek>
        <DaysOfWeek>${days.join('')}</DaysOfWeek>
        <WeeksInterval>1</WeeksInterval>
      </ScheduleByWeek>
    </CalendarTrigger>
  </Triggers>
  <Principals>
    <Principal id="Author">
      <LogonType>InteractiveToken</LogonType>
      <RunLevel>LeastPrivilege</RunLevel>
    </Principal>
  </Principals>
  <Settings>
    <MultipleInstancesPolicy>Parallel</MultipleInstancesPolicy>
    <DisallowStartIfOnBatteries>false</DisallowStartIfOnBatteries>
    <StopIfGoingOnBatteries>false</StopIfGoingOnBatteries>
    <StartWhenAvailable>true</StartWhenAvailable>
    <WakeToRun>true</WakeToRun>
    <ExecutionTimeLimit>PT0S</ExecutionTimeLimit>
    <Enabled>true</Enabled>
  </Settings>
  <Actions Context="Author">
    <Exec>
      <Command>${xml(install.node)}</Command>
      <Arguments>${xml(args.map(windowsArg).join(' '))}</Arguments>
      <WorkingDirectory>${xml(agentsRoot.replace(/[\\/]$/, ''))}</WorkingDirectory>
    </Exec>
  </Actions>
</Task>
`
  return { name, xml: definition, args, path }
}

/** An argument as a Windows command line quotes it, so the program it starts reads it back unchanged. */
function windowsArg(arg: string): string {
  if (arg && !/[\s"]/.test(arg)) return arg
  // Backslashes are literal except before a quote, where each must be doubled.
  return `"${arg.replace(/(\\*)"/g, '$1$1\\"').replace(/(\\+)$/, '$1$1')}"`
}

/** The commands a scheduled Run needs to find on its PATH: git and the Worker CLIs. */
const neededCommands = ['git', 'claude', 'codex', 'agy']
/** On Windows, ash_new's uv as well, for the stocks Pipeline. */
const neededOnWindows = [...neededCommands, 'uv']

/**
 * Installs this machine's Schedules: into launchd on the Mac, into Task Scheduler on Windows. Each
 * replaces the entry an earlier install wrote for it, and the entries of Schedules no longer defined
 * for this machine are removed. Returns what it installed, the needed commands missing from the
 * entries' PATH, and what else stops them running as they should.
 */
export async function installSchedules(): Promise<{ installed: string[]; missing: string[]; warnings: string[] }> {
  const schedules = machineSchedules(await loadSchedules(), process.platform)
  return process.platform === 'win32' ? installTasks(schedules) : installLaunchd(schedules)
}

/**
 * Writes the launchd entry of each Schedule into ~/Library/LaunchAgents and loads it, unloading the
 * one an earlier install loaded. Unloading an entry stops a Run it started, so it refuses while a Run
 * is active.
 */
function installLaunchd(schedules: NamedSchedule[]): { installed: string[]; missing: string[]; warnings: string[] } {
  const release = acquireLock()
  try {
    const folder = join(homedir(), 'Library', 'LaunchAgents')
    const domain = `gui/${process.getuid!()}`
    // launchd writes an entry's output there, but doesn't create the folder.
    mkdirSync(join(dataDir(), 'launchd'), { recursive: true })
    mkdirSync(folder, { recursive: true })

    const install = { node: process.execPath, shellPath: process.env.PATH ?? '', dataDir: dataDir() }
    const entries = schedules.map((schedule) => launchdEntry(schedule, install))
    const labels = new Set(entries.map((entry) => entry.label))
    for (const file of readdirSync(folder)) {
      const label = file.replace(/\.plist$/, '')
      if (!file.startsWith(labelPrefix) || !file.endsWith('.plist') || labels.has(label)) continue
      unload(domain, label)
      rmSync(join(folder, file))
    }
    const installed = entries.map(({ label, plist }) => {
      const file = join(folder, `${label}.plist`)
      unload(domain, label)
      writeText(file, plist)
      launchctl('bootstrap', domain, file)
      return file
    })
    // Every entry runs with the same PATH.
    const path = entries[0]?.path.split(':') ?? []
    const missing = neededCommands.filter((command) => !path.some((dir) => existsSync(join(dir, command))))
    return { installed, missing, warnings: [] }
  } finally {
    release()
  }
}

/**
 * Registers the Task Scheduler entry of each Schedule in the \\agents\\ folder, replacing the one an
 * earlier install registered, and keeps each definition in the data area's task-scheduler folder.
 * Replacing a task leaves a Run it started running, so unlike launchd it doesn't need the Run lock.
 */
function installTasks(schedules: NamedSchedule[]): { installed: string[]; missing: string[]; warnings: string[] } {
  const folder = join(dataDir(), 'task-scheduler')
  mkdirSync(folder, { recursive: true })
  const install = { node: process.execPath, shellPath: process.env.PATH ?? '', dataDir: dataDir(), systemRoot: process.env.SystemRoot ?? 'C:\\Windows', today: localDay(new Date()) }
  const entries = schedules.map((schedule) => ({ schedule, ...taskSchedulerEntry(schedule, install) }))
  const names = new Set(entries.map((entry) => entry.name.toLowerCase()))
  for (const task of registeredTasks()) if (!names.has(task.toLowerCase())) schtasks('/Delete', '/TN', task, '/F')
  const installed = entries.map(({ schedule, name, xml }) => {
    const file = join(folder, `${schedule.name}.xml`)
    // Task Scheduler reads a definition as the UTF-16 its declaration names.
    writeFileSync(file, Buffer.from(`\ufeff${xml}`, 'utf16le'))
    schtasks('/Create', '/TN', name, '/XML', file, '/F')
    return `${name} (${file})`
  })
  const path = entries[0]?.path
  const missing = path === undefined ? [] : neededOnWindows.filter((command) => !findOnPath(command, { env: { PATH: path, PATHEXT: process.env.PATHEXT } }))
  const powercfg = spawnSync('powercfg', ['/query', 'SCHEME_CURRENT', 'SUB_SLEEP', 'RTCWAKE'], { encoding: 'utf8', windowsHide: true })
  const warnings =
    entries.length && allowsWakeTimers(powercfg.stdout ?? '') === false
      ? [
          "This machine's power plan doesn't allow wake timers, so a Schedule can't wake it from sleep. Turn on Allow wake timers under Sleep in the power plan's advanced settings, or run `powercfg /setacvalueindex SCHEME_CURRENT SUB_SLEEP RTCWAKE 1` and then `powercfg /setactive SCHEME_CURRENT`.",
        ]
      : []
  return { installed, missing, warnings }
}

/**
 * Whether the power plan lets a task wake the machine on mains power, from what `powercfg /query
 * SCHEME_CURRENT SUB_SLEEP RTCWAKE` printed: only when Allow wake timers is Enable (1), since
 * Important wake timers only (2) leaves out Task Scheduler's. Null when the output doesn't say.
 */
export function allowsWakeTimers(powercfg: string): boolean | null {
  const index = /Current AC Power Setting Index:\s*0x([0-9a-f]+)/i.exec(powercfg)?.[1]
  return index === undefined ? null : parseInt(index, 16) === 1
}

/** The tasks registered in the \\agents\\ folder, by full name. */
function registeredTasks(): string[] {
  const listed = spawnSync('schtasks', ['/Query', '/FO', 'CSV', '/NH'], { encoding: 'utf8', windowsHide: true })
  if (listed.status !== 0) throw new Error(`schtasks /Query failed: ${(listed.stderr || listed.stdout).trim()}`)
  const tasks = listed.stdout.split(/\r?\n/).map((line) => /^"([^"]*)"/.exec(line)?.[1] ?? '')
  return [...new Set(tasks.filter((task) => task.toLowerCase().startsWith(taskFolder.toLowerCase())))]
}

function schtasks(...args: string[]): void {
  const ran = spawnSync('schtasks', args, { encoding: 'utf8', windowsHide: true })
  if (ran.status !== 0) throw new Error(`schtasks ${args.slice(0, 3).join(' ')} failed: ${(ran.stderr || ran.stdout).trim()}`)
}

/** A day on this machine's clock, as YYYY-MM-DD. */
function localDay(d: Date): string {
  return [d.getFullYear(), d.getMonth() + 1, d.getDate()].map((n) => String(n).padStart(2, '0')).join('-')
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
