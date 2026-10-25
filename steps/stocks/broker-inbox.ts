// Broker inbox: records what Saransh did at his brokers. He drops each tradebook and holdings export he
// downloads in the Broker inbox, and this Step hands every file there to ash_new (`pd broker import`),
// knowing nothing of their formats: ash_new knows each by its columns, records each tradebook in its
// Book's real portfolio once, then reconciles each holdings export against the ledger. A file recorded,
// seen before or reconciled moves into the Run's broker-inbox/ folder; one ash_new can't read is set
// aside in the inbox's set-aside/ folder, with a To-do. Then it reads each Book's holdings and latest
// Reconciliation (`pd book-holdings`) for the Brief, and raises a To-do for each difference until a
// later holdings export settles it. Answers files, which the Answers Step reads, downloads still under
// way and hidden files stay where they are. A dry run records nothing and moves nothing.
import { existsSync, readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { isAnswersFileName } from '../../src/answers.ts'
import { fileLine, reconciliationTodos } from '../../src/brokers.ts'
import { moveInto, readJson, writeJson } from '../../src/files.ts'
import { brokerInboxDir } from '../../src/paths.ts'
import { pdJson, type PdBookHoldings, type PdBrokerFile, type PdBrokerImport } from '../../src/pd.ts'
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

/** Moves a file out of the inbox once ash_new has handled it: into the Run, or set aside when it couldn't read it. */
function moveOut(file: PdBrokerFile, runFolder: string): InboxFileRecord {
  const record: InboxFileRecord = { ...file, movedTo: null, setAside: null }
  const from = join(brokerInboxDir(), file.file)
  try {
    if (file.status === 'unreadable') record.setAside = moveInto(from, setAsideDir())
    else record.movedTo = relative(runFolder, moveInto(from, join(runFolder, 'broker-inbox')))
  } catch (error) {
    record.notMoved = error instanceof Error ? error.message : String(error)
    console.error(`Couldn't move ${file.file} out of the Broker inbox: ${record.notMoved}`)
  }
  return record
}

/** A To-do for a file ash_new couldn't read, now set aside. */
const unreadableTodo = (f: InboxFileRecord) =>
  `${f.file} in the Broker inbox couldn't be read (${f.why}), so it's ${f.setAside ? `set aside in ${setAsideDir()}` : 'still in the inbox'}. Fix it and drop it in again, or delete it.`

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
    if (dryRun) console.log('Dry run: nothing was recorded in ash_new, and every file stays in the Broker inbox')
    for (const file of imported.files) result.files.push(dryRun ? { ...file, movedTo: null, setAside: null } : moveOut(file, runFolder))
    writeJson(out, result)
  }

  result.books = await pdJson<PdBookHoldings>(['book-holdings'], { cwd: runFolder, timeoutMs: pdMs })
  writeJson(out, result)
  const unreadable = result.files.filter((f) => f.status === 'unreadable')
  writeTodos(runFolder, 'broker-inbox', [...unreadable.map(unreadableTodo), ...result.books.books.flatMap(reconciliationTodos)])
})
