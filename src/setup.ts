// Machine setup: makes a new Mac or Windows machine match this one. It checks the commands the
// Pipeline needs, clones the Repos into Team folders, installs the Workers' config this repo holds,
// and lists what it can't do. It starts git and the commands directly, never through bash, so it
// runs the same on both. Capture is its other half: it copies a machine's Workers' config into the repo.
import { spawnSync, type SpawnSyncOptionsWithStringEncoding } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'
import { findOnPath } from './command.ts'
import { antigravityHomeDir, agentsRoot, workerConfigDir } from './paths.ts'
import { loadRepos, teams, type Repo, type Team } from './repos.ts'
import { captureWorkerConfig, installWorkerConfig, workerConfigSecrets, type Secret } from './worker-config.ts'

/** Where setup makes the Team folders unless told otherwise: the folder holding this repo, as on this Mac. */
export const defaultRoot = resolve(agentsRoot, '..')

/** What setup found or did for one thing, as the line it prints, and whether that thing is done. */
interface Outcome {
  ok: boolean
  line: string
}

/**
 * Sets up the machine, printing what it does as it goes: checks the commands the Pipeline needs,
 * clones each Repo of the selected Teams (all of them when none is named) into
 * `<root>/<team>/<name>` on its production branch, installs the Workers' config into the home
 * folder, and prints the manual checklist. A Repo whose folder exists is left as it is. Returns
 * whether everything setup can do is done: no command is missing, no clone failed and every file
 * of the Workers' config is in place.
 */
export async function setupMachine({ root, teams: selected }: { root: string; teams: string[] }): Promise<boolean> {
  const unknown = selected.filter((team) => !(teams as readonly string[]).includes(team))
  if (unknown.length) throw new Error(`Unknown Team: ${unknown.join(', ')}. The Teams are ${teams.join(', ')}`)
  const repos = (await loadRepos()).filter((repo) => !selected.length || selected.includes(repo.team))

  console.log('Commands the Pipeline needs:')
  const checks = requiredCommands().map(checkCommand)
  for (const { line } of checks) console.log(`  ${line}`)

  console.log(`\nRepos, in Team folders in ${root}:`)
  const gitFound = checks[0].ok
  const clones = repos.map((repo) => {
    const folder = join(root, repo.team, repo.name)
    const { ok, line } = gitFound ? cloneRepo(repo, folder) : { ok: false, line: 'not cloned, since git is missing' }
    console.log(`  ${folder}: ${line}`)
    return ok
  })
  if (!repos.length) console.log(`  none in the Repo list${selected.length ? ' for those Teams' : ''}`)

  console.log(`\nThe Workers' config, from ${workerConfigDir()}:`)
  const installed = installWorkerConfig({ home: homedir(), root, platform: process.platform })
  for (const { file, line } of installed) console.log(`  ${file}: ${line}`)
  if (!installed.length) console.log('  none in this repo')

  console.log('\nStill to do by hand:')
  for (const step of manualSteps(repos, workerConfigSecrets())) console.log(`  - ${step}`)
  return [...checks, ...installed].every((outcome) => outcome.ok) && clones.every(Boolean)
}

/** Copies this machine's Workers' config into the repo, printing what it took and the secrets it left out. */
export function captureConfig({ root }: { root: string }): void {
  const { files, secrets } = captureWorkerConfig({ home: homedir(), root })
  console.log(`The Workers' config, captured into ${workerConfigDir()}:`)
  for (const file of files) console.log(`  ~/${file}`)
  if (!files.length) console.log('  none found in this home folder')
  if (secrets.length) console.log(`\nSecrets left out, which setup lists to set by hand: ${secrets.map(describeSecret).join('; ')}`)
  console.log('\nCheck the changes with git diff before committing them.')
}

function describeSecret({ file, setting }: Secret): string {
  return `${setting} in ~/${file}`
}

/** Clones a Repo onto its production branch, unless its folder exists. */
function cloneRepo(repo: Repo, folder: string): Outcome {
  if (existsSync(folder)) {
    return { ok: true, line: `already there, left as it is${existsSync(join(folder, '.git')) ? '' : ', though it is not a git clone'}` }
  }
  // Git may ask for credentials on a new machine, so it has the terminal, and shows its progress
  // and errors there. A failed clone removes the folder it started.
  const { status, error } = spawnSync('git', ['clone', '--branch', repo.branch, '--', repo.remote, folder], { stdio: ['inherit', 'ignore', 'inherit'], windowsHide: true })
  if (error) return { ok: false, line: `failed to clone: ${error.message}` }
  if (status !== 0) return { ok: false, line: `failed to clone: git exited with ${status}, as it says above` }
  return { ok: true, line: `cloned on ${repo.branch}` }
}

/** A command the Pipeline needs, and the oldest version of it setup accepts without flagging it. */
interface RequiredCommand {
  command: string
  minimum?: { version: string; why: string }
}

/** Git first, since cloning needs it. */
function requiredCommands(): RequiredCommand[] {
  const engines: string = JSON.parse(readFileSync(join(agentsRoot, 'package.json'), 'utf8')).engines.node
  return [
    { command: 'git' },
    { command: 'node', minimum: { version: parseVersion(engines) ?? '0.0.0', why: 'which this repo needs' } },
    { command: 'claude' },
    // The versions current when the PRD was written, when this Mac had older ones.
    { command: 'codex', minimum: { version: '0.163.0', why: 'update it' } },
    { command: 'agy', minimum: { version: '1.4.5', why: 'update it' } },
    { command: 'agent' },
  ]
}

/** A command's version, flagged when it's older than the minimum, or that it's missing. Only a missing command isn't ok. */
function checkCommand({ command, minimum }: RequiredCommand): Outcome {
  const file = findOnPath(command)
  if (!file) return { ok: false, line: `${command}: not found on PATH` }
  const { stdout, stderr, error } = runVersion(file)
  const version = parseVersion(`${stdout}\n${stderr}`)
  if (!version) return { ok: true, line: `${command}: found at ${file}, but ${error ? `it didn't start: ${error.message}` : '--version printed no version'}` }
  if (minimum && isOlder(version, minimum.version)) return { ok: true, line: `${command} ${version}: older than ${minimum.version}, ${minimum.why}` }
  return { ok: true, line: `${command} ${version}` }
}


/**
 * Runs `<file> --version`. A .cmd or .bat file only runs through cmd.exe, which gets the whole
 * command line quoted, as `cmd /s /c` expects.
 */
function runVersion(file: string) {
  const options: SpawnSyncOptionsWithStringEncoding = { encoding: 'utf8', timeout: 30_000, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true }
  if (process.platform === 'win32' && /\.(cmd|bat)$/i.test(file)) {
    return spawnSync(process.env.ComSpec ?? 'cmd.exe', ['/d', '/s', '/c', `""${file}" --version"`], { ...options, windowsVerbatimArguments: true })
  }
  return spawnSync(file, ['--version'], options)
}

/** The first version number in some text, as major.minor.patch. */
function parseVersion(text: string): string | null {
  const match = /(\d+)(?:\.(\d+))?(?:\.(\d+))?/.exec(text)
  return match ? [match[1], match[2] ?? '0', match[3] ?? '0'].join('.') : null
}

function isOlder(version: string, than: string): boolean {
  const [a, b] = [version, than].map((v) => v.split('.').map(Number))
  for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i] < b[i]
  return false
}

/** The SDKs and IDEs each Team's Repos need, which setup doesn't install. */
const teamSdks: Partial<Record<Team, string>> = {
  flutter: 'flutter: the Flutter SDK, cloned by hand since it is not a Repo, with Android Studio, and Xcode on a Mac',
  android: 'android: Android Studio, with the Android SDK and a JDK',
  ios: 'ios: Xcode, on a Mac',
  backend: "backend: Go for the Go services, and whatever each other service's README names",
  data: "data: whatever each Repo's README names",
  frontend: "frontend: each Repo's packages, installed from its own folder",
}

/** What setup can't do for the given Repos, in the order to do it. */
function manualSteps(repos: Repo[], secrets: Secret[]): string[] {
  const selected = teams.filter((team) => repos.some((repo) => repo.team === team) && teamSdks[team])
  const ssh = repos.filter((repo) => /^(git@|ssh:\/\/)/.test(repo.remote)).map((repo) => repo.name)
  return [
    ...(selected.length ? [`SDKs and IDEs, by Team: ${selected.map((team) => teamSdks[team]).join('; ')}.`] : []),
    `Git access: sign in to GitHub for the HTTPS remotes${ssh.length ? `, and add an SSH key for the SSH ones (${ssh.join(', ')})` : ''}, then run setup again for any Repo that failed to clone.`,
    ...(secrets.length ? [`Secrets the Workers' config needs, which this repo doesn't hold: set ${secrets.map(describeSecret).join('; ')}.`] : []),
    `Secrets and env files: fill in ${join(agentsRoot, '.env')} from .env.example, and copy each Repo's own env files and secrets, which git doesn't hold, from the old machine.`,
    "Folders that aren't Repos, which setup doesn't clone: personal repos, repos without a remote, the Flutter SDK clone, autopay-android, and your checkout of the org wiki (WIKI_FOLDER in .env).",
    `Workers: log in to claude, codex, agy and agent, then log in once to the Pipeline's own Antigravity home by running agy with HOME set to ${antigravityHomeDir()}.`,
  ]
}
