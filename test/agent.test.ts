import assert from 'node:assert/strict'
import { afterEach, beforeEach, test } from 'node:test'
import reviewer from '../agents/reviewer/config.ts'
import { makeWorkspace, type Workspace } from './helpers.ts'

let ws: Workspace
beforeEach(() => {
  ws = makeWorkspace()
  ws.writeRepoList([])
})
afterEach(() => ws.cleanup())

/** Runs the Review Step in a new dry Run with the given Reviewer folder, returning its exit code and log. */
async function reviewWith(files: Record<string, string>) {
  const runId = `2026-10-22-0530-${ws.runIds().length + 1}`
  ws.prepareRun(runId, { dryRun: true })
  ws.writeAgent('reviewer', files)
  const result = await ws.agents('step', 'review', '--run', runId)
  return { status: result.status, log: ws.readRunFile(runId, 'logs', 'review.log') }
}

const configModule = (config: unknown) => `export default ${JSON.stringify(config)}\n`

test("the Review Step fails with a message naming what is wrong in the Reviewer's config", async () => {
  const cases: [unknown, RegExp][] = [
    [{ ...reviewer, worker: { ...reviewer.worker, effort: 'max' } }, /config\.worker\.effort must be one of low, medium, high/],
    [{ ...reviewer, fallbackWorker: { ...reviewer.fallbackWorker, name: 'gemini' } }, /config\.fallbackWorker\.name must be one of codex, claude-code, antigravity/],
    [{ ...reviewer, fallbackWorker: reviewer.worker }, /config\.fallbackWorker must name a different Worker from config\.worker/],
    [{ ...reviewer, permissions: 'everything' }, /config\.permissions must be "read-only" or \{ write: \[folders\] \}/],
    [{ ...reviewer, timeoutSeconds: 0 }, /config\.timeoutSeconds must be at least 1/],
    [{ ...reviewer, maxTurns: undefined }, /config\.maxTurns is missing/],
    [{ ...reviewer, inputs: { repo: 42 } }, /config\.inputs\.repo must be string/],
    [{ ...reviewer, timeout: 900 }, /config\.timeout is not allowed/],
  ]
  for (const [config, message] of cases) {
    const { status, log } = await reviewWith({ 'config.ts': configModule(config), 'instructions.md': '# Reviewer\n' })
    assert.equal(status, 1)
    assert.match(log, /Invalid config for the reviewer Agent/)
    assert.match(log, message)
  }
})

test('an Agent folder without its instructions file fails with a clear message', async () => {
  const { status, log } = await reviewWith({ 'config.ts': configModule(reviewer) })

  assert.equal(status, 1)
  assert.match(log, /The reviewer Agent has no instructions\.md/)
})

test("this repo's Reviewer config is valid", async () => {
  const { status, log } = await reviewWith({ 'config.ts': configModule(reviewer), 'instructions.md': '# Reviewer\n' })

  assert.equal(status, 0, log)
})
