import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { delimiter, dirname, join } from 'node:path'
import { test } from 'node:test'
import { cli, git, gitEnv, type CliResult, type RepoEntry } from './helpers.ts'

// The workspace in helpers.ts can't run on Windows yet (issue 16), and setup must, so its tests
// make their own machine.

const standIns = ['node', 'claude', 'codex', 'agy']

/**
 * This machine's PATH without the folders holding a command the tests stand in for, so git is the
 * only real command a setup finds. Git keeps its own folders, since on Windows they need each other.
 */
const realPath = (process.env.PATH ?? '')
  .split(delimiter)
  .filter((dir) => dir && !standIns.some((command) => ['', '.exe', '.cmd', '.bat'].some((ext) => existsSync(join(dir, command + ext)))))

/** A fresh machine for setup: a home, a folder to set up in, a Repo list, and a PATH holding stand-ins for the tools. */
interface Machine {
  /** The folder setup makes the Team folders in. */
  root: string
  /**
   * Adds a Repo whose local "remote" has a commit on `main` and one on its production branch, with
   * `main` as the remote's default branch, so a clone that ignored the production branch would show.
   */
  addRepo(name: string, team: string, branch?: string): RepoEntry
  /** Adds a Repo whose remote doesn't exist, so its clone fails. */
  addBrokenRepo(name: string, team: string): RepoEntry
  /** Puts a stand-in for a tool on PATH that prints `version` when asked for it, as the real one does, or none when null. */
  setTool(command: string, version: string | null): void
  /** Leaves git off setup's PATH too, as on a machine without it. */
  removeGit(): void
  setup(...args: string[]): Promise<CliResult>
  cleanup(): void
}

function makeMachine(): Machine {
  const base = mkdtempSync(join(tmpdir(), 'agents-setup-'))
  const root = join(base, 'Saransh')
  const binDir = join(base, 'bin')
  const homeDir = join(base, 'home')
  const repoListFile = join(base, 'repos.ts')
  const entries: RepoEntry[] = []
  let path = [binDir, ...realPath]
  for (const folder of [binDir, homeDir]) mkdirSync(folder)
  // Every tool present and current, unless a test says otherwise.
  const tools: Record<(typeof standIns)[number], string | null> = { node: 'v25.2.0', claude: '2.1.310 (Claude Code)', codex: 'codex-cli 0.163.0', agy: '1.4.5' }

  const machine: Machine = {
    root,

    addRepo(name, team, branch = 'main') {
      const remote = join(base, 'remotes', `${name}.git`)
      const upstream = join(base, 'upstream', name)
      mkdirSync(join(base, 'remotes'), { recursive: true })
      git(base, 'init', '-q', '--bare', '-b', 'main', remote)
      git(base, 'init', '-q', '-b', 'main', upstream)
      git(upstream, 'commit', '-q', '--allow-empty', '-m', 'On main')
      if (branch !== 'main') {
        git(upstream, 'checkout', '-q', '-b', branch)
        git(upstream, 'commit', '-q', '--allow-empty', '-m', `On ${branch}`)
      }
      git(upstream, 'push', '-q', remote, ...new Set(['main', branch]))
      const entry = { name, team, remote, folder: `~/Saransh/${team}/${name}`, branch }
      entries.push(entry)
      return entry
    },

    addBrokenRepo(name, team) {
      const entry = { name, team, remote: join(base, 'remotes', `${name}-missing.git`), folder: `~/Saransh/${team}/${name}`, branch: 'main' }
      entries.push(entry)
      return entry
    },

    setTool(command, version) {
      tools[command] = version
    },

    removeGit() {
      path = [binDir]
    },

    setup(...args) {
      writeFileSync(repoListFile, `export default ${JSON.stringify(entries, null, 2)}\n`)
      for (const file of readdirSync(binDir)) rmSync(join(binDir, file))
      for (const [command, version] of Object.entries(tools)) if (version !== null) writeToolStandIn(binDir, command, version)
      // Windows spells it Path, and either spelling would do, so only one is kept.
      const env = Object.fromEntries(Object.entries(gitEnv).filter(([name]) => name.toUpperCase() !== 'PATH'))
      const child = spawn(process.execPath, [cli, 'setup', '--root', root, ...args], {
        env: { ...env, HOME: homeDir, USERPROFILE: homeDir, PATH: path.join(delimiter), AGENTS_REPOS_FILE: repoListFile },
      })
      let stdout = ''
      let stderr = ''
      child.stdout.on('data', (d) => (stdout += d))
      child.stderr.on('data', (d) => (stderr += d))
      return new Promise((resolve) => child.on('close', (status) => resolve({ status, stdout, stderr })))
    },

    cleanup() {
      rmSync(base, { recursive: true, force: true })
    },
  }
  return machine
}

/**
 * Writes a stand-in for a tool that prints `version` and nothing else. On Windows it is a .cmd file,
 * as npm installs the Worker CLIs there.
 */
function writeToolStandIn(binDir: string, command: string, version: string) {
  if (process.platform === 'win32') {
    writeFileSync(join(binDir, `${command}.cmd`), `@echo off\r\necho ${version}\r\n`)
  } else {
    writeFileSync(join(binDir, command), `#!/bin/sh\necho '${version}'\n`)
    chmodSync(join(binDir, command), 0o755)
  }
}

/** The branch a clone has checked out. */
function checkedOut(folder: string): string {
  return git(folder, 'rev-parse', '--abbrev-ref', 'HEAD')
}

/** The line of the tool checks about `command`. */
function toolLine(stdout: string, command: string): string | undefined {
  return stdout.split(/\r?\n/).find((line) => line.trimStart().startsWith(`${command} `) || line.trimStart().startsWith(`${command}:`))
}

/** The stdout line that mentions `text`. */
function lineWith(stdout: string, text: string): string | undefined {
  return stdout.split(/\r?\n/).find((line) => line.includes(text))
}

test("setup clones each Repo into a folder named for its Team, on its production branch, whatever the remote's default branch", async () => {
  const machine = makeMachine()
  try {
    const crux = machine.addRepo('crux_flutter', 'flutter')
    const custom = machine.addRepo('customcard_flutter', 'flutter', 'development')
    const search = machine.addRepo('nis-search-go', 'backend', 'ind-production')

    const result = await machine.setup()

    assert.equal(result.status, 0, result.stderr + result.stdout)
    assert.deepEqual(readdirSync(machine.root).sort(), ['backend', 'flutter'])
    assert.equal(checkedOut(join(machine.root, 'flutter', 'crux_flutter')), 'main')
    assert.equal(checkedOut(join(machine.root, 'flutter', 'customcard_flutter')), 'development')
    assert.equal(checkedOut(join(machine.root, 'backend', 'nis-search-go')), 'ind-production')
    assert.equal(git(join(machine.root, 'backend', 'nis-search-go'), 'remote', 'get-url', 'origin'), search.remote)
    for (const { name, team } of [crux, custom, search]) assert.match(lineWith(result.stdout, join(machine.root, team, name)) ?? '', /cloned/)
  } finally {
    machine.cleanup()
  }
})

test('--team limits setup to the named Teams', async () => {
  const machine = makeMachine()
  try {
    machine.addRepo('crux_flutter', 'flutter')
    machine.addRepo('drama-android', 'android')
    machine.addRepo('nis-search-go', 'backend')
    machine.addRepo('inpix-panel', 'frontend')

    const result = await machine.setup('--team', 'flutter,backend')

    assert.equal(result.status, 0, result.stderr + result.stdout)
    assert.deepEqual(readdirSync(machine.root).sort(), ['backend', 'flutter'])
    assert.ok(existsSync(join(machine.root, 'flutter', 'crux_flutter', '.git')))
    assert.ok(existsSync(join(machine.root, 'backend', 'nis-search-go', '.git')))
    assert.equal(lineWith(result.stdout, 'drama-android'), undefined)
  } finally {
    machine.cleanup()
  }
})

test('--team can be given more than once', async () => {
  const machine = makeMachine()
  try {
    machine.addRepo('crux_flutter', 'flutter')
    machine.addRepo('drama-android', 'android')
    machine.addRepo('nis-search-go', 'backend')

    const result = await machine.setup('--team', 'flutter', '--team', 'android')

    assert.equal(result.status, 0, result.stderr + result.stdout)
    assert.deepEqual(readdirSync(machine.root).sort(), ['android', 'flutter'])
  } finally {
    machine.cleanup()
  }
})

test('setup refuses a Team that is not one of the Teams, and clones nothing', async () => {
  const machine = makeMachine()
  try {
    machine.addRepo('crux_flutter', 'flutter')

    const result = await machine.setup('--team', 'flutter,mobile')

    assert.notEqual(result.status, 0)
    assert.match(result.stderr, /Unknown Team: mobile\. The Teams are flutter, android, ios, backend, data, frontend, other/)
    assert.equal(existsSync(machine.root), false)
  } finally {
    machine.cleanup()
  }
})

test('a Repo whose folder already exists is left as it is and reported, and the others are still cloned', async () => {
  const machine = makeMachine()
  try {
    machine.addRepo('crux_flutter', 'flutter', 'development')
    machine.addRepo('skill-up', 'flutter')
    // Saransh's own clone, on a feature branch with work in progress.
    const existing = join(machine.root, 'flutter', 'crux_flutter')
    mkdirSync(dirname(existing), { recursive: true })
    git(dirname(existing), 'clone', '-q', join(dirname(machine.root), 'remotes', 'crux_flutter.git'), existing)
    git(existing, 'checkout', '-q', '-b', 'feature')
    writeFileSync(join(existing, 'notes.txt'), 'work in progress\n')

    const result = await machine.setup()

    assert.equal(result.status, 0, result.stderr + result.stdout)
    assert.equal(checkedOut(existing), 'feature')
    assert.equal(readFileSync(join(existing, 'notes.txt'), 'utf8'), 'work in progress\n')
    assert.equal(git(existing, 'status', '--porcelain'), '?? notes.txt')
    assert.match(lineWith(result.stdout, existing) ?? '', /already there, left as it is/)
    assert.equal(checkedOut(join(machine.root, 'flutter', 'skill-up')), 'main')
  } finally {
    machine.cleanup()
  }
})

test("a Repo that fails to clone is reported, the others are still cloned, and setup exits non-zero", async () => {
  const machine = makeMachine()
  try {
    machine.addBrokenRepo('crux_flutter', 'flutter')
    machine.addRepo('skill-up', 'flutter')

    const result = await machine.setup()

    assert.equal(result.status, 1)
    assert.match(lineWith(result.stdout, join(machine.root, 'flutter', 'crux_flutter')) ?? '', /failed to clone: .+/)
    assert.equal(existsSync(join(machine.root, 'flutter', 'crux_flutter')), false)
    assert.equal(checkedOut(join(machine.root, 'flutter', 'skill-up')), 'main')
  } finally {
    machine.cleanup()
  }
})

test('setup reports the version of each tool the Pipeline needs', async () => {
  const machine = makeMachine()
  try {
    const result = await machine.setup()

    assert.equal(result.status, 0, result.stderr + result.stdout)
    assert.match(toolLine(result.stdout, 'git') ?? '', /git \d+\.\d+\.\d+/)
    assert.match(toolLine(result.stdout, 'node') ?? '', /node 25\.2\.0$/)
    assert.match(toolLine(result.stdout, 'claude') ?? '', /claude 2\.1\.310$/)
    assert.match(toolLine(result.stdout, 'codex') ?? '', /codex 0\.163\.0$/)
    assert.match(toolLine(result.stdout, 'agy') ?? '', /agy 1\.4\.5$/)
  } finally {
    machine.cleanup()
  }
})

test('setup flags Workers older than the versions the PRD notes, and a Node older than the repo needs', async () => {
  const machine = makeMachine()
  try {
    machine.setTool('codex', 'codex-cli 0.154.0')
    machine.setTool('agy', '1.4.4')
    machine.setTool('node', 'v24.17.0')

    const result = await machine.setup()

    // Outdated tools still work, so setup goes on and succeeds.
    assert.equal(result.status, 0, result.stderr + result.stdout)
    assert.match(toolLine(result.stdout, 'codex') ?? '', /codex 0\.154\.0: older than 0\.163\.0/)
    assert.match(toolLine(result.stdout, 'agy') ?? '', /agy 1\.4\.4: older than 1\.4\.5/)
    assert.match(toolLine(result.stdout, 'node') ?? '', /node 24\.17\.0: older than 25\.0\.0/)
    assert.match(toolLine(result.stdout, 'claude') ?? '', /claude 2\.1\.310$/)
  } finally {
    machine.cleanup()
  }
})

test('setup reports a tool missing from PATH and exits non-zero', async () => {
  const machine = makeMachine()
  try {
    machine.addRepo('crux_flutter', 'flutter')
    machine.setTool('agy', null)

    const result = await machine.setup()

    assert.equal(result.status, 1)
    assert.match(toolLine(result.stdout, 'agy') ?? '', /agy: not found on PATH/)
    assert.equal(checkedOut(join(machine.root, 'flutter', 'crux_flutter')), 'main')
  } finally {
    machine.cleanup()
  }
})

test("setup prints a checklist of what it can't do: SDKs and IDEs, secrets and env files, and folders that aren't Repos", async () => {
  const machine = makeMachine()
  try {
    machine.addRepo('crux_flutter', 'flutter')
    machine.addRepo('inshortsapp_swift_uikit', 'ios')

    const result = await machine.setup()

    const checklist = result.stdout.slice(result.stdout.indexOf('Still to do by hand'))
    assert.ok(result.stdout.includes('Still to do by hand'), result.stdout)
    assert.match(checklist, /Flutter SDK/)
    assert.match(checklist, /Xcode/)
    // Only the selected Teams' SDKs.
    assert.doesNotMatch(checklist, /\bGo\b/)
    assert.match(checklist, /\.env/)
    assert.match(checklist, /env files/)
    assert.match(checklist, /folders that aren't Repos/i)
    assert.match(checklist, /antigravity-home/)
  } finally {
    machine.cleanup()
  }
})

test("a Repo's folder that exists but isn't a git clone is left as it is, and reported as not a clone", async () => {
  const machine = makeMachine()
  try {
    machine.addRepo('crux_flutter', 'flutter')
    const existing = join(machine.root, 'flutter', 'crux_flutter')
    mkdirSync(existing, { recursive: true })
    writeFileSync(join(existing, 'notes.txt'), 'kept\n')

    const result = await machine.setup()

    assert.equal(result.status, 0, result.stderr + result.stdout)
    assert.deepEqual(readdirSync(existing), ['notes.txt'])
    assert.match(lineWith(result.stdout, existing) ?? '', /already there, left as it is, though it is not a git clone/)
  } finally {
    machine.cleanup()
  }
})

test('without git, setup says so first and clones nothing', async () => {
  const machine = makeMachine()
  try {
    machine.addRepo('crux_flutter', 'flutter')
    machine.removeGit()

    const result = await machine.setup()

    assert.equal(result.status, 1)
    assert.ok(result.stdout.indexOf('git: not found on PATH') < result.stdout.indexOf('crux_flutter'), result.stdout)
    assert.match(lineWith(result.stdout, join(machine.root, 'flutter', 'crux_flutter')) ?? '', /not cloned, since git is missing/)
    assert.equal(existsSync(join(machine.root, 'flutter', 'crux_flutter')), false)
  } finally {
    machine.cleanup()
  }
})
