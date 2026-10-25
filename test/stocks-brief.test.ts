import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, test } from 'node:test'
import { makeWorkspace, pdExamples, type Workspace } from './helpers.ts'

let ws: Workspace
afterEach(() => ws.cleanup())

const runId = '2026-10-27-0930'

/** A stocks Run whose Lake Step ended as `lake`, and its Health Step as `health` when given. */
function prepare({ lake = 'succeeded', health = undefined as string | undefined, dryRun = false } = {}) {
  ws = makeWorkspace()
  ws.prepareRun(runId, {
    pipeline: 'stocks',
    steps: [{ name: 'lake', status: lake }, ...(health ? [{ name: 'health', status: health }] : []), { name: 'brief', status: 'pending' }],
    dryRun,
  })
}

const example = (name: string) => readFileSync(join(pdExamples, name), 'utf8')
const lakeResult = (refreshed: boolean, exitCodes: number[]) => ({
  dryRun: false,
  cleared: { cleared: [], refused: null },
  attempts: exitCodes.map((exitCode) => ({ startedAt: '2026-10-27T01:12:00.000Z', endedAt: '2026-10-27T01:40:00.000Z', exitCode, timedOut: false })),
  refreshed,
})

async function brief(): Promise<string> {
  const result = await ws.agents('step', 'brief', '--run', runId)
  assert.equal(result.status, 0, result.stderr)
  return ws.readRunFile(runId, 'brief.html')
}

/** The page's text, without its markup, its spaces collapsed, so a test reads it as Saransh would. */
function text(html: string): string {
  return html
    .replace(/<head>[\s\S]*?<\/head>/, '')
    .replace(/<[^>]+>/g, ' ')
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>')
    .replaceAll('&#39;', "'")
    .replaceAll('&quot;', '"')
    .replaceAll('&amp;', '&')
    .replace(/\s+/g, ' ')
}

test("the Stocks Brief opens with the Data gate's verdict, then each market's latest session, the flags and Run health", async () => {
  prepare()
  ws.writeRunFile(runId, 'lake.json', lakeResult(true, [0]))
  ws.writeRunFile(runId, 'lake/status.json', example('status.healthy.json'))

  const page = text(await brief())

  assert.match(page, /^ ?Stocks Brief 2026-10-27-0930 Data gate: pass/)
  assert.match(page, /India 2026-10-26 2026-10-26 Up to date/)
  assert.match(page, /United States 2026-10-26 2026-10-26 Up to date/)
  assert.match(page, /Hong Kong 2026-10-23 2026-10-27 1 session behind \(not gated\)/)
  assert.match(page, /Refreshed with pd daily on the first try/)
  assert.match(page, /Health report of 2026-10-27: ok/)
  assert.match(page, /IN:DBEIL Deepak Builders & Engineers India Ltd cross_source 2026-08-18 MarketSmith closed at 178\.08, Yahoo at 6\.68 \(\+2565\.9%\)/)
  assert.match(page, /To-dos Nothing is waiting on you\./)
  assert.match(page, /Run health Run 2026-10-27-0930 of the stocks Pipeline\. No Step failed or was skipped\./)
  assert.ok(page.indexOf('Data gate') < page.indexOf('Markets'), 'the verdict comes first')
})

test('a Hold mode day shows why the Data gate failed, and the Lake Step that failed', async () => {
  prepare({ lake: 'failed' })
  ws.writeRunFile(runId, 'lake.json', lakeResult(false, [1, 1]))
  ws.writeRunFile(runId, 'lake/status.json', example('status.hold.json'))

  const page = text(await brief())

  assert.match(page, /Data gate: fail\. Nothing should be decided on this data:/)
  assert.match(page, /The last refresh \(job 482\) failed: YahooUnavailable: Yahoo answered 429/)
  assert.match(page, /United States: the lake is as of 2026-10-23, 1 session behind its last finished session, 2026-10-26/)
  assert.match(page, /United States 2026-10-23 2026-10-26 1 session behind/)
  assert.match(page, /pd daily failed twice \(exit 1, then exit 1\), so the Lake is as the last refresh left it/)
  assert.match(page, /The last refresh, job 482, failed: YahooUnavailable: Yahoo answered 429 Too Many Requests for 40 tickers in a row/)
  assert.match(page, /lake: failed\. Log: logs\/lake\.log/)
})

const diagnosis = {
  why: ['The Lake Step failed.'],
  inputs: 'f'.repeat(64),
  status: 'diagnosed',
  diagnosis: 'Yahoo rate-limited the price top-up, so both runs of pd daily stopped\nbefore the US prices were in.',
  fix: 'Run pd daily again after 10:00 IST, when the limit resets.',
  evidence: [
    { source: 'lakeLog', shows: 'Both runs stopped on "Yahoo answered 429"' },
    { source: 'data/logs/jobs/482.jsonl', shows: 'The job failed in prices-update' },
  ],
  corrections: [],
}

test("the Health Agent's diagnosis and proposed fix come right under the Data gate's verdict, with the evidence it read", async () => {
  prepare({ lake: 'failed', health: 'succeeded' })
  ws.writeRunFile(runId, 'lake.json', lakeResult(false, [1, 1]))
  ws.writeRunFile(runId, 'lake/status.json', example('status.hold.json'))
  ws.writeRunFile(runId, 'health.json', diagnosis)

  const html = await brief()
  const page = text(html)

  assert.match(
    page,
    /Data gate: fail\..*1 session behind its last finished session, 2026-10-26 Health Agent's diagnosis Yahoo rate-limited the price top-up, so both runs of pd daily stopped before the US prices were in\. Proposed fix, not applied Run pd daily again after 10:00 IST, when the limit resets\. Evidence it read: 2 items lakeLog ?: Both runs stopped on "Yahoo answered 429" data\/logs\/jobs\/482\.jsonl ?: The job failed in prices-update Corrections No Correction is waiting for your approval\. Quarantine No security is quarantined\. Markets/,
  )
  assert.match(html, /Health Agent's diagnosis<\/h2>\n<p class="text">Yahoo rate-limited the price top-up, so both runs of pd daily stopped\nbefore/, 'its line breaks are kept')
})

test('each Correction waiting for approval is listed with what it would change, then each Quarantine with its flag, by market', async () => {
  prepare()
  ws.writeRunFile(runId, 'lake.json', lakeResult(true, [0]))
  ws.writeRunFile(runId, 'lake/status.json', example('status.healthy.json'))

  const page = text(await brief())

  assert.match(
    page,
    /Corrections waiting for your approval: 1 Nothing is applied until you approve it\. In ash_new, pd corrections approve <id> adds one to the Corrections file.*Id Security Correction What it would change Why Proposed by 7 IN:BHAGYAPROP Bhagyanagar India <Ltd> No dividend on 2025-03-12 The dividend on 2025-03-12 dropped: the total-return index's move that day goes from \+122\.4% to -0\.1% A 12\.00 dividend on a 9\.80 close: BSE's corporate actions list no dividend that year, so Yahoo's is a <mistake> the Health Agent, Run 2026-10-26-0930 2026-10-26 01:52 UTC/,
  )
  assert.match(page, /Quarantine: 5 securities A security the Health report flagged is held out of every Book.*pd quarantines dismiss <id> in ash_new\./)
  assert.match(page, /Hong Kong: 1 security Id Security Name Flag Date Detail Since 5 HK:0083 stale 2026-10-16 6 sessions behind 2026-10-27/)
  assert.match(page, /India: 3 securities .* 4 IN:BHAGYAPROP Bhagyanagar India <Ltd> dividend 2025-03-12 A dividend of 12\.00 on a close of 9\.80 2026-10-27/)
  assert.match(page, /United States: 1 security .* 3 US:NFE New Fortress Energy Inc jump 2026-10-22/)
  assert.ok(page.indexOf('Corrections waiting') < page.indexOf('Quarantine:') && page.indexOf('Quarantine:') < page.indexOf('Markets'))
})

test("the Corrections the Health Agent recorded in this Run are listed as waiting, from the Lake's status read again after them", async () => {
  prepare({ health: 'succeeded' })
  ws.writeRunFile(runId, 'lake.json', lakeResult(true, [0]))
  ws.writeRunFile(runId, 'lake/status.json', example('status.clean.json'))
  ws.writeRunFile(runId, 'health/status.json', example('status.healthy.json'))

  const page = text(await brief())

  assert.match(page, /Corrections waiting for your approval: 1 .* 7 IN:BHAGYAPROP/)
  assert.match(page, /Quarantine: 5 securities/)
  assert.match(page, /Data gate: pass/)
})

test("what became of the Corrections the Health Agent proposed is said under its diagnosis", async () => {
  prepare({ health: 'succeeded' })
  ws.writeRunFile(runId, 'lake.json', lakeResult(true, [0]))
  ws.writeRunFile(runId, 'lake/status.json', example('status.healthy.json'))
  const proposed = JSON.parse(example('corrections-propose.recorded.json'))
  const corrections = [{ security_id: 'IN:BHAGYANGR', kind: 'split', date: '2026-10-08', ratio: 11.655, value: null, why: '-90.9%' }]
  ws.writeRunFile(runId, 'health.json', { ...diagnosis, corrections: [...corrections, ...corrections, ...corrections], proposals: { status: 'recorded', printed: proposed } })

  assert.match(text(await brief()), /Proposed fix, not applied .* It proposed 3 Corrections: 1 recorded, waiting for your approval, 1 proposed before, 1 refused by ash_new \(Value error, a split's ratio is shares after per share before: above 0, and not 1\)\./)

  ws.writeRunFile(runId, 'health.json', { ...diagnosis, corrections, proposals: { status: 'failed', error: 'pd corrections propose exited with 1: no database' } })
  assert.match(text(await ws.agents('step', 'brief', '--run', runId, '--force').then(() => ws.readRunFile(runId, 'brief.html'))), /It proposed 1 Correction, but they couldn't be recorded in ash_new: pd corrections propose exited with 1: no database/)
})

test('a Health Agent that failed is shown under the Data gate, with why and its log', async () => {
  prepare({ lake: 'failed', health: 'failed' })
  ws.writeRunFile(runId, 'lake/status.json', example('status.hold.json'))
  ws.writeRunFile(runId, 'health.json', { why: ['The Lake Step failed.'], inputs: 'f'.repeat(64), status: 'failed', error: "codex failed: You've hit your usage limit.; then claude-code failed: Claude Code is down" })

  const page = text(await brief())

  assert.match(
    page,
    /2026-10-26 Health Agent The Health Agent failed, so there is no diagnosis: codex failed: You've hit your usage limit\.; then claude-code failed: Claude Code is down\. See its log: logs\/health\.log Corrections /,
  )
  assert.match(page, /health: failed\. Log: logs\/health\.log/)
})

test('a Health Step that failed before recording anything is shown as a failed Health Agent', async () => {
  prepare({ lake: 'failed', health: 'failed' })
  ws.writeRunFile(runId, 'lake/status.json', example('status.hold.json'))

  const page = text(await brief())

  assert.match(page, /Health Agent The Health Agent failed before it recorded a diagnosis\. See its log: logs\/health\.log Corrections /)
})

test('a Health Step that failed before recording why shows no diagnosis an earlier run of it left', async () => {
  prepare({ lake: 'failed', health: 'failed' })
  ws.writeRunFile(runId, 'lake/status.json', example('status.hold.json'))
  ws.writeRunFile(runId, 'health.json', diagnosis)

  const page = text(await brief())

  assert.match(page, /Health Agent The Health Agent failed before it recorded a diagnosis\./)
  assert.doesNotMatch(page, /Yahoo rate-limited/)
})

test('a skipped Health Step adds nothing under the Data gate', async () => {
  prepare({ health: 'skipped' })
  ws.writeRunFile(runId, 'lake.json', lakeResult(true, [0]))
  ws.writeRunFile(runId, 'lake/status.json', example('status.clean.json'))

  const page = text(await brief())

  assert.doesNotMatch(page, /Health Agent/)
})

test("the Stocks Brief is written when the Lake Step failed before reading the Lake's status", async () => {
  prepare({ lake: 'failed' })

  const page = text(await brief())

  assert.match(page, /Data gate: unknown\. The Lake's status couldn't be read in this Run, so treat the data as failing the gate\. See the Lake Step's log: logs\/lake\.log/)
  assert.match(page, /lake: failed\. Log: logs\/lake\.log/)
})

test('the Stocks Brief lists the To-dos the Steps raised', async () => {
  prepare()
  ws.writeRunFile(runId, 'lake.json', lakeResult(true, [0]))
  ws.writeRunFile(runId, 'lake/status.json', example('status.schedule-on.json'))
  ws.writeRunFile(runId, 'todos/lake.json', ["ash_new's own schedule is on.", "ash_new's Windows task is registered."])

  const page = text(await brief())

  assert.match(page, /To-dos ash_new's own schedule is on\. \(lake\) ash_new's Windows task is registered\. \(lake\)/)
})

test('a dry run says the Lake was read as it is', async () => {
  prepare({ dryRun: true })
  ws.writeRunFile(runId, 'lake.json', { dryRun: true, cleared: null, attempts: [], refreshed: false })
  ws.writeRunFile(runId, 'lake/status.json', example('status.healthy.json'))

  const page = text(await brief())

  assert.match(page, /Dry run: the Lake was read as it is, not refreshed, and nothing was recorded in ash_new\./)
})

test('the Stocks Brief is one self-contained page that loads nothing from the internet', async () => {
  prepare()
  ws.writeRunFile(runId, 'lake.json', lakeResult(true, [0]))
  ws.writeRunFile(runId, 'lake/status.json', example('status.healthy.json'))

  const html = await brief()

  assert.match(html, /^<!doctype html>/)
  assert.doesNotMatch(html, /https?:|\/\/[a-z]/i, 'no address to fetch')
  assert.doesNotMatch(html, /<(script|link|img|iframe|object|embed)\b/i)
  assert.doesNotMatch(html, /@import|url\(/i)
  // A name from the Lake is shown as text, never as markup.
  assert.match(html, /Bhagyanagar India &lt;Ltd&gt;/)
})

test('the Stocks Brief is written once per Run unless forced', async () => {
  prepare()
  ws.writeRunFile(runId, 'lake/status.json', example('status.healthy.json'))
  await brief()
  ws.writeRunFile(runId, 'lake/status.json', example('status.hold.json'))

  assert.match(text(await brief()), /Data gate: pass/)
  assert.equal((await ws.agents('step', 'brief', '--run', runId, '--force')).status, 0)
  assert.match(text(ws.readRunFile(runId, 'brief.html')), /Data gate: fail/)
})
