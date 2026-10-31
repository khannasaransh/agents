import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { chmodSync, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { delimiter, dirname, join, relative } from 'node:path'
import { test } from 'node:test'
import { cli, git, gitEnvWithoutPath, type CliResult, type RepoEntry } from './helpers.ts'

// The workspace in helpers.ts can't run on Windows yet (issue 16), and setup must, so its tests
// make their own machine.

const standIns = ['node', 'claude', 'codex', 'agy', 'agent']

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
  /** The machine's home folder, where the Workers keep their config. */
  home: string
  /** The Workers' config setup installs, standing in for the one in this repo. */
  workerConfig: string
  /** Puts a file in the Workers' config, at `<worker>/<its path in the home>`. */
  addWorkerConfig(file: string, text: string): void
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
  const workerConfig = join(base, 'worker-config')
  const entries: RepoEntry[] = []
  let path = [binDir, ...realPath]
  for (const folder of [binDir, homeDir, workerConfig]) mkdirSync(folder)
  // Every tool present and current, unless a test says otherwise.
  const tools: Record<(typeof standIns)[number], string | null> = { node: 'v26.12.1', claude: '2.1.310 (Claude Code)', codex: 'codex-cli 0.163.0', agy: '1.4.5', agent: '2026.09.02' }

  const machine: Machine = {
    root,
    home: homeDir,
    workerConfig,

    addWorkerConfig(file, text) {
      mkdirSync(dirname(join(workerConfig, file)), { recursive: true })
      writeFileSync(join(workerConfig, file), text)
    },

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
      const child = spawn(process.execPath, [cli, 'setup', '--root', root, ...args], {
        env: { ...gitEnvWithoutPath, HOME: homeDir, USERPROFILE: homeDir, PATH: path.join(delimiter), AGENTS_REPOS_FILE: repoListFile, AGENTS_WORKER_CONFIG_DIR: workerConfig },
        windowsHide: true,
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

/** A path as setup writes it into JSON config: in forward slashes, which bash takes on Windows too. */
function forward(path: string): string {
  return path.replaceAll('\\', '/')
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
    assert.match(toolLine(result.stdout, 'node') ?? '', /node 26\.12\.1$/)
    assert.match(toolLine(result.stdout, 'claude') ?? '', /claude 2\.1\.310$/)
    assert.match(toolLine(result.stdout, 'codex') ?? '', /codex 0\.163\.0$/)
    assert.match(toolLine(result.stdout, 'agy') ?? '', /agy 1\.4\.5$/)
    assert.match(toolLine(result.stdout, 'agent') ?? '', /agent 2026\.09\.02$/)
  } finally {
    machine.cleanup()
  }
})

test('setup flags Workers older than the versions the PRD notes, and a Node older than the repo needs', async () => {
  const machine = makeMachine()
  try {
    machine.setTool('codex', 'codex-cli 0.154.0')
    machine.setTool('agy', '1.4.4')
    machine.setTool('node', 'v25.9.0')

    const result = await machine.setup()

    // Outdated tools still work, so setup goes on and succeeds.
    assert.equal(result.status, 0, result.stderr + result.stdout)
    assert.match(toolLine(result.stdout, 'codex') ?? '', /codex 0\.154\.0: older than 0\.163\.0/)
    assert.match(toolLine(result.stdout, 'agy') ?? '', /agy 1\.4\.4: older than 1\.4\.5/)
    assert.match(toolLine(result.stdout, 'node') ?? '', /node 25\.9\.0: older than 26\.0\.0/)
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

test("setup installs the Workers' config into the home, with the captured machine's paths made this machine's", async () => {
  const machine = makeMachine()
  try {
    machine.addWorkerConfig('claude-code/.claude/settings.json', `${JSON.stringify({ model: 'opus', statusLine: { type: 'command', command: '{{home}}/.claude/statusline.sh' } }, null, 2)}\n`)
    machine.addWorkerConfig('claude-code/.claude/statusline.sh', '#!/usr/bin/env bash\necho status\n')
    machine.addWorkerConfig('codex/.codex/config.toml', `model = "gpt-6-astra"\n\n[projects.'{{root}}/backend/ash_backend']\ntrust_level = "trusted"\n\n[projects."{{home}}"]\ntrust_level = "trusted"\n`)
    machine.addWorkerConfig('antigravity/.gemini/antigravity-cli/keybindings.json', '{\n  "cli.exit": ["ctrl+d"]\n}\n')

    const result = await machine.setup()

    assert.equal(result.status, 0, result.stderr + result.stdout)
    const settings = JSON.parse(readFileSync(join(machine.home, '.claude', 'settings.json'), 'utf8'))
    assert.deepEqual(settings, { model: 'opus', statusLine: { type: 'command', command: forward(join(machine.home, '.claude', 'statusline.sh')) } })
    assert.equal(readFileSync(join(machine.home, '.claude', 'statusline.sh'), 'utf8'), '#!/usr/bin/env bash\necho status\n')
    // Claude Code runs it as a command. Windows has no executable bit.
    if (process.platform !== 'win32') assert.equal(statSync(join(machine.home, '.claude', 'statusline.sh')).mode & 0o111, 0o111)
    const toml = readFileSync(join(machine.home, '.codex', 'config.toml'), 'utf8')
    const backend = join(machine.root, 'backend', 'ash_backend')
    // A basic string escapes a Windows path's backslashes; a literal string can't.
    assert.ok(toml.includes(`[projects.'${backend}']`), toml)
    assert.ok(toml.includes(`[projects.${JSON.stringify(machine.home)}]`), toml)
    assert.deepEqual(JSON.parse(readFileSync(join(machine.home, '.gemini', 'antigravity-cli', 'keybindings.json'), 'utf8')), { 'cli.exit': ['ctrl+d'] })
    for (const file of [join('.claude', 'settings.json'), join('.codex', 'config.toml')]) {
      assert.match(lineWith(result.stdout, join(machine.home, file)) ?? '', /installed/)
    }
  } finally {
    machine.cleanup()
  }
})

test("setup backs up the config it replaces, leaves config that already matches alone, and reports which is which", async () => {
  const machine = makeMachine()
  try {
    machine.addWorkerConfig('claude-code/.claude/settings.json', '{\n  "model": "opus"\n}\n')
    machine.addWorkerConfig('antigravity/.gemini/antigravity-cli/keybindings.json', '{\n  "cli.exit": ["ctrl+d"]\n}\n')
    const settings = join(machine.home, '.claude', 'settings.json')
    const keybindings = join(machine.home, '.gemini', 'antigravity-cli', 'keybindings.json')
    mkdirSync(dirname(settings), { recursive: true })
    writeFileSync(settings, '{ "model": "sonnet", "theme": "light" }\n')
    mkdirSync(dirname(keybindings), { recursive: true })
    writeFileSync(keybindings, '{\n  "cli.exit": [\n    "ctrl+d"\n  ]\n}\n')

    const result = await machine.setup()

    assert.equal(result.status, 0, result.stderr + result.stdout)
    assert.deepEqual(JSON.parse(readFileSync(settings, 'utf8')), { model: 'opus' })
    const backups = readdirSync(dirname(settings)).filter((file) => file.startsWith('settings.json.backup-'))
    assert.equal(backups.length, 1, readdirSync(dirname(settings)).join(', '))
    const backup = join(dirname(settings), backups[0])
    assert.equal(readFileSync(backup, 'utf8'), '{ "model": "sonnet", "theme": "light" }\n')
    assert.ok(lineWith(result.stdout, `${settings}:`)?.endsWith(`: replaced; the old one is in ${backup}`), result.stdout)
    // The same settings, only spaced differently, so there is nothing to replace.
    assert.deepEqual(readdirSync(dirname(keybindings)), ['keybindings.json'])
    assert.match(lineWith(result.stdout, `${keybindings}:`) ?? '', /already as in this repo/)

    const again = await machine.setup()

    assert.match(lineWith(again.stdout, `${settings}:`) ?? '', /already as in this repo/)
    assert.equal(readdirSync(dirname(settings)).filter((file) => file.startsWith('settings.json.backup-')).length, 1)
  } finally {
    machine.cleanup()
  }
})

test("setup puts Claude Code's MCP servers into its .claude.json, keeping the state Claude Code keeps there", async () => {
  const machine = makeMachine()
  try {
    const servers = { docs: { type: 'stdio', command: 'npx', args: ['-y', 'docs-mcp', '--root', '{{root}}/backend'] } }
    machine.addWorkerConfig('claude-code/.claude.json', `${JSON.stringify({ mcpServers: servers }, null, 2)}\n`)
    const claudeJson = join(machine.home, '.claude.json')
    const state = { numStartups: 12, oauthAccount: { emailAddress: 'saransh@example.com' }, projects: { '/old/project': {} } }
    writeFileSync(claudeJson, JSON.stringify({ ...state, mcpServers: { old: { command: 'old-mcp' } } }))

    const result = await machine.setup()

    assert.equal(result.status, 0, result.stderr + result.stdout)
    assert.deepEqual(JSON.parse(readFileSync(claudeJson, 'utf8')), {
      ...state,
      mcpServers: { docs: { type: 'stdio', command: 'npx', args: ['-y', 'docs-mcp', '--root', forward(join(machine.root, 'backend'))] } },
    })
    assert.match(lineWith(result.stdout, `${claudeJson}:`) ?? '', /replaced; the old one is in/)
  } finally {
    machine.cleanup()
  }
})

/** Every file in a folder, by its path inside it in forward slashes, with what it holds. */
function filesIn(folder: string): Record<string, string> {
  return Object.fromEntries(
    readdirSync(folder, { recursive: true, withFileTypes: true })
      .filter((entry) => entry.isFile())
      .map((entry) => join(entry.parentPath, entry.name))
      .map((file) => [relative(folder, file).replaceAll('\\', '/'), readFileSync(file, 'utf8')]),
  )
}

function writeHomeFile(home: string, file: string, text: string) {
  mkdirSync(dirname(join(home, file)), { recursive: true })
  writeFileSync(join(home, file), text)
}

test("setup capture copies this machine's Workers' config into the repo, with its paths made placeholders, leaving out secrets and what the Codex app writes itself", async () => {
  const source = makeMachine()
  const target = makeMachine()
  try {
    const { home, root } = source
    writeHomeFile(home, '.claude/settings.json', JSON.stringify({
      model: 'opus',
      statusLine: { type: 'command', command: join(home, '.claude', 'statusline.sh') },
      env: { ANTHROPIC_API_KEY: 'sk-ant-secret', DISABLE_TELEMETRY: '1' },
      autoMode: { environment: [`**Trusted repo**: ash_new (${join(root, 'backend', 'portfolio-dashboard')}), private`] },
      enabledPlugins: { 'skill-creator@claude-plugins-official': true },
    }))
    writeHomeFile(home, '.claude/statusline.sh', '#!/usr/bin/env bash\necho status\n')
    writeHomeFile(home, '.claude/history.jsonl', '{"display":"a prompt"}\n')
    writeHomeFile(home, '.claude/plugins/known_marketplaces.json', JSON.stringify({
      'claude-plugins-official': {
        source: { source: 'github', repo: 'anthropics/claude-plugins-official' },
        installLocation: join(home, '.claude', 'plugins', 'marketplaces', 'claude-plugins-official'),
        lastUpdated: '2026-10-24T09:23:03.671Z',
      },
    }))
    writeHomeFile(home, '.claude.json', JSON.stringify({
      numStartups: 40,
      oauthAccount: { emailAddress: 'saransh@example.com' },
      mcpServers: { linear: { type: 'http', url: 'https://mcp.linear.app/mcp', headers: { Authorization: 'Bearer lin-secret' } } },
    }))
    writeHomeFile(home, '.codex/auth.json', '{"OPENAI_API_KEY":"sk-openai-secret"}')
    const runtime = join(home, 'AppData', 'Local', 'OpenAI', 'Codex', 'runtimes', 'cua_node', '78fb')
    writeHomeFile(home, '.codex/config.toml', [
      'model = "gpt-6-astra"',
      `notify = [ ${JSON.stringify(join(runtime, 'codex-computer-use.exe'))}, "turn-ended" ]`,
      '',
      '[marketplaces.openai-bundled]',
      'source_type = "local"',
      `source = '${join(home, '.codex', '.tmp', 'bundled-marketplaces', 'openai-bundled')}'`,
      '',
      '[plugins."browser@openai-bundled"]',
      'enabled = true',
      '',
      '[mcp_servers.node_repl]',
      `command = '${join(runtime, 'node_repl.exe')}'`,
      '',
      '[mcp_servers.node_repl.env]',
      `CODEX_HOME = '${join(home, '.codex')}'`,
      '',
      '[mcp_servers.github]',
      'command = "github-mcp"',
      'env = { GITHUB_TOKEN = "ghp-secret", GITHUB_HOST = "github.com" }',
      '',
      '[mcp_servers.search]',
      'url = "https://search.example.com/mcp"',
      'bearer_token = "search-secret"',
      '',
      // Codex writes the folders it trusts in lower case on Windows.
      `[projects.'${join(root, 'backend', 'ash_backend').toLowerCase()}']`,
      'trust_level = "trusted"',
      '',
      `[projects.${JSON.stringify(home)}]`,
      'trust_level = "trusted"',
      '',
    ].join('\n'))
    writeHomeFile(home, '.gemini/antigravity-cli/keybindings.json', '{\n  "cli.exit": ["ctrl+d"]\n}\n')
    // Antigravity leaves its MCP config empty until a server is added.
    writeHomeFile(home, '.gemini/config/mcp_config.json', '')

    const captured = await source.setup('capture')

    assert.equal(captured.status, 0, captured.stderr + captured.stdout)
    const config = filesIn(source.workerConfig)
    assert.deepEqual(Object.keys(config).sort(), [
      'antigravity/.gemini/antigravity-cli/keybindings.json',
      'claude-code/.claude.json',
      'claude-code/.claude/settings.json',
      'claude-code/.claude/statusline.sh',
      'codex/.codex/config.toml',
      'secrets.json',
    ])
    const everything = Object.values(config).join('\n')
    for (const secret of ['sk-ant-secret', 'lin-secret', 'ghp-secret', 'search-secret', 'saransh@example.com']) assert.ok(!everything.includes(secret), secret)
    // Nothing points at the machine it was captured on, however it is spelled.
    for (const machinePath of [dirname(home), JSON.stringify(dirname(home)).slice(1, -1)]) assert.ok(!everything.toLowerCase().includes(machinePath.toLowerCase()), everything)
    const settings = JSON.parse(config['claude-code/.claude/settings.json'])
    assert.equal(settings.statusLine.command, '{{home}}/.claude/statusline.sh')
    assert.deepEqual(settings.env, { DISABLE_TELEMETRY: '1' })
    assert.deepEqual(settings.autoMode.environment, ['**Trusted repo**: ash_new ({{root}}/backend/portfolio-dashboard), private'])
    assert.deepEqual(settings.enabledPlugins, { 'skill-creator@claude-plugins-official': true })
    assert.deepEqual(settings.extraKnownMarketplaces, { 'claude-plugins-official': { source: { source: 'github', repo: 'anthropics/claude-plugins-official' } } })
    assert.deepEqual(JSON.parse(config['claude-code/.claude.json']), { mcpServers: { linear: { type: 'http', url: 'https://mcp.linear.app/mcp', headers: {} } } })
    const toml = config['codex/.codex/config.toml']
    for (const managed of ['notify', '[marketplaces.openai-bundled]', 'node_repl', 'AppData']) assert.ok(!toml.includes(managed), `${managed} in\n${toml}`)
    assert.ok(toml.includes('[plugins."browser@openai-bundled"]\nenabled = true'), toml)
    assert.ok(toml.includes("[projects.'{{root}}/backend/ash_backend']"), toml)
    assert.ok(toml.includes('[projects."{{home}}"]'), toml)
    assert.ok(toml.includes('GITHUB_HOST = "github.com"'), toml)
    assert.deepEqual(JSON.parse(config['secrets.json']), [
      { worker: 'codex', file: '.codex/config.toml', setting: 'mcp_servers.github.env.GITHUB_TOKEN' },
      { worker: 'codex', file: '.codex/config.toml', setting: 'mcp_servers.search.bearer_token' },
      { worker: 'claude-code', file: '.claude/settings.json', setting: 'env.ANTHROPIC_API_KEY' },
      { worker: 'claude-code', file: '.claude.json', setting: 'mcpServers.linear.headers.Authorization' },
    ])

    cpSync(source.workerConfig, target.workerConfig, { recursive: true })
    const installed = await target.setup()

    assert.equal(installed.status, 0, installed.stderr + installed.stdout)
    const targetSettings = JSON.parse(readFileSync(join(target.home, '.claude', 'settings.json'), 'utf8'))
    assert.equal(targetSettings.statusLine.command, forward(join(target.home, '.claude', 'statusline.sh')))
    assert.deepEqual(targetSettings.autoMode.environment, [`**Trusted repo**: ash_new (${forward(join(target.root, 'backend', 'portfolio-dashboard'))}), private`])
    assert.ok(readFileSync(join(target.home, '.codex', 'config.toml'), 'utf8').includes(`[projects.'${join(target.root, 'backend', 'ash_backend')}']`))
    assert.deepEqual(readdirSync(target.home).sort(), ['.claude', '.claude.json', '.codex', '.gemini'])
    const checklist = installed.stdout.slice(installed.stdout.indexOf('Still to do by hand'))
    for (const setting of ['env.ANTHROPIC_API_KEY', 'mcpServers.linear.headers.Authorization', 'mcp_servers.github.env.GITHUB_TOKEN', 'mcp_servers.search.bearer_token']) {
      assert.ok(checklist.includes(setting), checklist)
    }
  } finally {
    source.cleanup()
    target.cleanup()
  }
})

test('setup capture refuses a file holding a secret it has no setting to leave out of, and leaves the repo as it was', async () => {
  const machine = makeMachine()
  try {
    machine.addWorkerConfig('codex/.codex/config.toml', 'model = "gpt-6-astra"\n')
    writeHomeFile(machine.home, '.codex/config.toml', 'model = "gpt-6-astra-2"\n')
    writeHomeFile(machine.home, '.claude/statusline.sh', '#!/usr/bin/env bash\ngh api user -H "Authorization: Bearer ghp_abcdefghijklmnopqrstuvwxyz0123456789"\n')

    const result = await machine.setup('capture')

    assert.equal(result.status, 1)
    assert.match(result.stderr, /statusline\.sh: it holds what looks like a secret/)
    assert.ok(!result.stderr.includes('abcdefghijklmnop'), result.stderr)
    assert.deepEqual(filesIn(machine.workerConfig), { 'codex/.codex/config.toml': 'model = "gpt-6-astra"\n' })
  } finally {
    machine.cleanup()
  }
})
