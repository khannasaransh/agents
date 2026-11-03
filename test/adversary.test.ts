import assert from 'node:assert/strict'
import { test } from 'node:test'
import { agentAttempts } from '../src/dashboard.ts'
import { loadAgent, type Agent } from '../src/agent.ts'
import { callAgent, type Inputs } from '../src/worker.ts'
import { codexWorker } from '../src/workers/codex.ts'
import { cursorWorker } from '../src/workers/cursor.ts'
import { claudeCodeWorker } from '../src/workers/claude-code.ts'
import { fakeWorker } from '../src/workers/fake.ts'
import { contestedHtml, type AdversaryResult, type ContestedPoint, type MissedItem } from '../src/adversary.ts'
import { makeWorkspace, git } from './helpers.ts'

// This file checks the adversary path. A local .env may set ADVERSARY=false, which the environment overrides.
process.env.ADVERSARY = 'true'

const point: ContestedPoint = {
  topic: 'Price loading', main: 'The price is safe to display.', adversary: 'The price can be displayed before loading.',
  evidence: ['lib/paywall.dart:42 reads price before awaiting load'], resolution: 'Test a delayed price response.',
}
const missed: MissedItem = {
  topic: 'Failed price', missedBy: 'main', item: 'The paywall stays up when the price fails to load.',
  evidence: ['lib/paywall.dart:58 keeps the last price on error'],
}
const agree = { points: [], missed: [] }
const primary = { summary: 'Main summary', findings: [], memory: null }
const independent = { summary: 'Independent summary', findings: [], memory: 'Do not apply this Memory' }
const inputs = { repo: 'test', branch: 'main', from: 'a', to: 'b', commits: [], memory: '' }

async function reviewer(): Promise<Agent> { return loadAgent('reviewer') }

test('independent work sees only original inputs; comparison sees both; the Step receives only the main answer', async t => {
  const agent = await reviewer()
  const calls: string[] = []
  let result: AdversaryResult | undefined
  t.mock.method(codexWorker, 'call', async (target: Agent, given: Inputs) => {
    calls.push(target.name)
    assert.deepEqual(given, inputs)
    return primary
  })
  t.mock.method(cursorWorker, 'call', async (target: Agent, given: Inputs) => {
    calls.push(target.name)
    assert.equal(target.config.permissions, 'read-only')
    assert.deepEqual(target.tools, [])
    if (target.name.endsWith('-adversary')) {
      assert.deepEqual(given, inputs)
      return independent
    }
    assert.deepEqual(given, { task: inputs, mainAnswer: primary, independentAnswer: independent })
    return { points: [point], missed: [missed] }
  })
  const answer = await callAgent(agent, inputs, { cwd: process.cwd(), dryRun: false, log() {}, onAdversary: value => { result = value } })
  assert.equal(answer, primary)
  assert.deepEqual(calls, ['reviewer-adversary', 'reviewer', 'reviewer-contest'])
  assert.equal(result?.status, 'compared')
  if (result?.status === 'compared') {
    assert.deepEqual(result.points, [point])
    assert.deepEqual(result.missed, [missed])
  }
  assert.deepEqual(result?.independentAnswer, independent)
  assert.equal(primary.memory, null)
})

test('fallback retains its own provenance and does not replace the independent answer', async t => {
  const agent = await reviewer()
  let result: AdversaryResult | undefined
  t.mock.method(codexWorker, 'call', async () => { throw new Error('quota') })
  t.mock.method(claudeCodeWorker, 'call', async () => primary)
  t.mock.method(cursorWorker, 'call', async (target: Agent) => target.name.endsWith('-adversary') ? independent : target.name.endsWith('-contest') ? agree : primary)
  assert.equal(await callAgent(agent, inputs, { cwd: '.', dryRun: false, log() {}, onAdversary: value => { result = value } }), primary)
  assert.equal(result?.mainWorker.name, 'claude-code')
  assert.deepEqual(result?.independentAnswer, independent)
  assert.equal(result?.status, 'compared')
  if (result?.status === 'compared') assert.deepEqual(result.points, [])
})

test('independent failure or invalid comparison is recorded without failing the main result', async t => {
  const agent = await reviewer()
  t.mock.method(codexWorker, 'call', async () => primary)
  for (const failure of ['independent', 'schema', 'evidence', 'missed']) {
    let result: AdversaryResult | undefined
    const mock = t.mock.method(cursorWorker, 'call', async (target: Agent) => {
      if (failure === 'independent') throw new Error('adversary unavailable')
      if (target.name.endsWith('-adversary')) return independent
      if (failure === 'schema') return { unexpected: true }
      if (failure === 'missed') return { points: [], missed: [{ ...missed, evidence: [] }] }
      return { points: [{ ...point, evidence: [] }], missed: [] }
    })
    assert.equal(await callAgent(agent, inputs, { cwd: '.', dryRun: false, log() {}, onAdversary: value => { result = value } }), primary)
    assert.equal(result?.status, 'failed')
    mock.mock.restore()
  }
})

test('ADVERSARY=false skips both adversary calls and records nothing', async t => {
  process.env.ADVERSARY = 'false'
  t.after(() => { process.env.ADVERSARY = 'true' })
  const agent = await reviewer()
  const calls: string[] = []
  let recorded = false
  t.mock.method(fakeWorker, 'call', async (target: Agent) => {
    calls.push(target.name)
    return primary
  })
  const lines: string[] = []
  assert.equal(await callAgent(agent, inputs, { cwd: '.', dryRun: true, log: (line) => lines.push(line), onAdversary: () => { recorded = true } }), primary)
  assert.deepEqual(calls, ['reviewer'])
  assert.equal(recorded, false)
  assert.match(lines.join('\n'), /adversary off \(ADVERSARY=false\)/)
})

test('unconfigured Agents keep the existing single-answer behavior and dry runs use only fake calls', async t => {
  const agent = await reviewer()
  t.mock.method(codexWorker, 'call', async () => { throw new Error('real CLI must not run') })
  t.mock.method(claudeCodeWorker, 'call', async () => { throw new Error('real CLI must not run') })
  t.mock.method(cursorWorker, 'call', async () => { throw new Error('real CLI must not run') })
  const calls: string[] = []
  t.mock.method(fakeWorker, 'call', async (target: Agent) => {
    calls.push(target.name)
    return target.name.endsWith('-contest') ? agree : primary
  })
  await callAgent({ ...agent, config: { ...agent.config, adversaryWorker: undefined } }, inputs, { cwd: '.', dryRun: true, log() {} })
  assert.deepEqual(calls, ['reviewer'])
  calls.length = 0
  await callAgent(agent, inputs, { cwd: '.', dryRun: true, log() {} })
  assert.deepEqual(calls, ['reviewer-adversary', 'reviewer', 'reviewer-contest'])
})

test('read-only adversarial calls remove write permissions and executable Tools even for a writing Agent', async t => {
  const agent = await reviewer()
  agent.config = { ...agent.config, permissions: { write: ['.'] }, tools: { mutate: 'mutate changes files' } }
  agent.tools = [{ name: 'mutate', path: '/tmp/mutate', usage: 'mutate changes files' }]
  t.mock.method(codexWorker, 'call', async (target: Agent) => {
    assert.deepEqual(target.config.permissions, { write: ['.'] })
    return primary
  })
  t.mock.method(cursorWorker, 'call', async (target: Agent) => {
    assert.equal(target.config.permissions, 'read-only')
    assert.deepEqual(target.config.tools, {})
    assert.deepEqual(target.tools, [])
    return target.name.endsWith('-contest') ? agree : independent
  })
  await callAgent(agent, inputs, { cwd: '.', dryRun: false, log() {} })
})

test('a dry review persists disagreements, renders both daily formats, and replaces them on a forced rerun', async t => {
  const ws = makeWorkspace()
  t.after(() => ws.cleanup())
  const repo = ws.addRepo('example')
  const from = git(repo.folder, 'rev-parse', 'HEAD')
  repo.pushCommit('Price change')
  ws.writeRepoList()
  const id = '2026-10-31-0530'
  ws.prepareRun(id, { dryRun: true })
  ws.writeFetchResult(id, repo, from)
  ws.writeCannedAnswers({ reviewer: [{ answer: primary }], 'reviewer-adversary': [{ answer: independent }], 'reviewer-contest': [{ answer: { points: [point], missed: [missed] } }] })
  const run = await ws.agents('step', 'review', '--run', id)
  assert.equal(run.status, 0, run.stderr)
  const result = ws.reviewResult(id, 'example')
  assert.deepEqual(result.adversary.points, [point])
  assert.deepEqual(result.adversary.missed, [missed])
  assert.equal(result.memory, null)
  assert.equal((await ws.agents('step', 'brief', '--run', id)).status, 0)
  for (const extension of ['md', 'html']) {
    const brief = ws.readRunFile(id, `brief.${extension}`)
    assert.match(brief, /Contested/)
    assert.ok(brief.includes(point.main))
    assert.ok(brief.includes(point.adversary))
    assert.ok(brief.includes(point.resolution))
    assert.ok(brief.includes('Main left this out'))
    assert.ok(brief.includes(missed.item))
  }
  ws.writeCannedAnswers({ reviewer: [{ answer: primary }], 'reviewer-adversary': [{ error: 'offline' }] })
  assert.equal((await ws.agents('step', 'review', '--run', id, '--force')).status, 0)
  assert.equal((await ws.agents('step', 'brief', '--run', id, '--force')).status, 0)
  const brief = ws.readRunFile(id, 'brief.html')
  assert.match(brief, /Adversarial assessment failed:.*offline/)
  assert.ok(!brief.includes(point.resolution))
})

test('HTML escapes both positions, evidence and worker errors', () => {
  const worker = { name: 'codex', model: 'test', effort: 'high' } as const
  const result: AdversaryResult = {
    agent: 'test', mainWorker: worker, worker, status: 'compared',
    points: [{ ...point, adversary: '<script>alert(1)</script>' }],
    missed: [{ ...missed, item: '<script>alert(2)</script>' }],
  }
  const html = contestedHtml([{ label: '<b>test</b>', result }])
  assert.ok(!html.includes('<script>'))
  assert.match(html, /&lt;script&gt;/)
})

test('the dashboard includes usage for independent and comparison calls', () => {
  const log = [
    'reviewer-adversary answered on claude-code (opus, high) in 3s [tokens={"inputTokens":10,"outputTokens":5,"totalTokens":15,"complete":true}]',
    'reviewer-contest answered on claude-code (opus, high) in 2s [tokens={"inputTokens":20,"outputTokens":5,"totalTokens":25,"complete":true}]',
  ].join('\n')
  const attempts = agentAttempts(log, 'review')
  assert.deepEqual(attempts.map(attempt => attempt.agent), ['reviewer-adversary', 'reviewer-contest'])
  assert.deepEqual(attempts.map(attempt => attempt.usage?.totalTokens), [15, 25])
})

test('rejects an adversary shared with either main attempt before running any Worker', async t => {
  const base = await reviewer()
  const called = t.mock.method(fakeWorker, 'call', async () => primary)
  for (const worker of [undefined, 'claude-code'] as const) {
    const agent = { ...base, config: { ...base.config, adversaryWorker: base.config.fallbackWorker } }
    await assert.rejects(callAgent(agent, inputs, { cwd: '.', dryRun: true, worker, log() {} }), /adversaryWorker must differ from both/)
  }
  assert.equal(called.mock.callCount(), 0)
})

test('overriding the main Worker keeps Cursor Grok separate, including when the override falls back', async t => {
  const agent = await reviewer()
  t.mock.method(cursorWorker, 'call', async (target: Agent, _inputs: Inputs, options: { model: string; effort: string }) => {
    assert.equal(options.model, 'grok-4.7')
    assert.equal(options.effort, 'xhigh')
    return target.name.endsWith('-contest') ? { points: [point], missed: [] } : independent
  })
  t.mock.method(codexWorker, 'call', async () => primary)
  for (const failOverride of [false, true]) {
    const mock = t.mock.method(claudeCodeWorker, 'call', async () => {
      if (failOverride) throw new Error('quota')
      return primary
    })
    let result: AdversaryResult | undefined
    assert.equal(await callAgent(agent, inputs, { cwd: '.', dryRun: false, worker: 'claude-code', log() {}, onAdversary: value => { result = value } }), primary)
    assert.equal(result?.status, 'compared')
    assert.equal(result?.mainWorker.name, failOverride ? 'codex' : 'claude-code')
    assert.deepEqual(result?.worker, { name: 'cursor', model: 'grok-4.7', effort: 'xhigh' })
    mock.mock.restore()
  }
})

test('every bundled Agent uses Cursor Grok 4.7 at extra-high effort as its third Worker', async () => {
  for (const name of ['reviewer', 'pm', 'docs', 'health', 'events', 'chart', 'risk', 'portfolio-manager']) {
    const { config } = await loadAgent(name)
    assert.deepEqual(config.adversaryWorker, { name: 'cursor', model: 'grok-4.7', effort: 'xhigh' }, name)
    assert.notEqual(config.adversaryWorker?.name, config.worker.name)
    assert.notEqual(config.adversaryWorker?.name, config.fallbackWorker.name)
  }
})
