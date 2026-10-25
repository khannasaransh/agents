import assert from 'node:assert/strict'
import { mkdirSync, readFileSync, realpathSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, test } from 'node:test'
import { makeWorkspace, pdExamples, type Workspace } from './helpers.ts'

let ws: Workspace
afterEach(() => ws.cleanup())

const runId = '2026-10-27-0930'

/** Where ash_new is, as the env file names it: the folder the Health Agent runs in. */
let ashNew: string

/** A stocks Run whose Lake Step ended as `lake`, having recorded `status` (an example's name), or no status at all. */
function prepare({ lake = 'succeeded', status = 'status.clean.json' as string | null, dryRun = false } = {}) {
  ws = makeWorkspace()
  ashNew = join(ws.homeDir, 'portfolio-dashboard')
  mkdirSync(ashNew)
  ws.writeEnvFile(`ASH_NEW_FOLDER=${ashNew}\n`)
  ws.prepareRun(runId, {
    pipeline: 'stocks',
    steps: [
      { name: 'lake', status: lake },
      { name: 'health', status: 'pending' },
      { name: 'brief', status: 'pending' },
    ],
    dryRun,
  })
  const refreshed = lake === 'succeeded'
  const attempts = (refreshed ? [0] : [1, 1]).map((exitCode) => ({ startedAt: '2026-10-27T01:12:00.000Z', endedAt: '2026-10-27T01:40:00.000Z', exitCode, timedOut: false }))
  ws.writeRunFile(runId, 'lake.json', { dryRun, cleared: { cleared: [], refused: null }, attempts, refreshed })
  ws.writeRunFile(runId, 'logs/lake.log', refreshed ? 'Data health: ok\n' : 'Stopped: Yahoo answered 429 Too Many Requests\npd daily failed; retrying once\nStopped: Yahoo answered 429 Too Many Requests\n')
  if (status) ws.writeRunFile(runId, 'lake/status.json', example(status))
}

const example = (name: string) => JSON.parse(readFileSync(join(pdExamples, name), 'utf8'))
const health = () => ws.runFiles(runId, '.').includes('health.json') && JSON.parse(ws.readRunFile(runId, 'health.json'))
const step = (...args: string[]) => ws.agents('step', 'health', '--run', runId, ...args)

const answer = {
  diagnosis: 'Yahoo rate-limited the price top-up, so both runs of pd daily stopped before the US prices were in.',
  fix: 'Run pd daily again after 10:00 IST, when the limit resets.',
  evidence: [
    { source: 'lakeLog', shows: 'Both runs stopped on "Yahoo answered 429 Too Many Requests"' },
    { source: 'data/logs/jobs/482.jsonl', shows: 'The job failed in prices-update after 40 tickers in a row were refused' },
  ],
}

/** What `claude --print --output-format json` prints when its schema-checked answer is `answer`. */
const claudeCodeAnswering = (answer: unknown) => ({
  stdout: JSON.stringify({ type: 'result', subtype: 'success', is_error: false, num_turns: 6, result: JSON.stringify(answer), structured_output: answer }),
})

/** The value of one input in an Agent's prompt, as the Worker's CLI was given it. */
function promptInput(prompt: string, name: string): unknown {
  const block = new RegExp(`### ${name}: [^\\n]*\\n\\n\`\`\`(json)?\\n([\\s\\S]*?)\\n\`\`\`\\n`).exec(prompt)
  assert.ok(block, `no ${name} input in the prompt:\n${prompt}`)
  return block[1] ? JSON.parse(block[2]) : block[2]
}

test('the Health Step skips itself when the Lake is healthy, calling no Agent and dropping a diagnosis an earlier run of it recorded', async () => {
  prepare({ status: 'status.clean.json' })
  ws.writeRunFile(runId, 'health.json', { status: 'diagnosed', why: ['The Lake Step failed'], ...answer })

  const result = await step()

  assert.equal(result.status, 0, result.stderr)
  assert.equal(ws.readRun(runId).steps.find((s) => s.name === 'health')!.status, 'skipped')
  assert.deepEqual(ws.workerCliCalls('codex'), [])
  assert.deepEqual(ws.workerCliCalls('claude'), [])
  assert.equal(health(), false)
  assert.match(ws.readRunFile(runId, 'logs', 'health.log'), /Skipped: The Lake is healthy/)
})

test("after a failed Lake Step, the Health Agent runs on Claude Code in ash_new's folder with the Lake Step's log, what it did and the Lake's status, and its diagnosis is recorded", async () => {
  prepare({ lake: 'failed', status: 'status.hold.json' })
  ws.setWorkerCli('claude', claudeCodeAnswering(answer))

  const result = await step()

  assert.equal(result.status, 0, result.stderr)
  const [call, ...more] = ws.workerCliCalls('claude')
  assert.deepEqual(more, [])
  assert.deepEqual(ws.workerCliCalls('codex'), [])
  assert.equal(realpathSync(call.cwd), realpathSync(ashNew))
  assert.equal(call.args[call.args.indexOf('--tools') + 1], 'Read,Grep,Glob,Bash', 'no tool that writes')
  assert.ok(!call.args.includes('--allowedTools'), 'nothing allowed beyond what Claude Code counts as read-only')
  const why = promptInput(call.stdin, 'why') as string[]
  assert.equal(why[0], 'The Lake Step failed.')
  assert.match(why[1], /^The Data gate failed: The last refresh \(job 482\) failed: YahooUnavailable/)
  assert.match(promptInput(call.stdin, 'lakeLog') as string, /pd daily failed; retrying once/)
  assert.deepEqual(
    (promptInput(call.stdin, 'lake') as { attempts: { exitCode: number }[] }).attempts.map((a) => a.exitCode),
    [1, 1],
  )
  assert.deepEqual(promptInput(call.stdin, 'status'), example('status.hold.json'))

  const recorded = health()
  assert.equal(recorded.status, 'diagnosed')
  assert.deepEqual(recorded.why, why)
  assert.equal(recorded.diagnosis, answer.diagnosis)
  assert.equal(recorded.fix, answer.fix)
  assert.deepEqual(recorded.evidence, answer.evidence)
})

test("after a Lake Step whose status couldn't be read, the Health Agent is told so", async () => {
  prepare({ lake: 'failed', status: null })
  ws.setWorkerCli('claude', claudeCodeAnswering(answer))

  const result = await step()

  assert.equal(result.status, 0, result.stderr)
  const [call] = ws.workerCliCalls('claude')
  assert.deepEqual(promptInput(call.stdin, 'why'), ['The Lake Step failed.', "The Lake's status couldn't be read."])
  assert.equal(promptInput(call.stdin, 'status'), null)
})

test('after a refresh that worked, a Health report that flags something still calls the Health Agent', async () => {
  prepare({ status: 'status.healthy.json' })
  ws.setWorkerCli('claude', claudeCodeAnswering(answer))

  const result = await step()

  assert.equal(result.status, 0, result.stderr)
  const [call] = ws.workerCliCalls('claude')
  assert.deepEqual(promptInput(call.stdin, 'why'), ['The Health report of 2026-10-27 has 5 flags.'])
  assert.equal(health().status, 'diagnosed')
})

test('a Health Agent that fails on Claude Code and then on Codex is recorded as failed, with both errors, and fails the Step', async () => {
  prepare({ lake: 'failed', status: 'status.hold.json' })
  ws.setWorkerCli('claude', { stderr: 'Claude Code is down\n', exitCode: 1 })
  ws.setWorkerCli('codex', { stdout: JSON.stringify({ type: 'turn.failed', error: { message: "You've hit your usage limit." } }), exitCode: 1 })

  const result = await step()

  assert.equal(result.status, 1)
  assert.equal(ws.workerCliCalls('codex').length, 1)
  assert.equal(ws.workerCliCalls('claude').length, 1)
  const recorded = health()
  assert.equal(recorded.status, 'failed')
  assert.equal(recorded.why[0], 'The Lake Step failed.')
  assert.match(recorded.error, /claude-code failed: Claude Code is down; then codex failed: You've hit your usage limit\./)
  assert.match(ws.readRunFile(runId, 'logs', 'health.log'), /health failed on claude-code[\s\S]*retrying once on codex[\s\S]*health failed on codex/)
})

test("a Health Step that can't find ash_new is recorded as failed, saying where it looked", async () => {
  prepare({ lake: 'failed', status: 'status.hold.json' })
  ws.writeEnvFile(`ASH_NEW_FOLDER=${join(ws.homeDir, 'nowhere')}\n`)

  const result = await step()

  assert.equal(result.status, 1)
  assert.deepEqual(ws.workerCliCalls('claude'), [])
  assert.match(health().error, /ash_new isn't at .*nowhere: set ASH_NEW_FOLDER in the env file/)
})

test('the Health Agent diagnoses once per Run unless forced, and again once the Lake Step has changed what it is given', async () => {
  prepare({ lake: 'failed', status: 'status.hold.json' })
  ws.setWorkerCli('claude', claudeCodeAnswering(answer))

  assert.equal((await step()).status, 0)
  assert.equal((await step()).status, 0)
  assert.equal(ws.workerCliCalls('claude').length, 1, 'the second run found the diagnosis already made')

  assert.equal((await step('--force')).status, 0)
  assert.equal(ws.workerCliCalls('claude').length, 2)

  ws.writeRunFile(runId, 'lake/status.json', example('status.healthy.json'))
  assert.equal((await step()).status, 0)
  assert.equal(ws.workerCliCalls('claude').length, 3, 'the Lake Step was re-run since')
})

test('a dry run diagnoses on the fake Worker', async () => {
  prepare({ lake: 'failed', status: 'status.hold.json', dryRun: true })
  ws.writeCannedAnswers({ health: [{ answer }] })

  const result = await step()

  assert.equal(result.status, 0, result.stderr)
  assert.deepEqual(ws.workerCliCalls('codex'), [])
  assert.equal(health().diagnosis, answer.diagnosis)
})
