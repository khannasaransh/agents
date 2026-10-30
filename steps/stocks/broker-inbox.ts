// Broker inbox: records what Saransh did at his brokers. He drops each tradebook and holdings export he
// downloads in the Broker inbox, and this Step hands every file there to ash_new (`pd broker import`),
// knowing nothing of their formats: ash_new knows each by its columns, records each tradebook in its
// Book's real portfolio once, then reconciles each holdings export against the ledger. A file recorded,
// seen before or reconciled moves into the Run's broker-inbox/ folder; one ash_new can't read is set
// aside in the inbox's set-aside/ folder, with a To-do. Then it reads each Book's holdings and latest
// Reconciliation (`pd book-holdings`) for the Brief, and raises a To-do for each difference until a
// later holdings export settles it. ash_new matches each tradebook's fills to the real Books' orders as
// it records them (issue 42): each settles the orders of the sessions it covers, and a fill that
// matches no order is Saransh's own trade, flagged in the Brief. Last it reads the real Books' orders
// (`pd orders show`) and raises a To-do for each Book with orders he marked placed whose sessions are
// over but no tradebook has shown, naming the file to drop. Answers files, which the Answers Step
// reads, downloads still under way and hidden files stay where they are. A dry run records nothing and
// moves nothing.
import { existsSync, readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { isAnswersFileName } from '../../src/answers.ts'
import { bookName, brokerName, fileLine, reconciliationTodos } from '../../src/brokers.ts'
import { moveInto, readJson, writeJson } from '../../src/files.ts'
import { missingTradebookTodos, ownTradeText } from '../../src/orders.ts'
import { brokerInboxDir } from '../../src/paths.ts'
import { pdJson, type PdBookHoldings, type PdBrokerFile, type PdBrokerImport, type PdOrders } from '../../src/pd.ts'
import { readRun } from '../../src/run.ts'
import { runAsStep } from '../../src/step.ts'
import { writeTodos } from '../../src/todos.ts'

/** A file this Run handed to `pd broker import`, what became of it, and where it is now. */
export interface InboxFileRecord extends PdBrokerFile {
  /** Where it now is in the Run folder, once recorded, seen or reconciled; null otherwise. */
  movedTo: string | null
  /** Where it was set aside, when ash_new couldn't read it; null otherwise. */
  setAside: string | null
  /** Why it couldn't be moved: the next Run hands it in again, and ash_new sees a tradebook it recorded. */
  notMoved?: string
}

/** What the Broker inbox Step did, as broker-inbox.json in the Run folder. */
export interface BrokerInboxResult {
  dryRun: boolean
  files: InboxFileRecord[]
  /** Each Book's real money, as `pd book-holdings` printed it after the files were recorded. */
  books: PdBookHoldings | null
  /** The real Books' orders, stops and own trades, as `pd orders show` printed it after the files were recorded (issue 42). */
  orders?: PdOrders | null
}

// How long a `pd` command may take: a few files' trades and a holdings export, or reading the Books, take
// seconds, unless the database is busy.
const pdMs = 5 * 60_000
const setAsideDir = () => join(brokerInboxDir(), 'set-aside')

/** The files waiting in the inbox: every file at its top level, but Answers files, partial downloads and hidden files. */
function waitingFiles(): string[] {
  if (!existsSync(brokerInboxDir())) return []
  return readdirSync(brokerInboxDir())
    .filter((name) => !name.startsWith('.') && !isAnswersFileName(name) && !/\.(crdownload|part|tmp)$/i.test(name) && name.toLowerCase() !== 'desktop.ini')
    .filter((name) => statSync(join(brokerInboxDir(), name)).isFile())
    .sort()
}

/**
 * Moves each file out of the inbox once ash_new has handled it: into the Run when a Book recorded, saw or
 * reconciled it, set aside when none could. A file of several Books (moomoo's) is a result for each, and
 * moves once.
 */
function moveOut(files: PdBrokerFile[], runFolder: string): InboxFileRecord[] {
  type Where = Pick<InboxFileRecord, 'movedTo' | 'setAside' | 'notMoved'>
  const moved = new Map<string, Where>()
  const moveOnce = (name: string): Where => {
    const where: Where = { movedTo: null, setAside: null }
    const from = join(brokerInboxDir(), name)
    try {
      if (files.every((f) => f.file !== name || f.status === 'unreadable')) where.setAside = moveInto(from, setAsideDir())
      else where.movedTo = relative(runFolder, moveInto(from, join(runFolder, 'broker-inbox')))
    } catch (error) {
      where.notMoved = error instanceof Error ? error.message : String(error)
      console.error(`Couldn't move ${name} out of the Broker inbox: ${where.notMoved}`)
    }
    moved.set(name, where)
    return where
  }
  return files.map((file) => ({ ...file, ...(moved.get(file.file) ?? moveOnce(file.file)) }))
}

/** A To-do for a file ash_new couldn't read, now set aside; or couldn't record in one Book, though another recorded it. */
function unreadableTodo(f: InboxFileRecord): string {
  if (f.movedTo) return `${f.file} couldn't be recorded in ${bookName(f.book)} (${f.why}), though another Book recorded it, so it's in this Run's folder. Fix what it says, then drop ${brokerName(f.broker)}'s next download in the Broker inbox.`
  return `${f.file} in the Broker inbox couldn't be read (${f.why}), so it's ${f.setAside ? `set aside in ${setAsideDir()}` : 'still in the inbox'}. Fix it and drop it in again, or delete it.`
}

await runAsStep(async ({ runFolder, runId }) => {
  const out = join(runFolder, 'broker-inbox.json')
  const { dryRun = false } = readRun(runId)
  // The files an earlier run of this Step moved stay recorded; any it left are handed in again.
  const earlier = existsSync(out) ? readJson<BrokerInboxResult>(out) : null
  const result: BrokerInboxResult = { dryRun, files: earlier && !earlier.dryRun ? earlier.files.filter((f) => f.movedTo || f.setAside) : [], books: null }

  const waiting = waitingFiles()
  if (!waiting.length) console.log('No file is waiting in the Broker inbox')
  else {
    const args = ['broker', 'import', ...waiting.map((name) => join(brokerInboxDir(), name)), ...(dryRun ? ['--dry-run'] : [])]
    const imported = await pdJson<PdBrokerImport>(args, { cwd: runFolder, timeoutMs: pdMs })
    for (const file of imported.files) console.log(fileLine(file))
    for (const file of imported.files) {
      for (const own of file.fills?.own ?? []) console.log(`${file.file}: ${ownTradeText(own)} matches no order of ${bookName(file.book)}: your own trade`)
    }
    if (dryRun) console.log('Dry run: nothing was recorded in ash_new, and every file stays in the Broker inbox')
    result.files.push(...(dryRun ? imported.files.map((file) => ({ ...file, movedTo: null, setAside: null })) : moveOut(imported.files, runFolder)))
    writeJson(out, result)
  }

  result.books = await pdJson<PdBookHoldings>(['book-holdings'], { cwd: runFolder, timeoutMs: pdMs })
  result.orders = await pdJson<PdOrders>(['orders', 'show'], { cwd: runFolder, timeoutMs: pdMs })
  writeJson(out, result)
  const unreadable = result.files.filter((f) => f.status === 'unreadable')
  const missing = missingTradebookTodos(result.orders)
  for (const todo of missing) console.log(todo)
  writeTodos(runFolder, 'broker-inbox', [...unreadable.map(unreadableTodo), ...result.books.books.flatMap(reconciliationTodos), ...missing])
})
