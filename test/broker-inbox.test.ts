import assert from 'node:assert/strict'
import { existsSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs'
import { basename, join } from 'node:path'
import { afterEach, test } from 'node:test'
import { makeWorkspace, type PdAnswer, type Workspace } from './helpers.ts'

let ws: Workspace
afterEach(() => ws.cleanup())

const runId = '2026-10-31-0930'
const stocksSteps = ['answers', 'broker-inbox', 'marketsmith', 'lake', 'brief'].map((name) => ({ name, status: 'pending' }))

function prepare({ dryRun = false, pd }: { dryRun?: boolean; pd: Record<string, PdAnswer | PdAnswer[]> }) {
  ws = makeWorkspace()
  ws.prepareRun(runId, { pipeline: 'stocks', steps: stocksSteps, dryRun })
  ws.setPd(pd)
}

const inbox = () => join(ws.dataDir, 'broker-inbox')
/** Drops files in the Broker inbox, as Saransh downloads them there. */
function drop(...names: string[]) {
  mkdirSync(inbox(), { recursive: true })
  for (const name of names) writeFileSync(join(inbox(), name), `${name}\n`)
}
const inInbox = () => (existsSync(inbox()) ? readdirSync(inbox()).sort() : [])
const recorded = () => JSON.parse(ws.readRunFile(runId, 'broker-inbox.json'))
const todos = () => (ws.runFiles(runId, 'todos').includes('broker-inbox.json') ? (JSON.parse(ws.readRunFile(runId, 'todos', 'broker-inbox.json')) as string[]) : [])
const status = () => JSON.parse(ws.readRunFile(runId, 'run.json')).steps[1].status
const step = () => ws.agents('step', 'broker-inbox', '--run', runId)

test('each file in the Broker inbox is handed to pd broker import, and once recorded moves into the Run', async () => {
  prepare({ pd: { broker: { example: 'broker-import.recorded.json' }, 'book-holdings': { example: 'book-holdings.india.json' } } })
  drop('orderBook_Equity_1.csv', '7500057272_Demat.csv')
  // Not the Broker inbox's to hand in: an Answers file (the Answers Step's), a download still under way, and what was set aside before.
  drop('stocks-answers-2026-10-30-0930-20261030071500.json', 'orderBook_Equity_9.csv.crdownload', '.DS_Store')
  mkdirSync(join(inbox(), 'set-aside'))

  const result = await step()

  assert.equal(result.status, 0, result.stderr)
  assert.equal(status(), 'succeeded')
  const [handed, holdings] = ws.pdCalls()
  assert.deepEqual(handed.args.slice(0, 2), ['broker', 'import'])
  assert.deepEqual(handed.args.slice(2).map((file) => basename(file)), ['7500057272_Demat.csv', 'orderBook_Equity_1.csv'], 'every file, by its full path, in name order')
  assert.deepEqual(holdings.args, ['book-holdings'])
  assert.deepEqual(inInbox(), ['.DS_Store', 'orderBook_Equity_9.csv.crdownload', 'set-aside', 'stocks-answers-2026-10-30-0930-20261030071500.json'])
  assert.deepEqual(ws.runFiles(runId, 'broker-inbox').sort(), ['7500057272_Demat.csv', 'orderBook_Equity_1.csv'])
  const files = recorded().files
  assert.deepEqual(
    files.map((f: { file: string; movedTo: string | null; setAside: string | null; status: string }) => [f.file, f.movedTo, f.setAside, f.status]),
    [
      ['orderBook_Equity_1.csv', join('broker-inbox', 'orderBook_Equity_1.csv'), null, 'recorded'],
      ['7500057272_Demat.csv', join('broker-inbox', '7500057272_Demat.csv'), null, 'reconciled'],
    ],
  )
  assert.equal(recorded().books.books[0].holdings.length, 4, "pd book-holdings' answer is recorded for the Brief")
  const log = ws.readRunFile(runId, 'logs', 'broker-inbox.log')
  assert.match(log, /orderBook_Equity_1\.csv: ICICI Direct's tradebook, 6 trades recorded in the India Book, 1 in its ledger already/)
  assert.match(log, /7500057272_Demat\.csv: ICICI Direct's holdings of 2026-10-31, reconciled with the India Book: 3 match, 2 differences/)
})

test('each Reconciliation difference becomes a To-do, from the latest holdings export', async () => {
  prepare({ pd: { 'book-holdings': { example: 'book-holdings.india.json' } } })

  const result = await step()

  assert.equal(result.status, 0, result.stderr)
  assert.deepEqual(ws.pdCalls().map((call) => call.args), [['book-holdings']], 'an empty inbox hands nothing in')
  assert.deepEqual(todos(), [
    'Reconciliation, India Book, as of 2026-10-31: ICICI Direct holds 15 of Angel One Ltd (IN:ANGELONE), which its ledger has none of. Drop the tradebook with its buys in the Broker inbox.',
    'Reconciliation, India Book, as of 2026-10-31: ICICI Direct holds 48 of Delhivery Ltd (IN:DELHIVERY), its ledger 30. Drop the tradebook with the missing buys in the Broker inbox.',
    'Reconciliation, India Book, as of 2026-10-31: its ledger holds 100 of IDFC First Bank Ltd (IN:IDFCFIRSTB), which ICICI Direct holds none of. Drop the tradebook with its sales in the Broker inbox.',
    'Reconciliation, India Book, as of 2026-10-31: ICICI Direct holds 20 of Waaree Energies Ltd (IN:WAAREEENER), its ledger 10: 2 for 1, as a split or bonus the Lake hasn\'t got would give.',
    "Reconciliation, India Book, as of 2026-10-31: ICICI Direct holds 10 of NEW LISTING LTD (ISIN INE000Z01010), which ash_new's securities table hasn't got, so it can't be reconciled.",
  ])
})

test("a file pd can't read is set aside in the inbox with a To-do, and one seen before moves into the Run", async () => {
  prepare({ pd: { broker: { example: 'broker-import.mixed.json' }, 'book-holdings': { example: 'book-holdings.empty.json' } } })
  drop('orderBook_Equity_2.csv', 'notes.csv', 'orderBook_Equity_3.csv')

  const result = await step()

  assert.equal(result.status, 0, result.stderr)
  assert.deepEqual(inInbox(), ['set-aside'])
  assert.deepEqual(readdirSync(join(inbox(), 'set-aside')).sort(), ['notes.csv', 'orderBook_Equity_3.csv'])
  assert.deepEqual(ws.runFiles(runId, 'broker-inbox'), ['orderBook_Equity_2.csv'])
  assert.deepEqual(todos(), [
    `notes.csv in the Broker inbox couldn't be read (Its columns aren't any broker's export ash_new reads), so it's set aside in ${join(inbox(), 'set-aside')}. Fix it and drop it in again, or delete it.`,
    `orderBook_Equity_3.csv in the Broker inbox couldn't be read (Line 2: No IN security is NOSUCHCO. Nothing in it was recorded), so it's set aside in ${join(inbox(), 'set-aside')}. Fix it and drop it in again, or delete it.`,
  ])
  const log = ws.readRunFile(runId, 'logs', 'broker-inbox.log')
  assert.match(log, /orderBook_Equity_2\.csv: seen before, not recorded again: orderBook_Equity_1\.csv, the same file, was recorded already/)
})

test('a dry run records nothing and moves nothing', async () => {
  prepare({ dryRun: true, pd: { broker: { example: 'broker-import.dry-run.json' }, 'book-holdings': { example: 'book-holdings.empty.json' } } })
  drop('orderBook_Equity_1.csv')

  const result = await step()

  assert.equal(result.status, 0, result.stderr)
  assert.deepEqual(ws.pdCalls()[0].args.slice(-1), ['--dry-run'])
  assert.deepEqual(inInbox(), ['orderBook_Equity_1.csv'])
  assert.equal(recorded().dryRun, true)
  assert.equal(recorded().files[0].movedTo, null)
})

test('pd broker import failing fails the Step and leaves every file in the inbox', async () => {
  prepare({ pd: { broker: { stderr: 'Traceback: sqlite3.OperationalError: database is locked\n', exitCode: 1 }, 'book-holdings': { example: 'book-holdings.empty.json' } } })
  drop('orderBook_Equity_1.csv')

  const result = await step()

  assert.equal(result.status, 1)
  assert.equal(status(), 'failed')
  assert.deepEqual(inInbox(), ['orderBook_Equity_1.csv'])
  assert.match(ws.readRunFile(runId, 'logs', 'broker-inbox.log'), /pd broker import .* exited with 1: Traceback: sqlite3\.OperationalError: database is locked/)
})
