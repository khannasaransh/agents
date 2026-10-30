// Answers: applies what Saransh answered in a Stocks Brief. It reads every Answers file in Downloads
// and in the Broker inbox and applies their Answers through `pd`, oldest file first. An Answer
// applies only while its item is still open: one to an item `pd` says is settled, or one saved
// before an Answer already applied to its item, is ignored and logged, so an old file can't undo a
// newer Answer. Each file read moves into the Run's answers/ folder, and what became of each Answer
// is recorded as answers.json, for the Brief. A file that isn't an Answers file stays where it is,
// with a To-do. An Answer `pd` couldn't apply fails the Step and leaves its file, and every later
// one, for the next Run. A dry run applies nothing and consumes no file.
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { answersFileError, isAnswersFileName, pdArgs, type Answer, type AnswersFile } from '../../src/answers.ts'
import { moveInto, readJson, writeJson } from '../../src/files.ts'
import { brokerInboxDir, downloadsDir } from '../../src/paths.ts'
import { pdJson, type PdDecided } from '../../src/pd.ts'
import { readRun } from '../../src/run.ts'
import { readAnswersState, writeAnswersState, type AppliedAnswer } from '../../src/state.ts'
import { runAsStep } from '../../src/step.ts'
import { writeTodos } from '../../src/todos.ts'

/** What became of an Answer: `not-tried` once an earlier one failed, `dry-run` in a dry run. */
export type Outcome = 'applied' | 'ignored' | 'failed' | 'not-tried' | 'dry-run'

/** What became of an Answer, and why, when it wasn't applied. */
export interface Applying {
  outcome: Outcome
  why?: string
}

/** An Answers file this Run read, with what became of each of its Answers. */
export interface AnswersFileRecord {
  /** Its name, and the folder it was found in. */
  file: string
  from: string
  /** Where it now is in the Run folder, or null when it was left where it was found. */
  movedTo: string | null
  /** Why it couldn't be moved into the Run once its Answers were applied: the next Run reads it again, and ignores what was applied. */
  notMoved?: string
  /** The Run whose Brief it was saved from. */
  run: string
  savedAt: string
  answers: (Answer & Applying)[]
}

/** What the Answers Step did, as answers.json in the Run folder: each file it read, oldest first. */
export interface AnswersResult {
  dryRun: boolean
  files: AnswersFileRecord[]
}

/** How long a `pd` command deciding one item may take: it writes a row or two. */
const decideMs = 2 * 60_000

interface Found {
  name: string
  folder: string
  file: AnswersFile
}

/** The Answers files in each folder, oldest first, and why each other file named as one can't be read. */
function findAnswersFiles(folders: string[]): { found: Found[]; unreadable: { name: string; folder: string; why: string }[] } {
  const found: Found[] = []
  const unreadable: { name: string; folder: string; why: string }[] = []
  for (const folder of folders) {
    if (!existsSync(folder)) continue
    for (const name of readdirSync(folder).sort()) {
      if (!isAnswersFileName(name) || !statSync(join(folder, name)).isFile()) continue
      let file: unknown
      try {
        file = JSON.parse(readFileSync(join(folder, name), 'utf8'))
      } catch {
        unreadable.push({ name, folder, why: "it isn't JSON" })
        continue
      }
      const why = answersFileError(file)
      if (why) unreadable.push({ name, folder, why })
      else found.push({ name, folder, file: file as AnswersFile })
    }
  }
  // A stable sort, so files saved at the same time keep their folder's order and their names'.
  return { found: found.sort((a, b) => Date.parse(a.file.savedAt) - Date.parse(b.file.savedAt)), unreadable }
}

/** Applies one Answer through `pd`, unless its item can't take it or a newer Answer already settled it. */
async function apply(answer: Answer, file: AnswersFile, state: Record<string, AppliedAnswer>, { runId, runFolder }: { runId: string; runFolder: string }): Promise<Applying> {
  const command = pdArgs(answer, file.savedAt)
  if ('why' in command) return { outcome: 'ignored', why: command.why }
  // The same Answer saved at the same time is another copy of one file, as when it is in Downloads and the Broker inbox both.
  const applied = state[answer.item]
  if (applied && applied.savedAt === file.savedAt && applied.answer === answer.answer) return { outcome: 'ignored', why: `This Answer was applied already, in Run ${applied.run}` }
  if (applied && Date.parse(applied.savedAt) > Date.parse(file.savedAt)) return { outcome: 'ignored', why: `A newer Answer, saved at ${applied.savedAt}, was applied in Run ${applied.run}` }
  let decided: PdDecided
  try {
    // It exits 1 when there is no such item, still saying why as JSON.
    decided = await pdJson<PdDecided>(command.args, { cwd: runFolder, timeoutMs: decideMs, exitCodes: [0, 1] })
  } catch (error) {
    return { outcome: 'failed', why: error instanceof Error ? error.message : String(error) }
  }
  if (!decided.changed) return { outcome: 'ignored', why: decided.why ?? 'ash_new changed nothing' }
  state[answer.item] = { answer: answer.answer, savedAt: file.savedAt, run: runId }
  writeAnswersState(state)
  return { outcome: 'applied' }
}

/** Moves a file into the Run's answers/ folder under a free name there, and returns its path in the Run. */
function moveIntoRun({ name, folder }: Found, runFolder: string): string {
  return relative(runFolder, moveInto(join(folder, name), join(runFolder, 'answers')))
}

await runAsStep(async ({ runId, runFolder }) => {
  const out = join(runFolder, 'answers.json')
  const { dryRun = false } = readRun(runId)
  const { found, unreadable } = findAnswersFiles([downloadsDir(), brokerInboxDir()])
  const todos = unreadable.map(({ name, folder, why }) => `${name} in ${folder} isn't an Answers file the Answers Step can read: ${why}. Fix it or delete it.`)
  writeTodos(runFolder, 'answers', todos)
  for (const { name, folder, why } of unreadable) console.log(`Left ${name} in ${folder}: ${why}`)
  if (!found.length) console.log('No Answers file in Downloads or the Broker inbox')
  if (dryRun && found.length) console.log('Dry run: no Answer is applied, and every Answers file stays where it is')

  // The files an earlier run of this Step moved into the Run stay recorded; any it left are read again.
  const earlier = existsSync(out) ? readJson<AnswersResult>(out) : null
  const result: AnswersResult = { dryRun, files: earlier && !earlier.dryRun ? earlier.files.filter((f) => f.movedTo) : [] }
  const state = readAnswersState()
  let failed = false
  for (const each of found) {
    const { name, folder, file } = each
    const record: AnswersFileRecord = { file: name, from: folder, movedTo: null, run: file.run, savedAt: file.savedAt, answers: [] }
    result.files.push(record)
    console.log(`${name}, saved at ${file.savedAt} from the Brief of Run ${file.run}: ${file.answers.length} Answers`)
    for (const answer of file.answers) {
      const done: Applying = dryRun ? { outcome: 'dry-run' } : failed ? { outcome: 'not-tried' } : await apply(answer, file, state, { runId, runFolder })
      record.answers.push({ ...answer, ...done })
      if (done.outcome === 'applied') console.log(`Applied ${answer.item} ${answer.answer}`)
      if (done.outcome === 'ignored') console.log(`Ignored ${answer.item} ${answer.answer} from ${name}: ${done.why}`)
      if (done.outcome === 'failed') console.error(`Couldn't apply ${answer.item} ${answer.answer} from ${name}: ${done.why}`)
      failed ||= done.outcome === 'failed'
    }
    if (!dryRun && !failed) {
      try {
        record.movedTo = moveIntoRun(each, runFolder)
        console.log(`Moved ${name} into the Run as ${record.movedTo}`)
      } catch (error) {
        record.notMoved = error instanceof Error ? error.message : String(error)
        console.error(`Couldn't move ${name} into the Run: ${record.notMoved}`)
      }
    }
    // Recorded after each file, so what was applied is kept even when a later file stops the Step.
    writeJson(out, result)
  }
  writeJson(out, result)
  if (failed) {
    const stuck = result.files.find((f) => f.answers.some((a) => a.outcome === 'failed'))!
    writeTodos(runFolder, 'answers', [...todos, `An Answer in ${stuck.file}, in ${stuck.from}, couldn't be applied, so it and every later Answers file wait for the next Run: see the Answers Step's log.`])
    throw new Error("An Answer couldn't be applied, so its Answers file and every later one stay for the next Run")
  }
})
