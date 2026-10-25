import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, test } from 'node:test'
import { hangingRemote, makeWorkspace, until, type Workspace } from './helpers.ts'

let ws: Workspace
let remote: Awaited<ReturnType<typeof hangingRemote>> | undefined
afterEach(() => {
  remote?.close()
  remote = undefined
  ws.cleanup()
})

/** A workspace whose Fetch hangs until it times out after `seconds`, so a Run stays active that long. */
async function slowWorkspace(seconds: number) {
  remote = await hangingRemote()
  ws = makeWorkspace({ AGENTS_FETCH_TIMEOUT_SECONDS: String(seconds) })
  const slow = ws.addRepo('slow')
  ws.writeRepoList([{ ...slow.entry, remote: remote.url }])
}

/** Whether a process is still running, as opposed to ended or never started. */
function isRunning(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

test('a second Run refuses to start while one is active, and can start once it ends', async () => {
  await slowWorkspace(2)
  const first = ws.start('run', 'daily')
  await until(() => ws.runIds().length === 1)

  const second = await ws.agents('run', 'daily')

  assert.equal(second.status, 1)
  assert.equal(ws.runIds().length, 1)

  await first.result
  await ws.agents('run', 'daily')
  assert.equal(ws.runIds().length, 2)
})

test('a scheduled start while a Run is active is refused by the lock, and the refusal is recorded', async () => {
  await slowWorkspace(2)
  const manual = ws.start('run', 'daily')
  await until(() => ws.runIds().length === 1)

  const scheduled = await ws.agents('run', 'daily', '--scheduled')

  assert.equal(scheduled.status, 1)
  assert.equal(ws.runIds().length, 1)
  assert.match(readFileSync(join(ws.dataDir, 'scheduled-starts.log'), 'utf8'), /^\S+Z daily: refused: A Run is already active \(pid \d+\); try again once it ends\n$/)
  await manual.result
})

test('agents step refuses while a Run is active', async () => {
  await slowWorkspace(2)
  const active = ws.start('run', 'daily')
  await until(() => ws.runIds().length === 1)
  const [id] = ws.runIds()

  const step = await ws.agents('step', 'brief', '--run', id)

  assert.equal(step.status, 1)
  assert.equal(ws.readRun(id).steps.find((s) => s.name === 'brief')!.status, 'pending')
  await active.result
})

test('a Run that died without ending does not block the next Run, and is recorded as failed', async () => {
  await slowWorkspace(1)
  const crashed = ws.start('run', 'daily')
  await until(() => ws.runIds().length === 1)
  const [crashedId] = ws.runIds()
  crashed.killAll()
  await crashed.result

  await ws.agents('run', 'daily')

  assert.equal(ws.runIds().length, 2)
  assert.equal(ws.readRun(crashedId).status, 'failed')
})

test('when only the runner of a Run dies, the next Run first stops the Step and Worker it left running, so neither writes into it later', async () => {
  ws = makeWorkspace()
  const repo = ws.addRepo('crux_flutter')
  ws.writeRepoList()
  await ws.agents('run', 'daily', '--dry-run')
  repo.pushCommit('Add paywall')
  ws.setWorkerCli('codex', { hang: true })
  const abandoned = ws.start('run', 'daily')
  await until(() => ws.workerCliCalls('codex').length === 1)
  const [, abandonedId] = ws.runIds()
  const [worker] = ws.workerCliCalls('codex')
  abandoned.killCliOnly()
  await abandoned.result

  const next = await ws.agents('run', 'daily', '--dry-run')

  assert.equal(next.status, 0, next.stderr)
  assert.ok(!isRunning(worker.pid), "the abandoned review's Worker was stopped")
  assert.ok(!isRunning(worker.childPid!), 'and so was what it started')
  await new Promise((resolve) => setTimeout(resolve, 500))
  assert.deepEqual(ws.runFiles(abandonedId, 'review'), [])
  assert.equal(ws.readRun(abandonedId).status, 'failed')
})

test('of two Runs starting together after a Run died holding the lock, exactly one starts', async () => {
  await slowWorkspace(2)
  mkdirSync(ws.dataDir, { recursive: true })
  writeFileSync(join(ws.dataDir, 'run.pid'), `${spawnSync(process.execPath, ['-e', '']).pid}\n`)

  const results = await Promise.all([ws.start('run', 'daily'), ws.start('run', 'daily')].map((run) => run.result))

  assert.equal(ws.runIds().length, 1)
  const refused = results.filter((r) => r.status === 1)
  assert.equal(refused.length, 1, results.map((r) => r.stderr).join('\n'))
  assert.match(refused[0].stderr, /A Run is already active/)
})
