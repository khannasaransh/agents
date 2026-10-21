import assert from 'node:assert/strict'
import { afterEach, test } from 'node:test'
import { hangingRemote, makeWorkspace, until, type Workspace } from './helpers.ts'

let ws: Workspace
let remote: Awaited<ReturnType<typeof hangingRemote>>
afterEach(() => {
  remote.close()
  ws.cleanup()
})

/** A workspace whose Fetch hangs until it times out after `seconds`, so a Run stays active that long. */
async function slowWorkspace(seconds: number) {
  remote = await hangingRemote()
  ws = makeWorkspace({ AGENTS_FETCH_TIMEOUT_SECONDS: String(seconds) })
  const slow = ws.addRepo('slow')
  ws.writeRepoList([{ ...slow.entry, remote: remote.url }])
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
