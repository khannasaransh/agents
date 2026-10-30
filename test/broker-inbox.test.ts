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
  ws.setPd({ orders: { example: 'orders.empty.json' }, ...pd })
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
  assert.deepEqual(ws.pdCalls().map((call) => call.args), [['book-holdings'], ['orders', 'show']], 'an empty inbox hands nothing in')
  assert.deepEqual(todos(), [
    'Reconciliation, India Book, as of 2026-10-31: ICICI Direct holds 15 of Angel One Ltd (IN:ANGELONE), which its ledger has none of. Drop the tradebook with its buys in the Broker inbox.',
    'Reconciliation, India Book, as of 2026-10-31: ICICI Direct holds 48 of Delhivery Ltd (IN:DELHIVERY), its ledger 30. Drop the tradebook with the missing buys in the Broker inbox.',
    'Reconciliation, India Book, as of 2026-10-31: its ledger holds 100 of IDFC First Bank Ltd (IN:IDFCFIRSTB), which ICICI Direct holds none of. Drop the tradebook with its sales in the Broker inbox.',
    'Reconciliation, India Book, as of 2026-10-31: ICICI Direct holds 20 of Waaree Energies Ltd (IN:WAAREEENER), its ledger 10: 2 for 1, as a split or bonus the Lake hasn\'t got would give.',
    "Reconciliation, India Book, as of 2026-10-31: ICICI Direct holds 10 of NEW LISTING LTD (ISIN INE000Z01010), which ash_new's securities table hasn't got, so it can't be reconciled.",
  ])
})

test("moomoo's trade history and positions are handed in unchanged, and the US and Hong Kong Books' differences become To-dos", async () => {
  prepare({ pd: { broker: { example: 'broker-import.moomoo.json' }, 'book-holdings': { example: 'book-holdings.books.json' } } })
  // As moomoo names them: spaces and parentheses.
  const history = 'History Transactions-Margin Account(3901)-20220802-20260815.csv'
  const positions = 'Positions-Margin Account(3901)-20260815-043000.csv'
  drop(history, positions)

  const result = await step()

  assert.equal(result.status, 0, result.stderr)
  assert.deepEqual(ws.pdCalls()[0].args.slice(2).map((file) => basename(file)), [history, positions])
  assert.deepEqual(inInbox(), [])
  // Each file is read for both of moomoo's Books, and moves into the Run once.
  assert.deepEqual(ws.runFiles(runId, 'broker-inbox').sort(), [history, positions])
  assert.deepEqual(
    recorded().files.map((f: { book: string; movedTo: string }) => [f.book, f.movedTo]),
    [
      ['US', join('broker-inbox', history)],
      ['HK', join('broker-inbox', history)],
      ['US', join('broker-inbox', positions)],
      ['HK', join('broker-inbox', positions)],
    ],
  )
  assert.ok(recorded().files.every((f: { notMoved?: string }) => !f.notMoved), 'no Book tried to move a file another had moved')
  const log = ws.readRunFile(runId, 'logs', 'broker-inbox.log')
  assert.match(log, /History Transactions-Margin Account\(3901\)-20220802-20260815\.csv: moomoo's trade history, 7 trades recorded in the US Book, 5 rows set aside as not the Book's trades/)
  assert.match(log, /History Transactions-Margin Account\(3901\)-20220802-20260815\.csv: moomoo's trade history, 2 trades recorded in the Hong Kong Book, 10 rows set aside as not the Book's trades/)
  assert.match(log, /Positions-Margin Account\(3901\)-20260815-043000\.csv: moomoo's positions of 2026-08-14, reconciled with the US Book: 3 match, 5 differences/)
  assert.match(log, /Positions-Margin Account\(3901\)-20260815-043000\.csv: moomoo's positions of 2026-08-15, reconciled with the Hong Kong Book: 1 match, 2 differences/)
  const us = todos().filter((todo) => todo.startsWith('Reconciliation, US Book'))
  assert.equal(todos().length, 12, "the India Book's five, then the US Book's, then the Hong Kong Book's")
  assert.deepEqual(todos().slice(10), [
    "Reconciliation, Hong Kong Book, as of 2026-08-15: moomoo holds 300 of Tencent Holdings Ltd (HK:0700), its ledger 200: 3 for 2, as a split or bonus the Lake hasn't got would give.",
    "Reconciliation, Hong Kong Book, as of 2026-08-15: moomoo holds 10600 of CSOP Hang Seng TECH Index ETF (symbol 03033), which ash_new's securities table hasn't got, so it can't be reconciled.",
  ])
  assert.deepEqual(us, [
    'Reconciliation, US Book, as of 2026-08-14: moomoo holds 6.24 of Apple (US:AAPL), its ledger 6. Drop the trade history with the missing buys in the Broker inbox.',
    'Reconciliation, US Book, as of 2026-08-14: moomoo holds 0.8 of Nvidia Corp (US:NVDA), which its ledger has none of. Drop the trade history with its buys in the Broker inbox.',
    "Reconciliation, US Book, as of 2026-08-14: moomoo holds 100 of Super Micro Computer (US:SMCI), its ledger 10: 10 for 1, as a split or bonus the Lake hasn't got would give.",
    'Reconciliation, US Book, as of 2026-08-14: its ledger holds 4 of Waters Corp (US:WAT), which moomoo holds none of. Drop the trade history with its sales in the Broker inbox.',
    "Reconciliation, US Book, as of 2026-08-14: moomoo holds 235 of iShares Latin America 40 ETF (symbol ILF), which ash_new's securities table hasn't got, so it can't be reconciled.",
  ])
})

test("a moomoo file one Book recorded and the other couldn't moves into the Run, with a To-do for the Book that couldn't", async () => {
  prepare({ pd: { broker: { example: 'broker-import.partial.json' }, 'book-holdings': { example: 'book-holdings.empty.json' } } })
  const history = 'History Transactions-Margin Account(3901)-20220802-20260815.csv'
  drop(history)

  const result = await step()

  assert.equal(result.status, 0, result.stderr)
  assert.deepEqual(inInbox(), [], 'not set aside: the US Book recorded it')
  assert.deepEqual(ws.runFiles(runId, 'broker-inbox'), [history])
  assert.deepEqual(todos(), [
    `${history} couldn't be recorded in the Hong Kong Book (It sells 300 HK:0700 on 2026-08-20, but holds 200 then. Nothing in it was recorded), though another Book recorded it, so it's in this Run's folder. Fix what it says, then drop moomoo's next download in the Broker inbox.`,
  ])
  const log = ws.readRunFile(runId, 'logs', 'broker-inbox.log')
  assert.match(log, /moomoo's trade history, 1 trade recorded in the US Book, 6 in its ledger already, 6 rows set aside/)
  assert.match(log, /History Transactions-Margin Account\(3901\)-20220802-20260815\.csv: can't be read for the Hong Kong Book: It sells 300 HK:0700/)
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

test("a placed order no tradebook has shown by the next Run raises a To-do naming the file to drop, and a fill matching no order is logged as Saransh's own trade", async () => {
  prepare({ pd: { broker: { example: 'broker-import.recorded.json' }, 'book-holdings': { example: 'book-holdings.empty.json' }, orders: { example: 'orders.waiting.json' } } })
  drop('orderBook_Equity_1.csv')

  const result = await step()

  assert.equal(result.status, 0, result.stderr)
  assert.deepEqual(ws.pdCalls().at(-1)?.args, ['orders', 'show'], 'the orders are read once the files are recorded')
  assert.deepEqual(todos(), [
    "Drop ICICI Direct's tradebook covering 2026-10-29 in the Broker inbox: the India Book's IN-2026-10-29-002 (buy 100 Senco Gold Ltd) is placed, and no tradebook has shown whether it filled.",
  ])
  assert.equal(recorded().orders.books[0].orders.length, 6, "pd orders show's answer is recorded for the Brief")
  const log = ws.readRunFile(runId, 'logs', 'broker-inbox.log')
  assert.match(log, /orderBook_Equity_1\.csv: Bought 100 IDFC First Bank Ltd at 80\.98 on 2026-10-29 matches no order of the India Book: your own trade/)
})
