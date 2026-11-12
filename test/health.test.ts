import assert from 'node:assert/strict'
import { existsSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs'
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
  corrections: [] as unknown[],
  delistings: [] as unknown[],
}

/** The Corrections the Health Agent proposes for the known data issues, confident of neither. */
const corrections = [
  { security_id: 'IN:BHAGYANGR', kind: 'split', date: '2026-10-08', ratio: 11.655, value: null, why: 'A -90.9% close with no action recorded, its open about 1/11.7 of the close before', confident: false },
  { security_id: 'US:NFE', kind: 'dividend', date: '2023-01-03', ratio: null, value: null, why: 'A 150.00 dividend on a 42.42 close', confident: false },
]
/** The same, as `pd corrections propose` is given them: in the Corrections file's format. */
const asFiled = corrections.map(({ confident: _confident, ...change }) => change)
/** The same, the Agent confident of the split, which ash_new records (corrections-propose.recorded.json) as Correction 7. */
const confidentOfTheSplit = corrections.map((c) => ({ ...c, confident: c.kind === 'split' }))

/** What `codex exec --json` prints when its schema-checked answer is `answer`. */
const codexAnswering = (answer: unknown) => ({
  stdout: [
    { type: 'thread.started', thread_id: 'thread-1' },
    { type: 'item.completed', item: { id: 'item_1', type: 'agent_message', text: JSON.stringify(answer) } },
    { type: 'turn.completed', usage: { input_tokens: 900, output_tokens: 60 } },
  ]
    .map((event) => JSON.stringify(event))
    .join('\n'),
})

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

test("after a failed Lake Step, the Health Agent runs on Codex in ash_new's folder with the Lake Step's log, what it did and the Lake's status, and its diagnosis is recorded", async () => {
  prepare({ lake: 'failed', status: 'status.hold.json' })
  ws.setWorkerCli('codex', codexAnswering(answer))

  const result = await step()

  assert.equal(result.status, 0, result.stderr)
  const [call, ...more] = ws.workerCliCalls('codex')
  assert.deepEqual(more, [])
  assert.equal(ws.workerCliCalls('claude').length, 1, 'Claude Code attempts the independent assessment')
  assert.deepEqual(ws.workerCliCalls('agent'), [])
  assert.equal(realpathSync(call.cwd), realpathSync(ashNew))
  const permissions = call.args.find((arg) => arg.startsWith('permissions.agent='))
  assert.ok(permissions?.includes('extends=":read-only"'), 'read-only')
  assert.ok(!permissions?.includes('="write"'), 'no folder it may write')
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
  ws.setWorkerCli('codex', codexAnswering(answer))

  const result = await step()

  assert.equal(result.status, 0, result.stderr)
  const [call] = ws.workerCliCalls('codex')
  assert.deepEqual(promptInput(call.stdin, 'why'), ['The Lake Step failed.', "The Lake's status couldn't be read."])
  assert.equal(promptInput(call.stdin, 'status'), null)
})

test("a healthy Lake still calls the Health Agent when this Run's MarketSmith fetch went wrong, giving it the fetch", async () => {
  prepare({ status: 'status.clean.json' })
  ws.writeRunFile(runId, 'marketsmith.json', example('marketsmith.latest.json'))
  ws.setWorkerCli('codex', codexAnswering(answer))

  const result = await step()

  assert.equal(result.status, 0, result.stderr)
  const [call] = ws.workerCliCalls('codex')
  assert.deepEqual(promptInput(call.stdin, 'why'), [
    "MarketSmith's latest fetch of the US couldn't read its results calendar: NASDAQ's earnings calendar couldn't be read: 2026-10-27 (answered 403)",
    "MarketSmith's last fetch of Hong Kong had 3 symbols whose files weren't whole.",
    "MarketSmith's backup 2026-11-09T02-28-57Z of Hong Kong wasn't whole, so it was removed: not whole: 00700/summary.json is cut short",
  ])
  assert.deepEqual(promptInput(call.stdin, 'marketsmith'), example('marketsmith.latest.json'))
  assert.equal(health().status, 'diagnosed')
})

test('a MarketSmith fetch that went well, or none, leaves a healthy Lake undiagnosed', async () => {
  prepare({ status: 'status.clean.json' })
  ws.writeRunFile(runId, 'marketsmith.json', example('marketsmith.fetched.json'))

  const result = await step()

  assert.equal(result.status, 0, result.stderr)
  assert.deepEqual(ws.workerCliCalls('codex'), [])
  assert.match(ws.readRunFile(runId, 'logs', 'health.log'), /Skipped: The Lake is healthy: .*MarketSmith's fetch, if any, went well/)
})

test('after a refresh that worked, a Health report with new flags, or a problem with a whole market, still calls the Health Agent', async () => {
  prepare({ status: 'status.healthy.json' })
  ws.setWorkerCli('codex', codexAnswering(answer))

  const result = await step()

  assert.equal(result.status, 0, result.stderr)
  const [call] = ws.workerCliCalls('codex')
  assert.deepEqual(promptInput(call.stdin, 'why'), [
    "The Health report of 2026-10-27 names a problem with HK's data: The data is 1 session behind its last finished session, 2026-10-27",
    'The Health report of 2026-10-27 has 5 new flags (5 in all).',
  ])
  // Every flag is new, so none is left out of what the Agent is given.
  assert.deepEqual(promptInput(call.stdin, 'status'), example('status.healthy.json'))
  assert.equal(promptInput(call.stdin, 'leftOut'), null)
  assert.equal(health().status, 'diagnosed')
})

/** The healthy Lake's status a week on: the same five flags, quarantined by an earlier Run's Health report, and no market with a problem. */
function diagnosedBefore() {
  const status = example('status.healthy.json')
  status.health.markets = status.health.markets.map((m: { market: string }) => ({ ...m, status: 'ok', problems: [] }))
  for (const quarantine of status.quarantines) quarantine.since = '2026-10-20'
  return status
}

/** Keeps `names` as the last Run's watched names: what its plans held or might trade. */
function watch(...names: string[]) {
  mkdirSync(join(ws.dataDir, 'state'), { recursive: true })
  writeFileSync(join(ws.dataDir, 'state', 'watched.json'), JSON.stringify({ run: '2026-10-24-0930', names }))
}

test('flags an earlier Run diagnosed, on securities no Book holds or may trade, leave the Health Agent uncalled', async () => {
  prepare()
  ws.writeRunFile(runId, 'lake/status.json', diagnosedBefore())
  watch('IN:RELIANCE')

  const result = await step()

  assert.equal(result.status, 0, result.stderr)
  assert.equal(ws.readRun(runId).steps.find((s) => s.name === 'health')!.status, 'skipped')
  assert.deepEqual(ws.workerCliCalls('codex'), [])
  assert.match(
    ws.readRunFile(runId, 'logs', 'health.log'),
    /Skipped: The Lake is healthy: the Lake Step succeeded, the Data gate passed, the Health report's 5 flags were diagnosed in earlier Runs and none is on a security the Books hold or may trade and MarketSmith's fetch, if any, went well/,
  )
})

test('an old flag on a security the Books hold or may trade calls the Health Agent, which is given that flag and told how many were left out', async () => {
  prepare()
  ws.writeRunFile(runId, 'lake/status.json', diagnosedBefore())
  // The last Run's plans might trade New Fortress Energy; the India Book holds Mcnally Bharat at ICICI Direct.
  watch('US:NFE')
  ws.writeRunFile(runId, 'broker-inbox.json', { dryRun: false, files: [], books: { books: [{ book: 'IN', holdings: [{ security_id: 'IN:MBECL' }] }] }, missingTradebooks: [] })
  ws.setWorkerCli('codex', codexAnswering(answer))

  const result = await step()

  assert.equal(result.status, 0, result.stderr)
  const [call] = ws.workerCliCalls('codex')
  assert.deepEqual(promptInput(call.stdin, 'why'), ['2 flags are on 2 securities the Books hold or may trade: IN:MBECL, US:NFE.'])
  const given = promptInput(call.stdin, 'status') as { health: { flags: { security_id: string }[] }; quarantines: { security_id: string }[]; corrections: unknown[] }
  assert.deepEqual(given.health.flags.map((f) => f.security_id), ['IN:MBECL', 'US:NFE'])
  assert.deepEqual(given.quarantines.map((q) => q.security_id).sort(), ['IN:MBECL', 'US:NFE'])
  assert.equal(given.corrections.length, 1, 'the Corrections waiting are all given')
  assert.deepEqual(promptInput(call.stdin, 'leftOut'), { flags: 3, quarantines: 3 })
})

test("a security the Lake has had no price for in over 10 sessions calls the Health Agent until it has been looked up, and again a week after nothing was found", async () => {
  const stale = (behind: string) => {
    const status = diagnosedBefore()
    status.health.flags.find((f: { check: string }) => f.check === 'stale').detail = behind
    return status
  }
  prepare()
  ws.setWorkerCli('codex', codexAnswering(answer))

  // Six sessions behind isn't looked up yet.
  ws.writeRunFile(runId, 'lake/status.json', stale('6 sessions behind'))
  assert.equal((await step()).status, 0)
  assert.deepEqual(ws.workerCliCalls('codex'), [])

  ws.writeRunFile(runId, 'lake/status.json', stale('31 sessions behind'))
  assert.equal((await step()).status, 0)
  const [call] = ws.workerCliCalls('codex')
  assert.deepEqual(promptInput(call.stdin, 'why'), ["1 security the Lake no longer gets prices for hasn't been looked up."])
  assert.deepEqual((promptInput(call.stdin, 'status') as { health: { flags: { security_id: string }[] } }).health.flags.map((f) => f.security_id), ['HK:0083'])

  // Looked up and found delisted: not again. Nothing found out a day ago: not yet; over a week ago: again.
  const known = (status: string, run: string) =>
    writeFileSync(join(ws.dataDir, 'state', 'delistings.json'), JSON.stringify({ 'HK:0083': { security_id: 'HK:0083', status, date: null, successor: null, why: '', source: '', run } }))
  mkdirSync(join(ws.dataDir, 'state'), { recursive: true })
  known('delisted', '2026-10-01-0930')
  assert.equal((await step('--force')).status, 0)
  known('unknown', '2026-10-26-0930')
  assert.equal((await step('--force')).status, 0)
  assert.equal(ws.workerCliCalls('codex').length, 1)
  known('unknown', '2026-10-15-0930')
  assert.equal((await step('--force')).status, 0)
  assert.equal(ws.workerCliCalls('codex').length, 2)
})

test("a second source's gap is always among the Quarantines the Health Agent is given", async () => {
  prepare()
  const status = diagnosedBefore()
  status.quarantines.push({ id: 9, market: 'US', security_id: 'US:^GSPC', name: 'S&P 500 (^GSPC)', check: 'second_source', date: '2026-10-26', detail: "The lake closed at 7,000.00 on 2026-10-26, Tencent's daily bars at 6,510.00 (-7.0%)", since: '2026-10-27', lifted_by: null, lifted_at: null, correction_id: null })
  status.gate = { verdict: 'fail', reasons: ["United States: its index, the S&P 500 (^GSPC), is quarantined: The lake closed at 7,000.00 on 2026-10-26, Tencent's daily bars at 6,510.00 (-7.0%)"] }
  ws.writeRunFile(runId, 'lake/status.json', status)
  ws.setWorkerCli('codex', codexAnswering(answer))

  assert.equal((await step()).status, 0)

  const [call] = ws.workerCliCalls('codex')
  assert.match((promptInput(call.stdin, 'why') as string[])[0], /^The Data gate failed: United States: its index, the S&P 500 \(\^GSPC\), is quarantined/)
  const given = promptInput(call.stdin, 'status') as { health: { flags: unknown[] }; quarantines: { security_id: string }[] }
  assert.deepEqual(given.health.flags, [])
  assert.deepEqual(given.quarantines.map((q) => q.security_id), ['US:^GSPC'])
  assert.deepEqual(promptInput(call.stdin, 'leftOut'), { flags: 5, quarantines: 5 })
})

test('a Health Agent that fails on Codex and then on Cursor is recorded as failed, with both errors, and fails the Step', async () => {
  prepare({ lake: 'failed', status: 'status.hold.json' })
  ws.setWorkerCli('agent', { stderr: 'Cursor is down\n', exitCode: 1 })
  ws.setWorkerCli('codex', { stdout: JSON.stringify({ type: 'turn.failed', error: { message: "You've hit your usage limit." } }), exitCode: 1 })

  const result = await step()

  assert.equal(result.status, 1)
  assert.equal(ws.workerCliCalls('codex').length, 1)
  assert.equal(ws.workerCliCalls('agent').length, 1, 'main fallback only; Claude Code is the adversary')
  assert.equal(ws.workerCliCalls('claude').length, 1)
  const recorded = health()
  assert.equal(recorded.status, 'failed')
  assert.equal(recorded.why[0], 'The Lake Step failed.')
  assert.match(recorded.error, /codex failed: You've hit your usage limit\.; then cursor failed: Cursor is down/)
  assert.match(ws.readRunFile(runId, 'logs', 'health.log'), /health failed on codex[\s\S]*retrying once on cursor[\s\S]*health failed on cursor/)
})

test("a Health Step that can't find ash_new is recorded as failed, saying where it looked", async () => {
  prepare({ lake: 'failed', status: 'status.hold.json' })
  ws.writeEnvFile(`ASH_NEW_FOLDER=${join(ws.homeDir, 'nowhere')}\n`)

  const result = await step()

  assert.equal(result.status, 1)
  assert.deepEqual(ws.workerCliCalls('codex'), [])
  assert.deepEqual(ws.workerCliCalls('claude'), [])
  assert.match(health().error, /ash_new isn't at .*nowhere: set ASH_NEW_FOLDER in the env file/)
})

test('the Health Agent diagnoses once per Run unless forced, and again once the Lake Step has changed what it is given', async () => {
  prepare({ lake: 'failed', status: 'status.hold.json' })
  ws.setWorkerCli('codex', codexAnswering(answer))

  assert.equal((await step()).status, 0)
  assert.equal((await step()).status, 0)
  assert.equal(ws.workerCliCalls('codex').length, 1, 'the second run found the diagnosis already made')

  assert.equal((await step('--force')).status, 0)
  assert.equal(ws.workerCliCalls('codex').length, 2)

  ws.writeRunFile(runId, 'lake/status.json', example('status.healthy.json'))
  assert.equal((await step()).status, 0)
  assert.equal(ws.workerCliCalls('codex').length, 3, 'the Lake Step was re-run since')
})

test('a dry run diagnoses on the fake Worker', async () => {
  prepare({ lake: 'failed', status: 'status.hold.json', dryRun: true })
  ws.writeCannedAnswers({ health: [{ answer }] })

  const result = await step()

  assert.equal(result.status, 0, result.stderr)
  assert.deepEqual(ws.workerCliCalls('codex'), [])
  assert.equal(health().diagnosis, answer.diagnosis)
})

test('the Corrections the Health Agent proposes are recorded in ash_new to wait for approval, and health.json says what became of them', async () => {
  prepare({ status: 'status.healthy.json' })
  ws.setWorkerCli('codex', codexAnswering({ ...answer, corrections }))
  ws.setPd({ corrections: { example: 'corrections-propose.recorded.json' }, status: { example: 'status.healthy.json' } })

  const result = await step()

  assert.equal(result.status, 0, result.stderr)
  const [call, reread, ...more] = ws.pdCalls()
  assert.deepEqual(more, [])
  assert.deepEqual(reread.args, ['status'], "the Lake's status is read again, with them waiting")
  assert.deepEqual(JSON.parse(ws.readRunFile(runId, 'health', 'status.json')), example('status.healthy.json'))
  const file = call.args[2]
  assert.deepEqual([...call.args.slice(0, 2), ...call.args.slice(3)], ['corrections', 'propose', '--by', `the Health Agent, Run ${runId}`])
  assert.deepEqual(JSON.parse(readFileSync(file, 'utf8')), { corrections: asFiled }, "without `confident`, which the Corrections file doesn't have")
  assert.deepEqual(JSON.parse(ws.readRunFile(runId, 'health', 'corrections.json')), { corrections: asFiled }, 'kept in the Run folder')
  const recorded = health()
  assert.deepEqual(recorded.corrections, corrections)
  assert.deepEqual(recorded.proposals, { status: 'recorded', printed: example('corrections-propose.recorded.json') })
  assert.match(ws.readRunFile(runId, 'logs', 'health.log'), /Corrections: 1 recorded, waiting for approval; 1 proposed before; 1 refused/)
})

test('a diagnosis with no Corrections records none in ash_new', async () => {
  prepare({ status: 'status.healthy.json' })
  ws.setWorkerCli('codex', codexAnswering(answer))

  assert.equal((await step()).status, 0)
  assert.deepEqual(ws.pdCalls(), [])
  assert.equal(health().proposals, undefined)
})

test("Corrections that can't be recorded fail the Step, keeping the diagnosis, and a re-run records them without asking the Agent again", async () => {
  prepare({ status: 'status.healthy.json' })
  ws.setWorkerCli('codex', codexAnswering({ ...answer, corrections }))
  ws.setPd({ corrections: [{ stderr: 'database is locked', exitCode: 1 }, { example: 'corrections-propose.recorded.json' }] })

  const failed = await step()

  assert.equal(failed.status, 1)
  assert.equal(health().diagnosis, answer.diagnosis)
  assert.equal(health().proposals.status, 'failed')
  assert.match(health().proposals.error, /pd corrections propose .* exited with 1: database is locked/)

  assert.equal((await step()).status, 0)
  assert.equal(ws.workerCliCalls('codex').length, 1, 'the diagnosis is kept')
  assert.deepEqual(ws.pdCalls().map((call) => call.args[0]), ['corrections', 'corrections', 'status'])
  assert.equal(health().proposals.status, 'recorded')
})

test('a dry run records no Correction in ash_new', async () => {
  prepare({ lake: 'failed', status: 'status.hold.json', dryRun: true })
  ws.writeCannedAnswers({ health: [{ answer: { ...answer, corrections } }] })

  assert.equal((await step()).status, 0)
  assert.deepEqual(ws.pdCalls(), [])
  assert.deepEqual(health().proposals, { status: 'dry-run' })
})

test('a Correction the Health Agent is confident of is approved in its name and applied in the same Run, and the one it is not confident of waits', async () => {
  prepare({ status: 'status.healthy.json' })
  ws.setWorkerCli('codex', codexAnswering({ ...answer, corrections: confidentOfTheSplit }))
  ws.setPd({
    corrections: [{ example: 'corrections-propose.recorded.json' }, { example: 'corrections-decide.approved.json' }, { stdout: 'US prices: building again 1 securities whose Corrections changed\n' }],
    status: { example: 'status.clean.json' },
  })

  const result = await step()

  assert.equal(result.status, 0, result.stderr)
  assert.deepEqual(
    ws.pdCalls().map((call) => call.args.filter((arg) => !arg.endsWith('corrections.json'))),
    [['corrections', 'propose', '--by', `the Health Agent, Run ${runId}`], ['corrections', 'approve', '7', '--by', `the Health Agent, Run ${runId}`], ['corrections', 'apply'], ['status']],
    'proposed, the confident one approved, applied, then the status read again',
  )
  const split = { id: 7, security_id: 'IN:BHAGYANGR', kind: 'split', date: '2026-10-08', ratio: 11.655, value: null }
  assert.deepEqual(health().proposals.approvals, { approved: [split], left: [], applied: 'applied', standing: [] })
  assert.deepEqual(JSON.parse(ws.readRunFile(runId, 'todos', 'health.json')), [], 'nothing is left for Saransh to do about it')
  const log = ws.readRunFile(runId, 'logs', 'health.log')
  assert.match(log, /Approved by the Health Agent, confident of it: Correction 7, IN:BHAGYANGR, split on 2026-10-08/)
  assert.match(log, /building again 1 securities whose Corrections changed/, "pd corrections apply's output is in the Step's log")
  assert.match(log, /Applied to the Lake's prices in this Run/)
})

test('a confident Correction on a security a Book holds or may trade waits for Saransh', async () => {
  prepare({ status: 'status.healthy.json' })
  watch('IN:BHAGYANGR')
  ws.setWorkerCli('codex', codexAnswering({ ...answer, corrections: confidentOfTheSplit }))
  ws.setPd({ corrections: { example: 'corrections-propose.recorded.json' }, status: { example: 'status.healthy.json' } })

  assert.equal((await step()).status, 0)

  assert.deepEqual(ws.pdCalls().map((call) => call.args.slice(0, 2).join(' ')), ['corrections propose', 'status'], 'neither approved nor applied')
  const { approved, left, applied } = health().proposals.approvals
  assert.deepEqual([approved, applied], [[], null])
  assert.deepEqual(left.map((c: { id: number; why: string }) => [c.id, c.why]), [[7, 'a Book holds or may trade its security, so it is yours to approve']])
})

test('HEALTH_AUTO_APPROVE=false leaves every confident Correction waiting', async () => {
  prepare({ status: 'status.healthy.json' })
  ws.writeEnvFile(`ASH_NEW_FOLDER=${ashNew}\nHEALTH_AUTO_APPROVE=false\n`)
  ws.setWorkerCli('codex', codexAnswering({ ...answer, corrections: confidentOfTheSplit }))
  ws.setPd({ corrections: { example: 'corrections-propose.recorded.json' }, status: { example: 'status.healthy.json' } })

  assert.equal((await step()).status, 0)

  assert.deepEqual(ws.pdCalls().map((call) => call.args.slice(0, 2).join(' ')), ['corrections propose', 'status'])
  assert.match(health().proposals.approvals.left[0].why, /HEALTH_AUTO_APPROVE is false/)
})

test("an approval that can't be applied doesn't fail the Step: a To-do says no Rule plan trades its security until it is", async () => {
  prepare({ status: 'status.healthy.json' })
  ws.setWorkerCli('codex', codexAnswering({ ...answer, corrections: confidentOfTheSplit }))
  ws.setPd({
    corrections: [{ example: 'corrections-propose.recorded.json' }, { example: 'corrections-decide.approved.json' }, { stderr: 'Not started: a refresh is running', exitCode: 1 }],
    status: { example: 'status.healthy.json' },
  })

  const result = await step()

  assert.equal(result.status, 0, result.stderr)
  const { approved, applied, error } = health().proposals.approvals
  assert.deepEqual([approved.length, applied, error], [1, 'failed', 'pd corrections apply exited with 1'])
  const [todo, ...more] = JSON.parse(ws.readRunFile(runId, 'todos', 'health.json')) as string[]
  assert.deepEqual(more, [])
  assert.match(todo, /^The Health Agent approved Correction 7 \(IN:BHAGYANGR\), but they couldn't be applied to the Lake's prices in this Run \(pd corrections apply exited with 1\)\. No Rule plan trades their securities until they are/)
})

test('a Correction applied whose flag still stands is a To-do', async () => {
  prepare({ status: 'status.healthy.json' })
  ws.setWorkerCli('codex', codexAnswering({ ...answer, corrections: confidentOfTheSplit }))
  // The status read after applying still flags the split's day.
  const stillFlagged = example('status.healthy.json')
  stillFlagged.health.flags = [{ market: 'IN', security_id: 'IN:BHAGYANGR', name: 'Bhagyanagar India Ltd', check: 'jump', date: '2026-10-08', detail: 'Closed at 41.40 after 454.55 (-90.9%)' }]
  ws.setPd({
    corrections: [{ example: 'corrections-propose.recorded.json' }, { example: 'corrections-decide.approved.json' }, { stdout: '' }],
    status: { stdout: JSON.stringify(stillFlagged) },
  })

  assert.equal((await step()).status, 0)

  assert.deepEqual(health().proposals.approvals.standing, ['IN:BHAGYANGR: jump on 2026-10-08'])
  assert.match(JSON.parse(ws.readRunFile(runId, 'todos', 'health.json'))[0], /its flag still stands \(IN:BHAGYANGR: jump on 2026-10-08\): check it\. To undo it, remove its entry from ash_new's config\/corrections\.yaml/)
})

test('more confident Corrections at once than the Step may approve by itself all wait', async () => {
  prepare({ status: 'status.healthy.json' })
  const many = Array.from({ length: 11 }, (_, i) => ({ security_id: `US:S${i}`, kind: 'split', date: '2026-10-08', ratio: 2, value: null, why: 'The filing', confident: true }))
  const recorded = many.map(({ confident: _confident, ...c }, i) => ({ ...c, id: 20 + i, market: 'US', status: 'waiting', proposed_by: 'the Health Agent', proposed_at: '2026-10-27T01:52:10+00:00', decided_at: null, decided_by: null }))
  ws.setWorkerCli('codex', codexAnswering({ ...answer, corrections: many }))
  ws.setPd({ corrections: { stdout: JSON.stringify({ recorded, known: [], refused: [] }) }, status: { example: 'status.healthy.json' } })

  assert.equal((await step()).status, 0)

  assert.deepEqual(ws.pdCalls().map((call) => call.args.slice(0, 2).join(' ')), ['corrections propose', 'status'])
  const { approved, left } = health().proposals.approvals
  assert.deepEqual([approved.length, left.length], [0, 11])
  assert.match(left[0].why, /confident of 11 at once, over the 10 it may approve by itself in a Run/)
})

test('the Health Step honors --worker without moving its Claude Code adversary', async () => {
  prepare({ lake: 'failed', status: 'status.hold.json' })
  ws.writeRunFile(runId, 'run.json', { ...ws.readRun(runId), worker: 'cursor' })
  ws.setWorkerCli('agent', { stdout: JSON.stringify({ subtype: 'success', result: JSON.stringify(answer) }) })
  assert.equal((await step()).status, 0)
  assert.deepEqual(ws.workerCliCalls('codex'), [])
  assert.equal(ws.workerCliCalls('agent').length, 1)
  assert.equal(ws.workerCliCalls('claude').length, 1)
  assert.equal(health().adversary.mainWorker.name, 'cursor')
  assert.equal(health().adversary.worker.name, 'claude-code')
})

test("what the Health Agent finds out about securities no longer priced is kept, given to a later Run's Agent, and searched for on the web", async () => {
  prepare({ status: 'status.healthy.json' })
  const found = [
    { security_id: 'US:AVB', status: 'renamed', date: '2026-08-17', successor: 'US:VMRK', why: 'Merged with Equity Residential into Vivmark Residential: 2.793 VMRK shares for each AVB share', source: 'https://www.sec.gov/Archives/edgar/data/0000906107/000119312526448699/vmrk-ex99_1.htm' },
    { security_id: 'US:WBS', status: 'delisted', date: '2026-08-20', successor: null, why: 'Bought by Banco Santander for 2.0548 ADSs and $48.75 a share', source: 'https://www.sec.gov/Archives/edgar/data/0000801337/000087666126000696/ruleprovisionnotice.htm' },
  ]
  ws.setWorkerCli('codex', codexAnswering({ ...answer, delistings: found }))

  assert.equal((await step()).status, 0)

  const [first] = ws.workerCliCalls('codex')
  assert.deepEqual(promptInput(first.stdin, 'delistings'), {}, 'nothing looked up before')
  assert.ok(first.args.includes('web_search="live"'), 'it may search the web')
  assert.deepEqual(health().delistings, found)
  const kept = JSON.parse(readFileSync(join(ws.dataDir, 'state', 'delistings.json'), 'utf8'))
  assert.deepEqual(kept, Object.fromEntries(found.map((d) => [d.security_id, { ...d, run: runId }])))
  assert.match(ws.readRunFile(runId, 'logs', 'health.log'), /Looked up 2 securities the Lake no longer gets prices for: 1 delisted, 1 renamed/)

  assert.equal((await step('--force')).status, 0)
  const [, second] = ws.workerCliCalls('codex')
  assert.deepEqual(promptInput(second.stdin, 'delistings'), kept, 'a later call is told what is known, so it looks each up once')
})

test('a dry run keeps none of what the Health Agent finds out about securities no longer priced', async () => {
  prepare({ status: 'status.healthy.json', dryRun: true })
  ws.writeCannedAnswers({ health: [{ answer: { ...answer, delistings: [{ security_id: 'US:LEG', status: 'delisted', date: '2026-08-26', successor: null, why: 'Bought by Somnigroup', source: 'EDGAR 8-K' }] } }] })

  assert.equal((await step()).status, 0)

  assert.equal(existsSync(join(ws.dataDir, 'state', 'delistings.json')), false)
  assert.match(ws.readRunFile(runId, 'logs', 'health.log'), /Dry run: what it found isn't kept for later Runs/)
})
