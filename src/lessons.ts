// Lessons (issue 41; the stocks Pipeline PRD's "Journal and Lessons"): what the Portfolio Manager
// learns from its Journal and the override scorecard, each applied only once Saransh approves it. They
// are its Memory file `lessons`, which its config has reviewed: Save state queues each Lesson it
// proposes on its own (`agents memory`, as lesson-<id>), and Saransh's Answer, in the Brief or by
// `agents memory accept|reject`, adds it to that file under Approved or Rejected, whatever else the
// file holds by then. The Portfolio Manager reads the file whole: an approved Lesson shapes its
// decisions, and a rejected one it doesn't propose again. A Lesson may change one Lever's Playbook
// range in a Book: Save state records the change in ash_new (`pd judgement propose`) tied to the
// Lesson, and the Lesson's Answer approves or rejects it too, so an approved range is the Playbook's,
// which the final check holds every decision to. A Lesson that widens a range cites the override
// scorecard's figures for its Lever, or isn't queued; ash_new refuses one the scorecard doesn't
// support.
import { pendingProposals, decideProposal, readMemory, type MemoryAddition, type MemoryProposal } from './memory.ts'
import { pdJson, rangeLevers, type PdDecided, type PdDecisionRecord, type PdLever, type PdPlaybook, type PdReview } from './pd.ts'

/** The Portfolio Manager, whose Memory the Lessons are, and its Lessons file. */
export const lessonsAgent = 'portfolio-manager'
export const lessonsMemory = 'lessons'

/** A Playbook range a Lesson changes, by its name, with its new value. */
export interface LessonRange {
  name: keyof typeof rangeLevers
  value: number
}

/** A Lesson as the Portfolio Manager proposes it in its answer. */
export interface ProposedLesson {
  /** The Lesson, in a sentence or two: what it will do differently. */
  lesson: string
  /** Why: what in its Journal and the scorecard taught it, with the figures. */
  why: string
  /** A range change's Book and Lever; null for a Lesson that changes no range. */
  book: 'IN' | 'US' | 'HK' | null
  lever: PdLever | null
  ranges: LessonRange[]
  /** The figures it rests on, as a Decision record cites them: a widening one's must include the scorecard's for its Lever. */
  figures: PdDecisionRecord['figures']
}

/** A Lesson queued for Saransh: its id, the Run that proposed it, and ash_new's proposal of its range change (null: none). */
export interface Lesson extends ProposedLesson {
  id: number
  run: string
  judgement: number | null
}

/** Where a Lesson goes in the Lessons file, approved or rejected. */
const addition: MemoryAddition = { file: lessonsMemory, title: '# Lessons', accepted: 'Approved', rejected: 'Rejected' }

/** A Lesson's queue name: lesson-3. */
export const lessonName = (id: number) => `lesson-${id}`

/** A range change in words: "the India Book's size Lever: size_max 0.8". */
export function lessonChangeText(lesson: Pick<ProposedLesson, 'book' | 'lever' | 'ranges'>, books: Record<string, string> = {}): string | null {
  if (!lesson.ranges.length || !lesson.book) return null
  const book = books[lesson.book] ?? lesson.book
  return `${book}'s ${lesson.lever ?? 'unnamed'} Lever: ${lesson.ranges.map((r) => `${r.name} ${r.value}`).join(', ')}`
}

/** A Lesson as the Lessons file holds it: its heading, its words, why, and its range change. */
export function lessonBlock(lesson: Lesson): string {
  const change = lessonChangeText(lesson)
  return [
    `### Lesson ${lesson.id}, from Run ${lesson.run}`,
    '',
    lesson.lesson,
    '',
    `Why: ${lesson.why}`,
    ...(change ? ['', `Range: ${change}${lesson.judgement === null ? '' : ` (ash_new's proposal ${lesson.judgement})`}`] : []),
  ].join('\n')
}

/** Each Lesson in the Lessons file, by its id, with whether it was approved and its words. */
export function lessonsIn(file: string): { id: number; approved: boolean; lesson: string }[] {
  const found: { id: number; approved: boolean; words: string[]; reading: boolean }[] = []
  let approved = true
  // Saransh may have edited it on Windows.
  for (const line of file.replace(/\r\n?/g, '\n').split('\n')) {
    const current = found.at(-1)
    const id = /^### Lesson (\d+)/.exec(line)
    if (line.startsWith('## ')) approved = line.slice(3).trim() !== addition.rejected
    if (line.startsWith('#')) {
      if (current) current.reading = false
      if (id) found.push({ id: Number(id[1]), approved, words: [], reading: true })
    } else if (current?.reading) {
      // Its words end where why it was learnt begins.
      if (/^(Why|Range): /.test(line)) current.reading = false
      else current.words.push(line)
    }
  }
  return found.map(({ id, approved: was, words }) => ({ id, approved: was, lesson: words.join(' ').trim() }))
}

/** The ids of the Lessons Saransh approved: the only ones a Decision record may follow. */
export function approvedLessons(): Set<number> {
  return new Set(lessonsIn(readMemory(lessonsAgent, lessonsMemory)).flatMap((l) => (l.approved ? [l.id] : [])))
}

/** The Lessons waiting for Saransh's Answer, oldest first. */
export function waitingLessons(): Lesson[] {
  return pendingProposals()
    .flatMap((p) => (p.agent === lessonsAgent && p.lesson ? [p.lesson] : []))
    .sort((a, b) => a.id - b.id)
}

/** The next Lesson's id: after every one in the Lessons file and the queue. */
export function nextLessonId(): number {
  const ids = [...lessonsIn(readMemory(lessonsAgent, lessonsMemory)).map((l) => l.id), ...waitingLessons().map((l) => l.id)]
  return Math.max(0, ...ids) + 1
}

/** A Lesson's proposal for the queue: it adds its block to the Lessons file once settled. */
export function lessonProposal(lesson: Lesson): MemoryProposal {
  return { agent: lessonsAgent, name: lessonName(lesson.id), run: lesson.run, memory: lessonBlock(lesson), adds: addition, lesson }
}

/** A Lesson's words as compared with another's: case and spacing aside. */
const plain = (words: string) => words.toLowerCase().replace(/\s+/g, ' ').trim()

/** The Lesson approved, rejected or waiting already with these words, if one is: it isn't proposed again. */
export function sameLesson(words: string): { id: number; as: 'approved' | 'rejected' | 'waiting' } | null {
  const filed = lessonsIn(readMemory(lessonsAgent, lessonsMemory)).find((l) => plain(l.lesson) === plain(words))
  if (filed) return { id: filed.id, as: filed.approved ? 'approved' : 'rejected' }
  const waiting = waitingLessons().find((l) => plain(l.lesson) === plain(words))
  return waiting ? { id: waiting.id, as: 'waiting' } : null
}

/** Whether a range's new value widens it: a lower exposure floor or size_min, a higher size_max, more timing sessions, a higher rebalance_under. */
export function widens(range: LessonRange, playbook: PdPlaybook | null): boolean {
  if (!playbook) return true
  const lower = range.name.startsWith('exposure_floor.') || range.name === 'size_min'
  const current = range.name.startsWith('exposure_floor.') ? playbook.exposure_floor[range.name.slice('exposure_floor.'.length) as keyof PdPlaybook['exposure_floor']] : (playbook[range.name as Exclude<LessonRange['name'], `exposure_floor.${string}`>] as number)
  return lower ? range.value < current : range.value > current
}

/** Every object in a JSON value, its own first. */
function* objects(value: unknown): Generator<Record<string, unknown>> {
  if (Array.isArray(value)) for (const each of value) yield* objects(each)
  else if (value && typeof value === 'object') {
    yield value as Record<string, unknown>
    for (const each of Object.values(value)) yield* objects(each)
  }
}

/** The value at a dotted path of an object; undefined when it has none. */
function at(found: unknown, path: string): unknown {
  return path.split('.').reduce<unknown>((value, key) => (value && typeof value === 'object' ? (value as Record<string, unknown>)[key] : undefined), found)
}

/** Whether a cited value is the input's: a number within 1% of it, anything else exactly. */
function matches(cited: unknown, value: unknown): boolean {
  if (typeof cited === 'number' && typeof value === 'number') return Math.abs(cited - value) <= Math.abs(value) * 0.01 + 1e-9
  return cited === value
}

/**
 * Whether a Lesson cites the override scorecard's figures for its Lever: some figure of review.json
 * about the Lever (its `security`), found at its field in the Book's scorecard's tally of that Lever,
 * at its value.
 */
export function citesScorecard(lesson: ProposedLesson, review: PdReview | null): boolean {
  const scorecard = review?.books.find((b) => b.book === lesson.book)?.scorecard
  if (!scorecard || !lesson.lever) return false
  const tallies = [...objects(scorecard)].filter((o) => o.key === lesson.lever)
  return lesson.figures.some((f) => f.input === 'review.json' && f.security === lesson.lever && tallies.some((t) => matches(f.value, at(t, f.field))))
}

/** What an Answer on a Lesson did: whether it settled it, and why not. */
export type LessonDecided = PdDecided

/** How long `pd judgement approve` or `reject` may take: it writes a row. */
const decideMs = 2 * 60_000

/**
 * Saransh's Answer on a waiting Lesson: its range change's proposal in ash_new approved or rejected
 * first (`pd judgement`), then the Lesson added to the Lessons file, approved or rejected. One not
 * waiting changes nothing. Call it holding the Run lock.
 */
export async function decideLesson(id: number, decision: 'accepted' | 'rejected', { cwd }: { cwd: string }): Promise<LessonDecided> {
  const lesson = waitingLessons().find((l) => l.id === id)
  if (!lesson) return { changed: false, why: `No Lesson ${id} is waiting for you` }
  if (lesson.judgement !== null) {
    // It exits 1 when there is no such proposal, still saying why as JSON. One decided already counts
    // only when it was decided the same way: else the Lesson keeps waiting, and the Brief says why.
    const wanted = decision === 'accepted' ? 'approved' : 'rejected'
    const decided = await pdJson<PdDecided & { proposal?: { decision: string | null } | null }>(['judgement', decision === 'accepted' ? 'approve' : 'reject', String(lesson.judgement)], { cwd, timeoutMs: decideMs, exitCodes: [0, 1] })
    if (decided.proposal?.decision !== wanted) return { changed: false, why: `ash_new didn't ${decision === 'accepted' ? 'approve' : 'reject'} its range change, proposal ${lesson.judgement}: ${decided.why ?? 'it says nothing more'}` }
  }
  decideProposal(lessonsAgent, lessonName(id), decision)
  return { changed: true, why: null }
}
