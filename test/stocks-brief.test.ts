import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, test } from 'node:test'
import { makeWorkspace, pdExamples, type Workspace } from './helpers.ts'

let ws: Workspace
afterEach(() => ws.cleanup())

const runId = '2026-10-27-0930'

function prepare({ lake = 'succeeded', dryRun = false } = {}) {
  ws = makeWorkspace()
  ws.prepareRun(runId, {
    pipeline: 'stocks',
    steps: [
      { name: 'lake', status: lake },
      { name: 'brief', status: 'pending' },
    ],
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
