import { execFileSync, spawn } from 'node:child_process'
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { createServer, type RequestListener } from 'node:http'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { FetchResult } from '../steps/fetch.ts'
import type { CannedAnswer } from '../src/workers/fake.ts'

const cli = fileURLToPath(new URL('../src/cli.ts', import.meta.url))

// Keep every git call in the tests away from the user's own git config.
const gitEnv = {
  ...process.env,
  GIT_CONFIG_GLOBAL: '/dev/null',
  GIT_CONFIG_NOSYSTEM: '1',
  GIT_AUTHOR_NAME: 'Test Author',
  GIT_AUTHOR_EMAIL: 'author@example.com',
  GIT_COMMITTER_NAME: 'Test Author',
  GIT_COMMITTER_EMAIL: 'author@example.com',
}

export function git(cwd: string, ...args: string[]): string {
  return execFileSync('git', args, { cwd, env: gitEnv, encoding: 'utf8' }).trim()
}

export interface RepoEntry {
  name: string
  team: string
  remote: string
  folder: string
  branch: string
}

/** A local clone of a local "remote", plus a second clone used to push new commits upstream. */
export interface TestRepo {
  entry: RepoEntry
  folder: string
  /** Pushes a commit, adding any given files, to the remote's production branch without touching the local clone. */
  pushCommit(subject: string, options?: { files?: Record<string, string>; author?: string }): string
}

export interface CliResult {
  status: number | null
  stdout: string
  stderr: string
}

export interface RunRecordShape {
  id: string
  pipeline: string
  status: string
  dryRun?: boolean
  startedAt: string
  endedAt?: string
  steps: { name: string; status: string; startedAt?: string; endedAt?: string; log: string }[]
}

/** How the stand-in for a Worker's CLI answers each call. */
export interface WorkerCliBehavior {
  stdout?: string
  stderr?: string
  exitCode?: number
  /** Start a child process, then answer nothing for 30s, as a stuck CLI would. */
  hang?: boolean
  /** Answer, but leave a child process running that holds the output open, as a command left in the background would. */
  leaveRunning?: boolean
  /** Wait this long before answering, as a CLI at work would. */
  answerAfterMs?: number
}

/** A call the stand-in for a Worker's CLI received. */
export interface WorkerCliCall {
  args: string[]
  stdin: string
  cwd: string
  pid: number
  /** The child process a hanging stand-in started, or one it left running. */
  childPid?: number
  /** Its HOME, and the Antigravity settings file there as it answered, if any. */
  home: string
  antigravitySettings?: any
  /** The file defining the Antigravity agent it was told to run as, with --agent. */
  antigravityCustomAgent?: string
  /** What `git status` listed in the folder it ran in, as it started: files added or changed there. */
  cwdChanges?: string
  /** The folder it was given as --plugin-dir, and the files in it, by path within it. */
  pluginDir?: string
  pluginFiles?: Record<string, string>
}

const workerClis = ['codex', 'claude', 'agy'] as const

export interface Workspace {
  dataDir: string
  /** Saransh's home and Codex's home, as the CLI sees them: empty folders, unless a test writes there. */
  homeDir: string
  codexHomeDir: string
  addRepo(name: string, options?: { team?: string; branch?: string }): TestRepo
  /** Adds a Repo whose remote doesn't exist, so its fetch fails. */
  addBrokenRepo(name: string, options?: { team?: string }): RepoEntry
  /** Writes the Repo list: every Repo added so far, unless given entries. */
  writeRepoList(entries?: RepoEntry[]): void
  /** Prepares a Run folder holding just a Run record, as a Step's input. */
  prepareRun(id: string, options?: { steps?: { name: string; status: string }[]; dryRun?: boolean }): void
  /** Writes a file into a Run folder, as a Step's input. */
  writeRunFile(id: string, path: string, content: unknown): void
  writeRepoState(state: Record<string, { lastReviewed: string }>): void
  readRepoState(): Record<string, { lastReviewed: string }>
  /**
   * Fetches a Repo's clone and writes what Fetch records for it in a Run, as a Step's input: the
   * commits since `from`, or a first-Run baseline when `from` is null.
   */
  writeFetchResult(id: string, repo: TestRepo, from: string | null): void
  /** Sets what the fake Worker answers, per Agent. */
  writeCannedAnswers(answers: Record<string, CannedAnswer[]>): void
  /** Writes the local env file. */
  writeEnvFile(text: string): void
  /**
   * Sets how the stand-in for a Worker's CLI answers. Every workspace puts stand-ins for the
   * Worker CLIs first on PATH, failing every call until told otherwise, so no test starts a real CLI.
   */
  setWorkerCli(command: (typeof workerClis)[number], behavior: WorkerCliBehavior): void
  /** The calls the stand-in for a Worker's CLI received, oldest first. */
  workerCliCalls(command: (typeof workerClis)[number]): WorkerCliCall[]
  /**
   * Writes an Agent folder, by path within it. A script (a file starting with #!) is made executable,
   * as a Tool is. From then on the CLI uses the workspace's Agents, not this repo's.
   */
  writeAgent(name: string, files: Record<string, string>): void
  agents(...args: string[]): Promise<CliResult>
  /** Starts the CLI without waiting for it, in its own process group so a test can kill it and its Steps. */
  start(...args: string[]): { killAll(): void; result: Promise<CliResult> }
  runIds(): string[]
  readRun(id: string): RunRecordShape
  readRunFile(id: string, ...path: string[]): string
  /** The files in a folder of a Run, or none when it doesn't exist. */
  runFiles(id: string, folder: string): string[]
  fetchResult(id: string, repo: string): any
  reviewResult(id: string, repo: string): any
  cleanup(): void
}

export function makeWorkspace(env: Record<string, string> = {}): Workspace {
  const root = mkdtempSync(join(tmpdir(), 'agents-test-'))
  const dataDir = join(root, 'data')
  const repoListFile = join(root, 'repos.ts')
  const cannedAnswersFile = join(root, 'fake-answers.json')
  const envFile = join(root, '.env')
  const agentsDir = join(root, 'agents')
  const binDir = join(root, 'bin')
  const homeDir = join(root, 'home')
  const codexHomeDir = join(root, 'codex-home')
  const entries: RepoEntry[] = []
  let ownAgents = false
  for (const folder of [binDir, homeDir, codexHomeDir]) mkdirSync(folder)
  for (const command of workerClis) writeWorkerCliStandIn(binDir, command)

  const ws: Workspace = {
    dataDir,
    homeDir,
    codexHomeDir,

    addRepo(name, { team = 'flutter', branch = 'main' } = {}) {
      const remote = join(root, 'remotes', `${name}.git`)
      const folder = join(root, 'clones', name)
      const upstream = join(root, 'upstream', name)
      mkdirSync(join(root, 'remotes'), { recursive: true })
      git(root, 'init', '-q', '--bare', '-b', branch, remote)
      execFileSync('git', ['clone', '-q', remote, upstream], { cwd: root, env: gitEnv, stdio: 'ignore' })
      git(upstream, 'checkout', '-q', '-b', branch)
      git(upstream, 'commit', '-q', '--allow-empty', '-m', 'Initial commit')
      git(upstream, 'push', '-q', 'origin', branch)
      git(root, 'clone', '-q', '-b', branch, remote, folder)

      const entry = { name, team, remote, folder, branch }
      entries.push(entry)
      return {
        entry,
        folder,
        pushCommit(subject, { files = {}, author } = {}) {
          for (const [path, content] of Object.entries(files)) {
            mkdirSync(join(upstream, path, '..'), { recursive: true })
            writeFileSync(join(upstream, path), content)
            git(upstream, 'add', path)
          }
          git(upstream, 'commit', '-q', '--allow-empty', '-m', subject, ...(author ? [`--author=${author}`] : []))
          git(upstream, 'push', '-q', 'origin', branch)
          return git(upstream, 'rev-parse', 'HEAD')
        },
      }
    },

    addBrokenRepo(name, { team = 'flutter' } = {}) {
      const folder = join(root, 'clones', name)
      mkdirSync(folder, { recursive: true })
      git(folder, 'init', '-q', '-b', 'main')
      const entry = { name, team, remote: join(root, 'remotes', `${name}-missing.git`), folder, branch: 'main' }
      entries.push(entry)
      return entry
    },

    writeRepoList(list = entries) {
      writeFileSync(repoListFile, `export default ${JSON.stringify(list, null, 2)}\n`)
    },

    prepareRun(id, { steps = ['fetch', 'review', 'brief', 'save-state'].map((name) => ({ name, status: 'pending' })), dryRun = false } = {}) {
      ws.writeRunFile(id, 'run.json', {
        id,
        pipeline: 'daily',
        status: 'running',
        dryRun,
        startedAt: new Date().toISOString(),
        steps: steps.map((s) => ({ ...s, log: `logs/${s.name}.log` })),
      })
    },

    writeRunFile(id, path, content) {
      const file = join(dataDir, 'runs', id, path)
      mkdirSync(join(file, '..'), { recursive: true })
      writeFileSync(file, typeof content === 'string' ? content : JSON.stringify(content))
    },

    writeRepoState(state) {
      mkdirSync(join(dataDir, 'state'), { recursive: true })
      writeFileSync(join(dataDir, 'state', 'repos.json'), JSON.stringify(state))
    },

    readRepoState() {
      return JSON.parse(readFileSync(join(dataDir, 'state', 'repos.json'), 'utf8'))
    },

    writeFetchResult(id, { entry }, from) {
      git(entry.folder, 'fetch', '-q', 'origin', `+refs/heads/${entry.branch}:refs/remotes/origin/${entry.branch}`)
      const head = git(entry.folder, 'rev-parse', `origin/${entry.branch}`)
      const log = from && from !== head ? git(entry.folder, 'log', '--format=%H%x1f%an%x1f%ae%x1f%aI%x1f%s', `${from}..${head}`) : ''
      const commits = log
        .split('\n')
        .filter(Boolean)
        .map((line) => {
          const [sha, author, email, date, subject] = line.split('\x1f')
          return { sha, author, email, date, subject }
        })
      const status = from === null ? 'baseline' : from === head ? 'unchanged' : 'new-commits'
      const result = { repo: entry.name, team: entry.team, branch: entry.branch, previous: from, status, head, commits } as FetchResult
      ws.writeRunFile(id, `fetch/${entry.name}.json`, result)
    },

    writeCannedAnswers(answers) {
      writeFileSync(cannedAnswersFile, JSON.stringify(answers))
    },

    writeEnvFile(text) {
      writeFileSync(envFile, text)
    },

    setWorkerCli(command, behavior) {
      writeFileSync(join(binDir, `${command}.json`), JSON.stringify(behavior))
    },

    workerCliCalls(command) {
      const file = join(binDir, `${command}.calls.jsonl`)
      if (!existsSync(file)) return []
      return readFileSync(file, 'utf8')
        .split('\n')
        .filter(Boolean)
        .map((line) => JSON.parse(line))
    },

    writeAgent(name, files) {
      mkdirSync(join(agentsDir, name), { recursive: true })
      for (const [file, content] of Object.entries(files)) {
        const path = join(agentsDir, name, file)
        mkdirSync(dirname(path), { recursive: true })
        writeFileSync(path, content, { mode: content.startsWith('#!') ? 0o755 : 0o644 })
      }
      ownAgents = true
    },

    agents(...args) {
      return ws.start(...args).result
    },

    start(...args) {
      const child = spawn(process.execPath, [cli, ...args], {
        env: { ...gitEnv, HOME: homeDir, CODEX_HOME: codexHomeDir, PATH: `${binDir}:${process.env.PATH}`, AGENTS_DATA_DIR: dataDir, AGENTS_REPOS_FILE: repoListFile, AGENTS_ENV_FILE: envFile, AGENTS_FAKE_ANSWERS: cannedAnswersFile, ...(ownAgents && { AGENTS_AGENTS_DIR: agentsDir }), ...env },
        detached: true,
      })
      let stdout = ''
      let stderr = ''
      child.stdout.on('data', (d) => (stdout += d))
      child.stderr.on('data', (d) => (stderr += d))
      const result = new Promise<CliResult>((resolve) => child.on('close', (status) => resolve({ status, stdout, stderr })))
      return { killAll: () => process.kill(-child.pid!, 'SIGKILL'), result }
    },

    runIds() {
      try {
        return readdirSync(join(dataDir, 'runs')).sort()
      } catch {
        return []
      }
    },

    readRun(id) {
      return JSON.parse(ws.readRunFile(id, 'run.json'))
    },

    readRunFile(id, ...path) {
      return readFileSync(join(dataDir, 'runs', id, ...path), 'utf8')
    },

    runFiles(id, folder) {
      try {
        return readdirSync(join(dataDir, 'runs', id, folder)).sort()
      } catch {
        return []
      }
    },

    fetchResult(id, repo) {
      return JSON.parse(ws.readRunFile(id, 'fetch', `${repo}.json`))
    },

    reviewResult(id, repo) {
      return JSON.parse(ws.readRunFile(id, 'review', `${repo}.json`))
    },

    cleanup() {
      rmSync(root, { recursive: true, force: true })
    },
  }
  return ws
}

/**
 * Writes an executable standing in for a Worker's CLI. It records each call, with what the folder
 * it runs in and its plugin folder hold as it starts and the settings in its home as it answers,
 * then answers as <command>.json beside it says, or fails when there is none.
 */
function writeWorkerCliStandIn(binDir: string, command: string) {
  const file = join(binDir, command)
  const behaviorFile = JSON.stringify(join(binDir, `${command}.json`))
  const callsFile = JSON.stringify(join(binDir, `${command}.calls.jsonl`))
  writeFileSync(
    file,
    `#!${process.execPath}
const { appendFileSync, existsSync, readFileSync, readdirSync, statSync } = require('node:fs')
const { execFileSync, spawn } = require('node:child_process')
const { join, relative } = require('node:path')
const filesIn = (folder) => readdirSync(folder).flatMap((entry) => {
  const path = join(folder, entry)
  return statSync(path).isDirectory() ? filesIn(path) : [path]
})
const behavior = existsSync(${behaviorFile})
  ? JSON.parse(readFileSync(${behaviorFile}, 'utf8'))
  : { stderr: '${command} stand-in: this test expects no ${command} call', exitCode: 1 }
const call = { args: process.argv.slice(2), stdin: readFileSync(0, 'utf8'), cwd: process.cwd(), pid: process.pid, home: process.env.HOME }
try {
  call.cwdChanges = execFileSync('git', ['status', '--porcelain', '--untracked-files=all'], { encoding: 'utf8' })
} catch {}
if (call.args.includes('--plugin-dir')) {
  call.pluginDir = call.args[call.args.indexOf('--plugin-dir') + 1]
  call.pluginFiles = Object.fromEntries(filesIn(call.pluginDir).map((file) => [relative(call.pluginDir, file), readFileSync(file, 'utf8')]))
}
if (behavior.hang) call.childPid = spawn('sleep', ['60'], { stdio: 'ignore' }).pid
if (behavior.leaveRunning) {
  const child = spawn('sleep', ['60'], { stdio: ['ignore', 'inherit', 'inherit'] })
  child.unref()
  call.childPid = child.pid
}
// Antigravity rereads its settings during a call, so they are read as it answers.
const settingsFile = join(call.home, '.gemini', 'antigravity-cli', 'settings.json')
const agentFile = call.args.includes('--agent') && join(call.home, '.gemini', 'config', 'agents', call.args[call.args.indexOf('--agent') + 1] + '.md')
const record = () => {
  if (existsSync(settingsFile)) call.antigravitySettings = JSON.parse(readFileSync(settingsFile, 'utf8'))
  if (agentFile && existsSync(agentFile)) call.antigravityCustomAgent = readFileSync(agentFile, 'utf8')
  appendFileSync(${callsFile}, JSON.stringify(call) + '\\n')
}
if (behavior.hang) {
  record()
  setTimeout(() => {}, 30_000)
} else
  setTimeout(() => {
    record()
    process.stdout.write(behavior.stdout ?? '')
    process.stderr.write(behavior.stderr ?? '')
    process.exitCode = behavior.exitCode ?? 0
  }, behavior.answerAfterMs ?? 0)
`,
  )
  chmodSync(file, 0o755)
}

/** A local HTTP server standing in for a remote, such as one that never answers. */
export async function serve(handler: RequestListener): Promise<{ url: string; close(): void }> {
  const server = createServer(handler)
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const { port } = server.address() as AddressInfo
  return {
    url: `http://127.0.0.1:${port}/repo.git`,
    close() {
      server.closeAllConnections()
      server.close()
    },
  }
}

/**
 * A remote that accepts the connection and never answers, so a fetch from it hangs. It hangs up
 * after `giveUpAfterMs`, so a broken Fetch timeout fails a test instead of hanging it.
 */
export async function hangingRemote(giveUpAfterMs = 10_000): Promise<{ url: string; close(): void }> {
  const remote = await serve(() => {})
  setTimeout(() => remote.close(), giveUpAfterMs).unref()
  return remote
}

export async function until(condition: () => boolean, timeoutMs = 5000): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (!condition()) {
    if (Date.now() > deadline) throw new Error('Timed out waiting for condition')
    await new Promise((resolve) => setTimeout(resolve, 25))
  }
}
