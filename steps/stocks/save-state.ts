// Save state: applies the Portfolio Manager's Journal, its Memory, and records the promotions it
// proposed. Its answer's new entries are added under the Run's id, the oldest Runs' dropped past what
// the Journal keeps, and what is still open is replaced by the answer's, so the Journal carries what
// is open from Run to Run. The change is applied and recorded in the Run, or queued for Saransh
// (`agents memory`) when the Journal changed after the Agent read it, so applying it never undoes
// that change. Each promotion is recorded in ash_new (`pd stages propose`), to wait for Saransh's
// Answer in the Brief; ash_new refuses one that isn't due, and says why. What became of each is kept
// as promotions.json, for the Brief. So is each narrower Playbook range it proposes for a Lever that
// lost to the Rule plan (issue 40; `pd judgement propose --playbook`), kept as narrower.json; one
// that changes another Lever's range isn't proposed, and ash_new refuses one that widens a range
// without the override scorecard's support. Each Lesson it proposes (issue 41, src/lessons.ts) is
// queued for Saransh's Answer, the Portfolio Manager's config having its Lessons reviewed, while the
// Journal is applied: one he approved, rejected or has waiting already isn't queued again, and one
// whose range change widens a range without citing the scorecard's figures for its Lever isn't
// queued at all. A Lesson's range change is recorded in ash_new first (`pd judgement propose`), and
// ash_new may refuse it. What became of each is kept as lessons.json, for the Brief. A Run whose Portfolio
// Manager didn't answer leaves the Journal as it is, and a dry run's ran on the fake Worker, so it
// never counts. A re-run applies nothing the Run already settled, and ash_new records no promotion
// twice.
import { existsSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { journalMemory } from '../../agents/portfolio-manager/config.ts'
import { readJson, writeJson } from '../../src/files.ts'
import { journalWith } from '../../src/journal.ts'
import { loadAgent, memoryChangesFor } from '../../src/agent.ts'
import { citesScorecard, lessonProposal, lessonsMemory, nextLessonId, sameLesson, widens, type Lesson, type ProposedLesson } from '../../src/lessons.ts'
import { buildsOnCurrent, isSettled, queueProposal, settleProposal, type MemoryProposal } from '../../src/memory.ts'
import { bookNames } from '../../src/brokers.ts'
import { pdJson, rangeLevers, type PdJudgementProposed, type PdPlan, type PdReview, type PdStagesDecided } from '../../src/pd.ts'
import { readRun } from '../../src/run.ts'
import { stageName } from '../../src/stages.ts'
import { runAsStep, StepSkipped } from '../../src/step.ts'
import type { NarrowerRanges, PortfolioManagerResult } from './portfolio-manager.ts'

const agent = 'portfolio-manager'
/** Who proposes a promotion, as ash_new records it. */
const proposer = 'the Portfolio Manager'
/** How long pd stages propose may take: the Sleeve's review again, its backtest read back. */
const proposeMs = 10 * 60_000

/** What Save state recorded of the Portfolio Manager's promotions, as promotions.json. */
export interface PromotionsResult {
  promotions: { sleeve: number; why: string; decided: PdStagesDecided }[]
}

/** What Save state recorded of the narrower ranges the Portfolio Manager proposed, as narrower.json. */
export interface NarrowerResult {
  narrower: (NarrowerRanges & { proposed: PdJudgementProposed })[]
}

/** What Save state did with each Lesson the Portfolio Manager proposed, as lessons.json: queued (or applied) as a Lesson, or why not. */
export interface LessonsResult {
  lessons: { proposed: ProposedLesson; lesson: Lesson | null; why: string | null }[]
}

/** What a Run's files say a Lesson is judged by: the review's scorecard, and each Book's Playbook in force. */
interface LessonInputs {
  runId: string
  runFolder: string
  review: PdReview | null
  plans: PdPlan | null
  reviewed: boolean
}

/** Why a Lesson isn't queued, or the Lesson queued, its range change recorded in ash_new first. */
async function queueLesson(proposed: ProposedLesson, { runId, runFolder, review, plans, reviewed }: LessonInputs): Promise<{ lesson: Lesson | null; why: string | null }> {
  const same = sameLesson(proposed.lesson)
  if (same) {
    const said = { approved: 'you approved it already', rejected: 'you rejected it', waiting: 'it waits for your Answer already' }[same.as]
    return { lesson: null, why: `It is Lesson ${same.id}, and ${said}` }
  }
  let judgement: number | null = null
  const id = nextLessonId()
  if (proposed.ranges.length) {
    const { book, lever, ranges } = proposed
    if (!book || !lever) return { lesson: null, why: 'Its range change names no Book or no Lever' }
    const others = ranges.filter(({ name }) => rangeLevers[name] !== lever).map(({ name }) => name)
    if (others.length) return { lesson: null, why: `It changes ${others.join(', ')}, which ${others.length === 1 ? "isn't" : "aren't"} the ${lever} Lever's range` }
    const playbook = plans?.plans.find((p) => p.book === book && (p.kind === 'paper' || p.kind === 'real') && p.playbook)?.playbook ?? null
    if (ranges.some((range) => widens(range, playbook)) && !citesScorecard(proposed, review)) {
      return { lesson: null, why: `It widens the ${lever} Lever's range without citing the override scorecard's figures for it` }
    }
    const args = ['judgement', 'propose', book, ...ranges.flatMap(({ name, value }) => ['--playbook', `${name}=${value}`]), '--why', `Lesson ${id}: ${proposed.lesson}`, '--by', proposer]
    // It exits 1 when it can't be made, saying why as JSON.
    const made = await pdJson<PdJudgementProposed>(args, { cwd: runFolder, timeoutMs: proposeMs, exitCodes: [0, 1] })
    if ('error' in made) return { lesson: null, why: made.error }
    judgement = made.proposal.id
  }
  const lesson: Lesson = { ...proposed, id, run: runId, judgement }
  // A range change waits for Saransh's Answer whatever the config says: only he changes a Playbook.
  if (reviewed || judgement !== null) queueProposal(lessonProposal(lesson))
  else settleProposal(lessonProposal(lesson), 'applied')
  return { lesson, why: null }
}

await runAsStep(async ({ runId, runFolder }) => {
  const file = join(runFolder, 'portfolio-manager.json')
  const out = join(runFolder, 'promotions.json')
  const narrowerOut = join(runFolder, 'narrower.json')
  const lessonsOut = join(runFolder, 'lessons.json')
  // What an earlier run of this Step recorded is recorded again from the answer, or not at all.
  for (const file of [out, narrowerOut, lessonsOut]) rmSync(file, { force: true })
  const result = existsSync(file) ? readJson<PortfolioManagerResult>(file) : null
  if (result?.status !== 'answered') throw new StepSkipped("The Portfolio Manager didn't answer in this Run, so its Journal stays as it is")
  if (readRun(runId).dryRun) throw new StepSkipped('The Portfolio Manager ran only on the fake Worker, so its Journal stays as it is')
  const memory = journalWith(result.journalRead, runId, result.answer.journal)
  const proposal: MemoryProposal = { agent, name: journalMemory, run: runId, memory, base: result.journalRead }
  const config = (await loadAgent(agent)).config
  const journalReviewed = memoryChangesFor(config, journalMemory) === 'review'
  if (isSettled(proposal)) {
    console.log('The Journal is already settled in this Run')
  } else if (journalReviewed || !buildsOnCurrent(proposal)) {
    const why = journalReviewed ? "since the Portfolio Manager's config has its Journal reviewed" : 'since it changed after the Portfolio Manager read it'
    if (queueProposal(proposal)) console.log(`Queued the Journal for Saransh (agents memory), ${why}`)
    else console.log("Left the Journal out of the queue, since a later Run's change waits there")
  } else {
    settleProposal(proposal, 'applied')
    console.log(`Applied the Journal: ${result.answer.journal.entries.length} new entries, ${result.answer.journal.open.length} items open`)
  }

  const recorded: PromotionsResult = { promotions: [] }
  for (const { sleeve, why } of result.answer.promotions) {
    // It exits 1 when there is no such Sleeve, still saying why as JSON.
    const decided = await pdJson<PdStagesDecided>(['stages', 'propose', String(sleeve), '--why', why, '--by', proposer], { cwd: runFolder, timeoutMs: proposeMs, exitCodes: [0, 1] })
    recorded.promotions.push({ sleeve, why, decided })
    writeJson(out, recorded)
    if (decided.changed && decided.proposal) console.log(`Proposed promoting Sleeve ${sleeve} into ${stageName(decided.proposal.stage)}, as promotion ${decided.proposal.id}, for Saransh's Answer`)
    else console.log(`Didn't propose promoting Sleeve ${sleeve}: ${decided.why}`)
  }
  writeJson(out, recorded)

  const narrowed: NarrowerResult = { narrower: [] }
  for (const each of result.answer.narrower) {
    const book = bookNames[each.book] ?? each.book
    const others = each.ranges.filter(({ name }) => rangeLevers[name] !== each.lever).map(({ name }) => name)
    const ranges = each.ranges.flatMap(({ name, value }) => ['--playbook', `${name}=${value}`])
    // It exits 1 when it can't be made, saying why as JSON.
    const proposed: PdJudgementProposed = others.length
      ? { error: `It changes ${others.join(', ')}, which ${others.length === 1 ? "isn't" : "aren't"} the ${each.lever} Lever's range` }
      : await pdJson<PdJudgementProposed>(['judgement', 'propose', each.book, ...ranges, '--why', each.why, '--by', proposer], { cwd: runFolder, timeoutMs: proposeMs, exitCodes: [0, 1] })
    narrowed.narrower.push({ ...each, proposed })
    writeJson(narrowerOut, narrowed)
    if ('proposal' in proposed) console.log(`Proposed narrowing the ${each.lever} Lever in ${book}, as proposal ${proposed.proposal.id}, for Saransh's Answer`)
    else console.log(`Didn't propose narrowing the ${each.lever} Lever in ${book}: ${proposed.error}`)
  }
  writeJson(narrowerOut, narrowed)

  const read = <T>(name: string) => (existsSync(join(runFolder, name)) ? readJson<T>(join(runFolder, name)) : null)
  const reviewed = memoryChangesFor(config, lessonsMemory) === 'review'
  const inputs: LessonInputs = { runId, runFolder, review: read<PdReview>('review.json'), plans: read<PdPlan>('plan.json'), reviewed }
  const learnt: LessonsResult = { lessons: [] }
  for (const proposed of result.answer.lessons ?? []) {
    const { lesson, why } = await queueLesson(proposed, inputs)
    learnt.lessons.push({ proposed, lesson, why })
    writeJson(lessonsOut, learnt)
    if (lesson) console.log(`${reviewed || lesson.judgement !== null ? 'Queued' : 'Applied'} Lesson ${lesson.id}${lesson.judgement === null ? '' : `, with its range change as proposal ${lesson.judgement}`}${reviewed || lesson.judgement !== null ? " for Saransh's Answer" : ''}: ${lesson.lesson}`)
    else console.log(`Didn't queue the Lesson "${proposed.lesson}": ${why}`)
  }
  writeJson(lessonsOut, learnt)
})
