// Answers: what Saransh decides in the Stocks Brief. Each item waiting on him has an id, such as
// correction:7, and the Answers it takes. The Brief's Save answers button downloads one Answers file
// naming the Run and each Answer, and the next Run's Answers Step applies it through `pd`. A kind of
// item is added here, with its Answers and the `pd` command that applies one, and the Brief and the
// Step follow (the stocks Pipeline PRD's "Answers").
import type { PdJudgementShow, PdSleeve, PdStagesCheck, PdStatus } from './pd.ts'

/** Each kind of item waiting on Saransh: the Answers it takes, and the `pd` command that applies one to the item with this id. */
const kinds = {
  correction: { answers: ['approve', 'reject'], pd: (id: string, answer: string) => ['corrections', answer, id] },
  quarantine: { answers: ['dismiss'], pd: (id: string) => ['quarantines', 'dismiss', id] },
  // Approving a Candidate moves it into Paper, which launches its strategy in ash_new.
  candidate: { answers: ['approve'], pd: (id: string) => ['stages', 'approve', id] },
  // A proposal to move a Book's Judgement mode or change its Playbook's ranges.
  judgement: { answers: ['approve', 'reject'], pd: (id: string, answer: string) => ['judgement', answer, id] },
} satisfies Record<string, { answers: string[]; pd(id: string, answer: string): string[] }>

/** An item waiting on Saransh, as the Brief embeds it: its id and the Answers it takes. */
export interface AnswerItem {
  item: string
  answers: string[]
}

/** One Answer: an item's id, what Saransh chose, and his note, if he wrote one. */
export interface Answer {
  item: string
  answer: string
  note?: string
}

/** An Answers file, as the Save answers button downloads it. */
export interface AnswersFile {
  kind: 'stocks-answers'
  /** The Run whose Brief it was saved from. */
  run: string
  savedAt: string
  answers: Answer[]
}

/** An item of a kind, by its id in ash_new: correction:7. */
export function answerItem(kind: keyof typeof kinds, id: number): AnswerItem {
  return { item: `${kind}:${id}`, answers: kinds[kind].answers }
}

/** The Candidates Saransh may approve into Paper: each still at its strategy's version, Book by Book. */
export function waitingCandidates(stages: PdStagesCheck | null): (PdSleeve & { id: number })[] {
  return (stages?.books ?? []).flatMap((b) => b.sleeves.filter((s): s is PdSleeve & { id: number } => s.stage === 'candidate' && s.id !== null && s.version === s.current_version))
}

/**
 * The items waiting on Saransh: each waiting Correction and each Quarantine in the Lake's status, then
 * each Candidate, then each proposal to move a Judgement mode or change a Playbook's ranges.
 */
export function waitingItems(status: PdStatus | null, stages: PdStagesCheck | null, judgement: PdJudgementShow | null = null): AnswerItem[] {
  return [
    ...(status?.corrections ?? []).map((c) => answerItem('correction', c.id)),
    ...(status?.quarantines ?? []).map((q) => answerItem('quarantine', q.id)),
    ...waitingCandidates(stages).map((s) => answerItem('candidate', s.id)),
    ...(judgement?.proposals ?? []).map((p) => answerItem('judgement', p.id)),
  ]
}

/** An item's kind and its id in ash_new, from the item's id: correction:7. */
function parseItem(item: string): { kind: string; id: string } {
  const [kind, id = ''] = item.split(':')
  return { kind, id }
}

/** A word as the Brief shows it on a button or in a name: Approve, Correction. */
export const capitalised = (word: string) => `${word.charAt(0).toUpperCase()}${word.slice(1)}`

/** An item's id as the Brief names it: Correction 7. */
export function itemName(item: string): string {
  const { kind, id } = parseItem(item)
  return `${capitalised(kind)} ${id}`
}

/**
 * The Answers file for what Saransh chose in a Brief, by item id: only the items it embeds, and
 * only an Answer each of them takes. The Brief runs this very function, from its source, so it
 * is written as plain JavaScript once its types are stripped, using nothing outside itself.
 */
export function answersFile(run: string, items: AnswerItem[], chosen: Record<string, { answer: string; note?: string }>, savedAt: string): AnswersFile {
  const answers: Answer[] = []
  for (const { item, answers: allowed } of items) {
    const choice = chosen[item]
    if (!choice || !allowed.includes(choice.answer)) continue
    const note = (choice.note ?? '').trim()
    answers.push(note ? { item, answer: choice.answer, note } : { item, answer: choice.answer })
  }
  return { kind: 'stocks-answers', run, savedAt, answers }
}

/** The name the Save answers button gives a file: stocks-answers-<run>-<time saved>.json. */
export function answersFileName(file: AnswersFile): string {
  return `stocks-answers-${file.run}-${file.savedAt.replace(/[^0-9]/g, '').slice(0, 14)}.json`
}

/** Whether a file, by its name, is an Answers file the Step reads, as a browser may rename one: stocks-answers-… (2).json. */
export function isAnswersFileName(name: string): boolean {
  return /^stocks-answers.*\.json$/i.test(name)
}

/** Why `value` isn't an Answers file, or null when it is one. */
export function answersFileError(value: unknown): string | null {
  const file = value as Partial<AnswersFile> | null
  if (typeof file !== 'object' || file === null || file.kind !== 'stocks-answers') return "it isn't an Answers file"
  if (typeof file.run !== 'string' || !file.run) return 'it names no Run'
  if (typeof file.savedAt !== 'string' || Number.isNaN(Date.parse(file.savedAt))) return 'it has no time it was saved'
  if (!Array.isArray(file.answers)) return 'it has no Answers'
  const bad = file.answers.findIndex((a) => typeof a?.item !== 'string' || typeof a?.answer !== 'string' || (a.note !== undefined && typeof a.note !== 'string'))
  return bad === -1 ? null : `its Answer ${bad + 1} names no item or no Answer`
}

/** The `pd` arguments that apply an Answer, or why the Answer isn't one its item takes. */
export function pdArgs({ item, answer }: Answer): { args: string[] } | { why: string } {
  const { kind, id } = parseItem(item)
  const known = Object.hasOwn(kinds, kind) ? kinds[kind as keyof typeof kinds] : null
  if (!known || !/^\d+$/.test(id)) return { why: `${item} isn't an item the Brief asks about` }
  if (!known.answers.includes(answer)) return { why: `A ${kind} takes ${known.answers.join(' or ')}, not ${answer}` }
  return { args: known.pd(id, answer) }
}

