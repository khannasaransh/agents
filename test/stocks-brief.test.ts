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
    .replace(/<script\b[\s\S]*?<\/script>/g, '')
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

test("on a Saturday the Brief says what MarketSmith's fetch brought, region by region, and says nothing of it on other days", async () => {
  prepare()
  ws.writeRunFile(runId, 'lake.json', lakeResult(true, [0]))
  ws.writeRunFile(runId, 'lake/status.json', example('status.healthy.json'))
  ws.writeRunFile(runId, 'marketsmith.json', JSON.parse(example('marketsmith.rejected.json')))

  const page = text(await brief())

  assert.match(page, /MarketSmith India wasn't fetched: MarketSmith India answered 403: the token has expired, or this IP is blocked\. The US: fetched 5969 of 5971, snapshot US:2026-10-31; 2 failed\. Hong Kong: fetched 2440 of 2447, snapshot HK:2026-10-31; 7 MarketSmith has nothing for\. The Lake/)

  ws.cleanup()
  prepare()
  ws.writeRunFile(runId, 'lake/status.json', example('status.healthy.json'))
  assert.doesNotMatch(text(await brief()), /MarketSmith (India|The US)/)
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
    /Corrections waiting for your approval: 1 Nothing is applied until you approve it\. Approve or reject each, then Save answers: the next Run records your Answers in ash_new before it refreshes the Lake\..*Id Security Correction What it would change Why Proposed by Your Answer 7 IN:BHAGYAPROP Bhagyanagar India <Ltd> No dividend on 2025-03-12 The dividend on 2025-03-12 dropped: the total-return index's move that day goes from \+122\.4% to -0\.1% A 12\.00 dividend on a 9\.80 close: BSE's corporate actions list no dividend that year, so Yahoo's is a <mistake> the Health Agent, Run 2026-10-26-0930 2026-10-26 01:52 UTC Approve Reject/,
  )
  assert.match(page, /Quarantine: 5 securities A security the Health report flagged is held out of every Book.*you dismiss its flag as a false alarm: Dismiss it, then Save answers\./)
  assert.match(page, /Hong Kong: 1 security Id Security Name Flag Date Detail Since Your Answer 5 HK:0083 stale 2026-10-16 6 sessions behind 2026-10-27 Dismiss/)
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
  assert.doesNotMatch(html, /<(link|img|iframe|object|embed)\b/i)
  assert.doesNotMatch(html, /<script\b[^>]*\bsrc\b/i, 'its script is in the page')
  assert.doesNotMatch(html, /\b(fetch|XMLHttpRequest|WebSocket|import)\s*\(/, 'its script asks nothing of a server')
  assert.doesNotMatch(html.match(/<style>[\s\S]*?<\/style>/)![0], /@import|url\(/i, 'its style fetches nothing')
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

test('each item waiting on Saransh has its id and a button for each of its Answers, and the page has a Save answers button', async () => {
  prepare()
  ws.writeRunFile(runId, 'lake/status.json', example('status.healthy.json'))

  const html = await brief()

  const items = [...html.matchAll(/<div class="answer" data-item="([^"]+)">(.*?)<\/div>/g)].map(([, item, cell]) => [item, [...cell.matchAll(/data-answer="([^"]+)"/g)].map(([, answer]) => answer)])
  assert.deepEqual(items, [
    ['correction:7', ['approve', 'reject']],
    ['quarantine:5', ['dismiss']],
    ['quarantine:4', ['dismiss']],
    ['quarantine:1', ['dismiss']],
    ['quarantine:2', ['dismiss']],
    ['quarantine:3', ['dismiss']],
  ])
  assert.match(html, /<button type="button" id="save-answers" disabled>Save answers<\/button>/)
  assert.deepEqual(JSON.parse(html.match(/<script type="application\/json" id="answer-items">(.*?)<\/script>/)![1]), items.map(([item, answers]) => ({ item, answers })))
})

test('a Brief with nothing waiting on Saransh has no Save answers button', async () => {
  prepare()
  ws.writeRunFile(runId, 'lake/status.json', example('status.clean.json'))

  const html = await brief()

  assert.doesNotMatch(html, /Save answers|<script/)
})

test("the Stocks Brief says what became of the Answers this Run applied, each with why it was ignored", async () => {
  prepare()
  ws.writeRunFile(runId, 'lake/status.json', example('status.clean.json'))
  ws.writeRunFile(runId, 'answers.json', {
    dryRun: false,
    files: [
      {
        file: 'stocks-answers-2026-10-26-0930-20261026031000.json',
        from: 'C:\\Users\\saransh\\Downloads',
        movedTo: 'answers/stocks-answers-2026-10-26-0930-20261026031000.json',
        run: '2026-10-26-0930',
        savedAt: '2026-10-26T03:10:00.000Z',
        answers: [
          { item: 'correction:7', answer: 'approve', note: 'Matches <BSE>', outcome: 'applied' },
          { item: 'quarantine:5', answer: 'dismiss', outcome: 'ignored', why: 'Quarantine 5 was corrected already' },
        ],
      },
    ],
  })

  const page = text(await brief())

  assert.match(
    page,
    /Your Answers 1 of your 2 Answers applied, 1 ignored\. Each Answer, by file, oldest first stocks-answers-2026-10-26-0930-20261026031000\.json, saved at 2026-10-26 03:10 UTC from the Brief of Run 2026-10-26-0930: Correction 7: approve, applied \(your note: Matches <BSE>\) Quarantine 5: dismiss, ignored: Quarantine 5 was corrected already/,
  )
  assert.ok(page.indexOf('Your Answers') < page.indexOf('Corrections'))

  ws.writeRunFile(runId, 'answers.json', { dryRun: false, files: [] })
  assert.match(text(await ws.agents('step', 'brief', '--run', runId, '--force').then(() => ws.readRunFile(runId, 'brief.html'))), /Your Answers No Answers file was waiting in Downloads or the Broker inbox\./)
})

test("the Stocks Brief shows the India Book's holdings and value, Reconciliation's differences and the Broker inbox's files", async () => {
  prepare()
  ws.writeRunFile(runId, 'lake/status.json', example('status.clean.json'))
  const imported = JSON.parse(example('broker-import.recorded.json'))
  ws.writeRunFile(runId, 'broker-inbox.json', {
    dryRun: false,
    files: imported.files.map((f: { file: string }) => ({ ...f, movedTo: `broker-inbox/${f.file}`, setAside: null })),
    books: JSON.parse(example('book-holdings.india.json')),
  })

  const page = text(await brief())

  assert.match(page, /India Book ₹1,52,180 at ICICI Direct on the closes of 2026-10-30, ₹9,580 of it in cash\./)
  assert.match(page, /Security Name Shares Average cost Close Value IN:ASIANPAINT Asian Paints Ltd 40 ₹1,415\.71 ₹1,400\.00 on 2026-10-30 ₹56,000/)
  assert.match(page, /Reconciled with 7500057272_Demat\.csv, ICICI Direct's holdings of 2026-10-31: 3 match, and these 5 differ, each a To-do until a later holdings export settles it:/)
  assert.match(page, /Delhivery Ltd \(IN:DELHIVERY\) 30 48 ICICI Direct holds 48 of Delhivery Ltd \(IN:DELHIVERY\), its ledger 30\. Drop the tradebook with the missing buys in the Broker inbox\./)
  assert.match(page, /NEW LISTING LTD \(ISIN INE000Z01010\) — 10 ICICI Direct holds 10/)
  assert.match(page, /This Run's Broker inbox files orderBook_Equity_1\.csv: ICICI Direct's tradebook, 6 trades recorded in the India Book, 1 in its ledger already 7500057272_Demat\.csv: ICICI Direct's holdings of 2026-10-31/)
  assert.ok(page.indexOf('To-dos') < page.indexOf('India Book ₹'), 'after what is waiting on Saransh')
})

test("the Stocks Brief shows the US Book in dollars at moomoo, with its positions' Reconciliation", async () => {
  prepare()
  ws.writeRunFile(runId, 'lake/status.json', example('status.clean.json'))
  const imported = JSON.parse(example('broker-import.moomoo.json'))
  ws.writeRunFile(runId, 'broker-inbox.json', {
    dryRun: false,
    files: imported.files.map((f: { file: string }) => ({ ...f, movedTo: `broker-inbox/${f.file}`, setAside: null })),
    books: JSON.parse(example('book-holdings.books.json')),
  })

  const page = text(await brief())

  assert.ok(page.indexOf('India Book ₹') < page.indexOf('US Book $'), 'India first')
  assert.match(page, /US Book \$10,193 at moomoo on the closes of 2026-08-14, \$3 of it in cash\./)
  assert.match(page, /US:ENPH Enphase Energy 1200 \$4\.46 \$4\.50 on 2026-08-14 \$5,400/)
  assert.match(page, /Reconciled with Positions-Margin Account\(3901\)-20260815-043000\.csv, moomoo's positions of 2026-08-14: 3 match, and these 5 differ/)
  assert.match(page, /Apple \(US:AAPL\) 6 6\.24 moomoo holds 6\.24 of Apple \(US:AAPL\), its ledger 6\. Drop the trade history with the missing buys in the Broker inbox\./)
  assert.match(page, /iShares Latin America 40 ETF \(symbol ILF\) — 235 moomoo holds 235/)
  assert.match(page, /moomoo's trade history, 7 trades recorded in the US Book, 5 rows set aside as not the Book's trades/)
})

test("the Stocks Brief shows the Hong Kong Book in Hong Kong dollars at moomoo, after the US Book", async () => {
  prepare()
  ws.writeRunFile(runId, 'lake/status.json', example('status.clean.json'))
  const imported = JSON.parse(example('broker-import.moomoo.json'))
  ws.writeRunFile(runId, 'broker-inbox.json', {
    dryRun: false,
    files: imported.files.map((f: { file: string }) => ({ ...f, movedTo: `broker-inbox/${f.file}`, setAside: null })),
    books: JSON.parse(example('book-holdings.books.json')),
  })

  const page = text(await brief())

  assert.ok(page.indexOf('US Book $') < page.indexOf('Hong Kong Book HK$'), 'the US first')
  assert.match(page, /Hong Kong Book HK\$145,000 at moomoo on the closes of 2026-08-14, HK\$0 of it in cash\./)
  assert.match(page, /HK:0700 Tencent Holdings Ltd 200 HK\$512\.50 HK\$520\.00 on 2026-08-14 HK\$104,000/)
  assert.match(page, /Reconciled with Positions-Margin Account\(3901\)-20260815-043000\.csv, moomoo's positions of 2026-08-15: 1 match, and these 2 differ/)
  assert.match(page, /CSOP Hang Seng TECH Index ETF \(symbol 03033\) — 10600 moomoo holds 10600/)
  assert.match(page, /moomoo's trade history, 2 trades recorded in the Hong Kong Book, 10 rows set aside as not the Book's trades/)
})

test("a Broker inbox Step that failed before recording anything leaves a Real Books section saying so", async () => {
  ws = makeWorkspace()
  ws.prepareRun(runId, { pipeline: 'stocks', steps: [{ name: 'broker-inbox', status: 'failed' }, { name: 'brief', status: 'pending' }] })
  ws.writeRunFile(runId, 'lake/status.json', example('status.clean.json'))

  const page = text(await brief())

  assert.match(page, /Real Books The Books' holdings couldn't be read in this Run\. See the Broker inbox Step's log: logs\/broker-inbox\.log/)
})

test("before ICICI Direct's first file is recorded, the Brief says where to drop it", async () => {
  prepare()
  ws.writeRunFile(runId, 'lake/status.json', example('status.clean.json'))
  ws.writeRunFile(runId, 'broker-inbox.json', { dryRun: false, files: [], books: JSON.parse(example('book-holdings.empty.json')) })

  const page = text(await brief())

  assert.match(page, /India Book No ICICI Direct file is recorded yet: drop its tradebook and holdings export in the Broker inbox, .*broker-inbox, and the next Run records them\./)
  assert.match(page, /US Book No moomoo file is recorded yet: drop its trade history and positions export in the Broker inbox, .*broker-inbox, and the next Run records them\./)
})

test("the Stocks Brief shows each Book's Sleeves with their Stages and how long each has been in its Stage", async () => {
  prepare()
  ws.writeRunFile(runId, 'lake/status.json', example('status.clean.json'))
  ws.writeRunFile(runId, 'stages.json', example('stages-check.books.json'))

  const page = text(await brief())

  assert.match(page, /Sleeves and Stages India Book Strategy Version Stage Since Live since India Super 30 OK, tuned in-super30-ok-tuned b0a30c3545e3 Paper 2026-07-29, 2 months and 29 days 2026-07-29 India CW2, selected in-cw2-selected 9c41d27e8b05 Candidate 2026-10-28, today —/)
  assert.match(page, /Retired, winding down through their strategies' own exits: 1 Strategy Version Retired Why India Super 30 OK, tuned in-super30-ok-tuned 5d1e0c7a9b21 2026-07-28, 3 months Replaced by version b0a30c3545e3 in Candidate/)
  assert.match(page, /US Book No strategy has a Sleeve yet\./)
  assert.match(page, /Hong Kong Book No strategy has a Sleeve yet\./)
})

test('each Candidate waits for approval into Paper, with its id and an Approve button', async () => {
  prepare()
  ws.writeRunFile(runId, 'lake/status.json', example('status.clean.json'))
  ws.writeRunFile(runId, 'stages.json', example('stages-check.books.json'))

  const html = await brief()
  const page = text(html)

  assert.match(page, /Candidates waiting for your approval: 1/)
  assert.match(page, /Approving one moves it into Paper: ash_new launches it, so its live track starts that day/)
  assert.match(page, /3 India Book India CW2, selected in-cw2-selected 9c41d27e8b05 2026-10-28, the Candidate test of 2026-10-23 Chosen by the Candidate test over 2016-10-24 to 2026-10-23 on 2026-10-23\.70c27d24c7a7 Approve/)
  const items = [...html.matchAll(/<div class="answer" data-item="([^"]+)">(.*?)<\/div>/g)].map(([, item, cell]) => [item, [...cell.matchAll(/data-answer="([^"]+)"/g)].map(([, answer]) => answer)])
  assert.deepEqual(items, [['candidate:3', ['approve']]])
  assert.match(html, /id="save-answers"/)
  assert.ok(page.indexOf('Candidates waiting') < page.indexOf('Sleeves and Stages'), 'what waits on Saransh comes before the Books')
})

test("a Stages Step that failed leaves a Sleeves and Stages section saying so", async () => {
  ws = makeWorkspace()
  ws.prepareRun(runId, { pipeline: 'stocks', steps: [{ name: 'lake', status: 'succeeded' }, { name: 'stages', status: 'failed' }, { name: 'brief', status: 'pending' }] })
  ws.writeRunFile(runId, 'lake/status.json', example('status.clean.json'))

  const page = text(await brief())

  assert.match(page, /Sleeves and Stages The Books' Sleeves couldn't be read in this Run\. See the Stages Step's log: logs\/stages\.log/)
})

/** The Plan Step's files: a plan example, and the real, paper and rules-only paper Book states it was made from. */
function planned(example_: string) {
  ws.writeRunFile(runId, 'plan.json', example(example_))
  const states = ['book-state.india.json', 'book-state.paper.json', 'book-state.rules-only.json'].map((name) => JSON.parse(example(name)))
  ws.writeRunFile(runId, 'book-states.json', JSON.stringify({ states }))
}

test("the India Book's state is shown beside its shadow Rule plan, with each order's signal and cut, none of it for placing", async () => {
  prepare()
  planned('plan.normal.json')

  const page = text(await brief())

  assert.match(page, /India Book in shadow: its Rule plan for 2026-10-26, not for placing/)
  // The state: its cash, its Legacy holdings and what is unsettled.
  assert.match(page, /The Book state fa1dba342bad ₹9,84,160 in cash: its capital, ₹10,00,000 until you set it \(its market's cost preset's\), with 2 trades in its ledger, the last on 2026-07-02/)
  assert.match(page, /Asian Paints Ltd IN:ASIANPAINT 100 ₹120\.00 Legacy/)
  assert.match(page, /Unsettled, so neither bought nor sold on a signal until a holdings export settles it: Rategain Travel Technologies Ltd \(IN:RATEGAIN\): quantity, ledger 100, broker 50/)
  // The plan: what it was made from, then each order with its signal and cut, marked not for placing.
  assert.match(page, /Made from the Book state fa1dba342bad, the data to 2026-10-23's close \(version 2026-10-23\.70c27d24c7a7\), India CW2, selected \(in-cw2-selected, version 7c41d0e2a9b3, Real-full\), its Disaster stops 20% under, the Mandate's version f99c88f13b5b and the Playbook's e247b5b89ff0/)
  assert.match(page, /India CW2, selected 90%, gold 10%/)
  assert.match(page, /IN-2026-10-26-001 Stove Kraft Ltd IN:STOVEKRAFT Buy 2415 ₹62\.52 ₹64\.39 India CW2, selected holds it at 12\.5% on the close of 2026-10-23 cut from 6775 to 2415 shares by the position cap Not for placing/)
  assert.match(page, /IN-2026-10-26-002 IN:GOLD1 Buy 2445 ₹40\.00 ₹41\.20 Gold's share of the Book — Not for placing/)
  assert.match(page, /Stopped by a rule, so not in the plan: Rategain Travel Technologies Ltd \(IN:RATEGAIN\): a buy of 2642 shares stopped by an open Reconciliation difference/)
  assert.match(page, /Disaster stops to place with the buys, or raise: Stove Kraft Ltd \(IN:STOVEKRAFT\): place at ₹50\.02/)
  assert.match(page, /Legacy holdings, held, not sold: issue 43 sells them as the Sleeves need the cash\. Asian Paints Ltd \(IN:ASIANPAINT\): 100 shares/)
})

test("each paper Book's Rule plan is shown beside its state, its strategies from Paper up at their full share", async () => {
  prepare()
  planned('plan.normal.json')

  const page = text(await brief())

  assert.match(page, /India Book's paper Book: its Rule plan for 2026-10-26 The paper Book holds each strategy from Paper up at its full share/)
  assert.match(page, /The Book state 53f848d353e2 ₹10,00,000 in cash: its capital, ₹10,00,000 until you set it \(its market's cost preset's\), all of it in cash until its first Order list fills\./)
  assert.match(page, /India Super 30 OK, tuned \(in-super30-ok-tuned, version 9d149a9b53a9, Paper\), its Disaster stops 15% under/)
  assert.match(page, /India Super 30 OK, tuned 90%, gold 10%/)
  assert.match(page, /IN-paper-2026-10-26-001 Rategain Travel Technologies Ltd IN:RATEGAIN Buy 865 ₹173\.38 ₹178\.59 India Super 30 OK, tuned holds it at 12\.5% on the close of 2026-10-23 cut from \d+ to 865 shares by the position cap Not for placing/)
  // The US and Hong Kong paper Books say why they have no plan.
  assert.match(page, /US Book's paper Book No Rule plan could be made: US has no panels yet/)
  assert.ok(page.indexOf('India Book in shadow') < page.indexOf("India Book's paper Book: its Rule plan"), 'the shadow plan comes first')
  // Its rules-only paper Book's plan follows it, short while it makes the same orders.
  assert.match(page, /India Book's rules-only paper Book: its Rule plan for 2026-10-26 The rules-only paper Book starts with the paper Book .* The Rule plan 9d04c6e1a7b2, made from its Book state 7c1e0b5a93d2: 3 orders, buys of ₹\S+ and sales of ₹0, the same as its paper Book's\./)
  assert.doesNotMatch(page, /IN-rules-2026-10-26-001/)
  assert.ok(page.indexOf("India Book's paper Book: its Rule plan") < page.indexOf("India Book's rules-only paper Book"), 'the paper Book comes first')
})

test("a rules-only paper Book whose orders differ from its paper Book's shows them", async () => {
  prepare()
  planned('plan.normal.json')
  const plan = JSON.parse(example('plan.normal.json'))
  const rules = plan.plans.find((p: { kind: string; book: string }) => p.kind === 'rules_only' && p.book === 'IN')
  rules.orders = rules.orders.slice(1)
  ws.writeRunFile(runId, 'plan.json', plan)

  const page = text(await brief())

  assert.match(page, /made from its Book state 7c1e0b5a93d2: 2 orders, buys of ₹\S+ and sales of ₹0\. Id Security/)
  assert.match(page, /IN-rules-2026-10-26-002/)
})

test('the Order lists the Check Step recorded are listed, or why none was', async () => {
  prepare()
  ws.writeRunFile(runId, 'check.json', { check: JSON.parse(example('check.recorded.json')), why: null })

  const page = text(await brief())

  assert.match(page, /Order lists Each paper Book's Order list is its Rule plan with the Portfolio Manager's changes that passed the final check/)
  assert.match(page, /India Book's paper Book 2026-10-26 2 Recorded India Book's rules-only paper Book 2026-10-26 3 Recorded/)
  assert.match(page, /US Book's paper Book — 0 Not recorded: It has no Rule plan: US has no panels yet/)

  ws.writeRunFile(runId, 'check.json', { check: null, why: 'the Plan Step failed, so there is no Rule plan to record' })
  assert.match(text(await ws.agents('step', 'brief', '--run', runId, '--force').then(() => ws.readRunFile(runId, 'brief.html'))), /Order lists No Order list was recorded in this Run: the Plan Step failed, so there is no Rule plan to record\./)
})

test("the Portfolio Manager's judgement of each paper Book is shown: its mode, commentary, each change with its Decision record and each change the final check dropped", async () => {
  prepare()
  ws.prepareRun(runId, { pipeline: 'stocks', steps: [{ name: 'portfolio-manager', status: 'succeeded' }, { name: 'brief', status: 'pending' }] })
  ws.writeRunFile(runId, 'portfolio-manager.json', { status: 'answered', answer: { books: [], journal: { entries: [], open: [] } }, journalRead: '', inputs: [] })
  ws.writeRunFile(runId, 'check.json', { check: JSON.parse(example('check.recorded.json')), why: null })
  ws.writeRunFile(runId, 'judgement-show.json', JSON.parse(example('judgement-show.books.json')))

  const page = text(await brief())

  assert.match(page, /The Portfolio Manager India Book's paper Book, in Playbook mode India is in a Correction, so the paper Book starts at its 40% exposure level\./)
  assert.match(page, /Its Order list went out with the Portfolio Manager's changes that passed the final check\. Its exposure level for the day: 40%\./)
  assert.match(
    page,
    /Dropped the buy of 865 Rategain Travel Technologies Ltd \(IN:RATEGAIN\)\. The Rule plan: Buy 865 Rategain Travel Technologies at ₹173\.38 for India Super 30 OK, tuned\. Instead: Nothing: its money waits in the cash fund\. Its Lever is selection, within the Playbook's "selection: a buy may be dropped"\. It read rs_rating of IN:RATEGAIN 71 \(plan\.json\); breadth of \^CRSLDX 0\.27 \(plan\.json\)\. Expected: .*Judged on 2026-12-24\./,
  )
  assert.match(page, /Dropped by the final check: Swapped the buy of IN-paper-2026-10-26-002 for IN:ZOMATO: IN:ZOMATO isn't in the Book's Pool/)
  assert.match(page, /Judgement modes and Playbooks Book Real Book Paper Book Playbook India Book subtract only Playbook size 0\.5× to 1×, waits up to 5 sessions/)
})

test('a proposal to move a Judgement mode or change a Playbook range waits for an Approve or Reject', async () => {
  prepare()
  ws.writeRunFile(runId, 'judgement-show.json', JSON.parse(example('judgement-show.books.json')))

  const html = await brief()

  assert.match(text(html), /Judgement proposals waiting for your Answer: 1 .* 3 Set the India Book's Playbook's size_max to 1\.25 2026-10-26, Saransh Over 3 months/)
  assert.match(html, /<div class="answer" data-item="judgement:3"><button type="button" data-answer="approve" aria-pressed="false">Approve<\/button><button type="button" data-answer="reject" aria-pressed="false">Reject<\/button>/)
})

test('a dry run says no Order list was recorded', async () => {
  prepare({ dryRun: true })
  ws.writeRunFile(runId, 'check.json', { check: JSON.parse(example('check.dry-run.json')), why: null })

  const page = text(await brief())

  assert.match(page, /Order lists Dry run: nothing was recorded\./)
  assert.match(page, /India Book's paper Book 2026-10-26 2 Would be recorded/)
})

test('each paper Book is shown against its rules-only paper Book, with its drawdown, Sleeves, riskiest stops and the Books together in rupees', async () => {
  prepare()
  ws.writeRunFile(runId, 'paper-books.json', JSON.parse(example('paper-books.json')))

  const page = text(await brief())

  assert.match(page, /Paper Books Book Paper Book Rules-only paper Book Gap Drawdown/)
  assert.match(page, /India Book ₹10,03,413 on 2026-10-27 ₹10,01,980 on 2026-10-27 ₹1,433 0\.1% -0\.3% breakers at -10% and -18%/)
  assert.match(page, /US Book \$100,000 not started: all cash \$100,000 not started: all cash \$0 0% 0%/)
  assert.match(page, /The paper Books together: ₹2,11,73,413, at USD at ₹88\.20 and HKD at ₹11\.35\./)
  assert.match(page, /India Book's paper Book Its Sleeves: in-super30-ok-tuned in Paper since 2026-10-26: ₹1,82,322; gold: ₹1,00,000\./)
  assert.match(page, /Disaster stops that would lose more than 1% of the Book: Reliance Industries Ltd\. \(IN:RELIANCE\): 65 shares at ₹1,452\.30, its stop at ₹1,234\.46, would lose ₹14,160, 1\.4% of the Book/)
})

test('on a day the Data gate fails, every Rule plan is in Hold mode and makes no order', async () => {
  prepare()
  planned('plan.hold.json')

  const page = text(await brief())

  assert.match(page, /Hold mode: no Rule plan makes an order today\. The Data gate fails, so nothing new is bought and exits happen only through Disaster stops: India: the lake is as of 2026-10-23, 1 session behind/)
  assert.match(page, /India Book's paper Book: its Rule plan for 2026-10-26 .* Hold mode: the Data gate fails, so this plan makes no order; its Disaster stops stay\./)
  assert.match(page, /No order for the next session: Hold mode\./)
  assert.match(page, /Stove Kraft Ltd \(IN:STOVEKRAFT\): a buy of 6886 shares stopped by Hold mode/)
})

test("a Book whose market was shut the session before gets no order", async () => {
  prepare()
  planned('plan.shut.json')

  const page = text(await brief())

  assert.match(page, /India Book in shadow, not for placing No order: Its market was shut on 2026-11-24, the session before the Run's day: no order for it\./)
  assert.match(page, /India Book's paper Book No order: Its market was shut on 2026-11-24/)
})

test("a shadow Rule plan ash_new couldn't make says why, and a Plan Step that failed says so", async () => {
  prepare()
  ws.writeRunFile(runId, 'plan.json', example('plan.cant-plan.json'))

  const page = text(await brief())

  assert.match(page, /India Book in shadow, not for placing No Rule plan could be made: The lake has no price for IN:GOLD1 on 2026-10-23/)
  assert.match(page, /Its state couldn't be read in this Run\./)

  ws.cleanup()
  ws = makeWorkspace()
  ws.prepareRun(runId, { pipeline: 'stocks', steps: [{ name: 'plan', status: 'failed' }, { name: 'brief', status: 'pending' }] })
  assert.match(text(await brief()), /Rule plans No Rule plan was made in this Run\. See the Plan Step's log: logs\/plan\.log/)
})

test("each market's Market condition is shown with MarketSmith's outlook beside it and each Book's exposure level", async () => {
  prepare()
  ws.writeRunFile(runId, 'plan.json', example('plan.normal.json'))

  const page = text(await brief())

  assert.match(page, /Market condition on 2026-10-23's close/)
  assert.match(page, /IN Correction \^CRSLDX 21,427\.6 50-day 22,729\.5, 200-day 22,814\.1 27\.3% of the Nifty 500 11 not in its snapshot \(IN:2026-10-24\) India Book: 40%/)
  assert.match(page, /US Under pressure \^GSPC 7,623\.7 50-day 7,699\.6, 200-day 7,291\.3 55\.4% of the S&P 500 5 no snapshot US Book: 80%/)
  assert.match(page, /HK Correction .* 22\.2% of the market 8 no snapshot Hong Kong Book: 40%/)
  assert.match(page, /It trades under an exposure level of 40%, which its market's Correction on the last close sets\./)
  assert.ok(page.indexOf('Market condition') < page.indexOf('India Book in shadow'), 'the conditions come before the plans')
})

test("on Saturdays the weekly review shows the Portfolio Manager's commentary and each Book and Sleeve against its tested range, its benchmark and Reconciliation", async () => {
  prepare()
  ws.writeRunFile(runId, 'review.json', JSON.parse(example('review.saturday.json')))
  const commentary = 'India Super 30 OK is inside its tested range after three months of Paper: its promotion is due.'
  ws.writeRunFile(runId, 'portfolio-manager.json', { status: 'answered', answer: { books: [], review: commentary, promotions: [], journal: { entries: [], open: [] } }, journalRead: '', inputs: [] })

  const page = text(await brief())

  assert.match(page, new RegExp(`Weekly review ${commentary}`))
  assert.match(page, /No strategy broke the demotion rule\./)
  assert.match(page, /India Book .* Paper Book 2\.2% since 2026-07-30 -1\.1% now, -3\.5% at worst 1\.9%, -4\.7% at worst -19\.3% 3 months: 2\.1% against -6\.9% to 12\.2% Inside/)
  assert.match(page, /India Super 30 OK, tuned Paper since 2026-07-29 4\.1% since 2026-07-29 -2\.1% now, -6\.3% at worst 1\.9%, -4\.7% at worst -28\.7% 3 months: 3\.9% against -11% to 18\.9% Inside/)
  assert.match(page, /Reconciliation, as of 2026-10-30: ICICI Direct holds 80 of Tata Motors Ltd \(IN:TATAMOTORS\), its ledger 40: 2 for 1/)
  assert.match(page, /Promotions due India Super 30 OK, tuned in the India Book: from Paper to Real-small, its time up on 2026-10-29/)
  assert.doesNotMatch(page, /US Book .* Paper Book/, 'a Book with no record and no Sleeve is left out')
})

test("on a month's first Saturday the monthly review attributes each Book's return to its sources, with the correlation between its Sleeves, its drawdown against its limits and the promotions due", async () => {
  prepare()
  ws.writeRunFile(runId, 'review.json', JSON.parse(example('review.monthly.json')))
  const monthly = 'The India Book made 2.1% in October, most of it from the market through its Sleeve.'
  ws.writeRunFile(runId, 'portfolio-manager.json', { status: 'answered', answer: { books: [], review: null, monthly, promotions: [], journal: { entries: [], open: [] } }, journalRead: '', inputs: [] })

  const page = text(await brief())

  assert.match(page, new RegExp(`Monthly review: October 2026 ${monthly}`))
  assert.match(
    page,
    /India Book Source Part of its return Sleeve weights 1\.05% .* Picks within Sleeves 0\.62% .* Gold 0\.31% Cash 0\.11% .* Costs -0\.09% Overrides 0\.13% The paper Book against its rules-only paper Book Its return 2\.13% In rupees, 21 sessions from 2026-09-30's close to 2026-10-30's/,
  )
  assert.match(page, /Over the month its benchmark made 1\.18% and its rules-only paper Book 2\.00%\./)
  assert.match(page, /India Super 30 OK, tuned and Gold 0\.08/)
  assert.match(page, /Its drawdown: -1\.1% at the month's end, -3\.5% at its deepest; its limits -10% for no new buys, -18% for half the exposure level, -25% for the drawdown limit\. It reached none of them\./)
  // The US Book, in dollars, is reviewed in rupees: the dollar's move against the rupee is a part of its return.
  assert.match(page, /The dollar against the rupee 0\.80% 87\.92 to 88\.62 rupees Its return 2\.31% In rupees, 22 sessions/)
  assert.match(page, /Over the month its benchmark made 1\.41% and its rules-only paper Book 1\.47% in USD\./)
  assert.match(page, /Its deepest reached no new buys\./)
  assert.doesNotMatch(page, /Hong Kong Book Source/, 'a Book with nothing to attribute is left out')
  assert.match(page, /Monthly review: October 2026 .* Promotions due India Super 30 OK, tuned in the India Book: from Paper to Real-small/)
  assert.ok(page.indexOf('Weekly review') < page.indexOf('Monthly review'), 'the monthly review comes after the weekly')
})

test('on other Saturdays there is no monthly review', async () => {
  prepare()
  ws.writeRunFile(runId, 'review.json', JSON.parse(example('review.saturday.json')))

  assert.doesNotMatch(text(await brief()), /Monthly review/)
})

test('a demotion the demotion rule made is said, with why, and the Sleeve is shown outside its range', async () => {
  prepare()
  ws.writeRunFile(runId, 'review.json', JSON.parse(example('review.demotion.json')))

  const page = text(await brief())

  assert.match(page, /Demotions India Super 30 OK, tuned in the India Book was demoted from Paper to Retired by the demotion rule: Its live drawdown, -45\.1%, passed 1\.5 times its backtest's worst, -28\.7% \(-43\.1%\)\./)
  assert.match(page, /Outside: Its drawdown, -45\.1%, is deeper than its backtest's worst, -28\.7%; Its 3-month return/)
  assert.doesNotMatch(page, /Promotions due/)
})

test('a Review Step that failed says so, and on other days there is no review', async () => {
  prepare()
  assert.doesNotMatch(text(await brief()), /Weekly review/)

  ws.cleanup()
  ws = makeWorkspace()
  ws.prepareRun(runId, { pipeline: 'stocks', steps: [{ name: 'review', status: 'failed' }, { name: 'brief', status: 'pending' }] })
  assert.match(text(await brief()), /Weekly review The weekly review's figures couldn't be had in this Run\. See the Review Step's log: logs\/review\.log/)
})

test('a promotion the Portfolio Manager proposed waits for an Approve or Reject, whether proposed in this Run or before', async () => {
  prepare()
  ws.writeRunFile(runId, 'stages.json', JSON.parse(example('stages-check.promotion.json')))
  ws.writeRunFile(runId, 'promotions.json', { promotions: [{ sleeve: 2, why: 'Again', decided: JSON.parse(example('stages-propose.proposed.json')) }] })

  const html = await brief()
  const page = text(html)

  assert.match(page, /Promotions waiting for your approval: 1 /, 'the same promotion once')
  assert.match(page, /4 India Book India Super 30 OK, tuned in-super30-ok-tuned Paper to Real-small 2026-10-31, the Portfolio Manager Three months of Paper inside its tested range/)
  assert.match(html, /data-item="promotion:4"><button type="button" data-answer="approve" aria-pressed="false">Approve<\/button><button type="button" data-answer="reject" aria-pressed="false">Reject<\/button>/)
})

test("the Brief shows the events coming for the holdings in the next 30 days, soonest first, each with its source's link", async () => {
  prepare()
  ws.writeRunFile(runId, 'lake/status.json', example('status.healthy.json'))
  ws.writeRunFile(runId, 'feeds.json', JSON.parse(example('feeds.failed.json')))

  const html = await brief()
  const page = text(html)

  // Asian Paints' announcement and IDFC First Bank's pledges are past; Rategain's results aren't a holding's.
  assert.match(page, /Coming events for the holdings The next 30 days' results and board meetings, from the Feeds as fetched at 2026-10-27 01:42 UTC\. Day Holding Held by Kind Event 2026-11-03 Apple US:AAPL US Book Results Results expected \(Yahoo's earnings date\) 2026-11-05 Asian Paints Ltd IN:ASIANPAINT India Book Results Financial Results\/Dividend/)
  assert.doesNotMatch(page, /Rategain/)
  assert.match(html, /<a href="https:\/\/nsearchives\.nseindia\.com\/corporate\/ASIANPAINT_20102026_SE\.pdf">Financial Results\/Dividend<\/a>/)
  assert.match(page, /Not fetched this Run: BSE's announcements \(failed\), SEC EDGAR's filings \(skipped\)\. Their events are as last fetched; see the To-dos\./)
})

test('with no event coming the Brief says so', async () => {
  prepare()
  ws.writeRunFile(runId, 'lake/status.json', example('status.healthy.json'))
  const feeds = JSON.parse(example('feeds.fetched.json'))
  ws.writeRunFile(runId, 'feeds.json', { ...feeds, on: '2026-12-15' })

  assert.match(text(await brief()), /Coming events for the holdings .* No event is known for the holdings in the next 30 days\./)
})

test('a Feeds Step that failed is shown with its log', async () => {
  ws = makeWorkspace()
  ws.prepareRun(runId, { pipeline: 'stocks', steps: [{ name: 'feeds', status: 'failed' }, { name: 'brief', status: 'pending' }] })
  ws.writeRunFile(runId, 'lake/status.json', example('status.healthy.json'))

  const page = text(await brief())

  assert.match(page, /Coming events for the holdings The Feeds weren't fetched in this Run\. See the Feeds Step's log: logs\/feeds\.log/)
})
