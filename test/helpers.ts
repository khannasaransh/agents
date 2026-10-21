import { execFileSync, spawn } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { createServer, type RequestListener } from 'node:http'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

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
  /** Pushes a commit to the remote's production branch without touching the local clone. */
  pushCommit(subject: string): string
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
  startedAt: string
  endedAt?: string
  steps: { name: string; status: string; startedAt?: string; endedAt?: string; log: string }[]
}

export interface Workspace {
  dataDir: string
  addRepo(name: string, options?: { team?: string; branch?: string }): TestRepo
  /** Adds a Repo whose remote doesn't exist, so its fetch fails. */
  addBrokenRepo(name: string, options?: { team?: string }): RepoEntry
  /** Writes the Repo list: every Repo added so far, unless given entries. */
  writeRepoList(entries?: RepoEntry[]): void
  /** Prepares a Run folder holding just a Run record, as a Step's input. */
  prepareRun(id: string, steps?: { name: string; status: string }[]): void
  /** Writes a file into a Run folder, as a Step's input. */
  writeRunFile(id: string, path: string, content: unknown): void
  writeRepoState(state: Record<string, { lastReviewed: string }>): void
  readRepoState(): Record<string, { lastReviewed: string }>
  agents(...args: string[]): Promise<CliResult>
  /** Starts the CLI without waiting for it, in its own process group so a test can kill it and its Steps. */
  start(...args: string[]): { killAll(): void; result: Promise<CliResult> }
  runIds(): string[]
  readRun(id: string): RunRecordShape
  readRunFile(id: string, ...path: string[]): string
  fetchResult(id: string, repo: string): any
  cleanup(): void
}

export function makeWorkspace(env: Record<string, string> = {}): Workspace {
  const root = mkdtempSync(join(tmpdir(), 'agents-test-'))
  const dataDir = join(root, 'data')
  const repoListFile = join(root, 'repos.ts')
  const entries: RepoEntry[] = []

  const ws: Workspace = {
    dataDir,

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
        pushCommit(subject) {
          git(upstream, 'commit', '-q', '--allow-empty', '-m', subject)
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

    prepareRun(id, steps = [{ name: 'fetch', status: 'pending' }, { name: 'brief', status: 'pending' }]) {
      ws.writeRunFile(id, 'run.json', {
        id,
        pipeline: 'daily',
        status: 'running',
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

    agents(...args) {
      return ws.start(...args).result
    },

    start(...args) {
      const child = spawn(process.execPath, [cli, ...args], {
        env: { ...gitEnv, AGENTS_DATA_DIR: dataDir, AGENTS_REPOS_FILE: repoListFile, ...env },
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

    fetchResult(id, repo) {
      return JSON.parse(ws.readRunFile(id, 'fetch', `${repo}.json`))
    },

    cleanup() {
      rmSync(root, { recursive: true, force: true })
    },
  }
  return ws
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
