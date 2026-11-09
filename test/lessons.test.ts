import assert from 'node:assert/strict'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, test } from 'node:test'
import { answersFileName, type AnswersFile } from '../src/answers.ts'
import { makeWorkspace, pdExamples, type Workspace } from './helpers.ts'

// Lessons (issue 41): the Portfolio Manager proposes them, Save state queues them while it applies the
// Journal, and Saransh's Answer settles each into the Lessons file, approved or rejected.

let ws: Workspace
afterEach(() => ws.cleanup())

const runId = '2026-10-27-0930'
const nextRun = '2026-10-28-0930'
const example = (name: string) => JSON.parse(readFileSync(join(pdExamples, name), 'utf8'))
const step = (name: string, run = runId) => ws.agents('step', name, '--run', run)

const narrowing = {
  lesson: 'Hold a buy back at most 3 sessions: a longer wait has bought dearer',
  why: 'My two waits past 3 sessions lost 18.1 bp to the Rule plan',
  book: 'IN',
  lever: 'timing',
  ranges: [{ name: 'timing_sessions', value: 3 }],
  figures: [],
}
const plain = { lesson: 'Weigh a Chart veto above an Events one in a Correction', why: 'Chart vetoes beat the Rule plan twice', book: null, lever: null, ranges: [], figures: [] }

/** The Portfolio Manager's answer, proposing `lessons`. */
const answer = (lessons: unknown[]) => ({
  books: example('judgement.answered.json').books,
  review: null,
  monthly: null,
  yearly: null,
  promotions: [],
  narrower: [],
  expectations: [],
  lessons,
  journal: { entries: ['Held the plan'], open: ['Watch Stove Kraft'] },
})

/** What `claude --print --output-format json` prints when its schema-checked answer is `answer`. */
const claudeCodeAnswering = (answer: unknown) => ({
  stdout: JSON.stringify({ type: 'result', subtype: 'success', is_error: false, num_turns: 6, result: JSON.stringify(answer), structured_output: answer }),
})

/** A stocks Run whose Plan Step succeeded, about to judge its plans. */
function prepare(run: string, steps = ['plan', 'portfolio-manager', 'check', 'save-state', 'brief']) {
  ws.prepareRun(run, { pipeline: 'stocks', steps: steps.map((name) => ({ name, status: name === 'plan' ? 'succeeded' : 'pending' })) })
  ws.writeRunFile(run, 'plan.json', example('plan.normal.json'))
  ws.writeRunFile(run, 'book-states.json', { states: [example('book-state.paper.json')] })
  ws.writeRunFile(run, 'stages.json', example('stages-check.books.json'))
}

/** The Portfolio Manager judging `run` and proposing `lessons`, then its Save state. */
async function judgeAndSave(run: string, lessons: unknown[]) {
  ws.setWorkerCli('claude', claudeCodeAnswering(answer(lessons)))
  assert.equal((await step('portfolio-manager', run)).status, 0)
  const saved = await step('save-state', run)
  assert.equal(saved.status, 0, saved.stderr)
  return JSON.parse(ws.readRunFile(run, 'lessons.json')).lessons as { lesson: { id: number; judgement: number | null } | null; why: string | null }[]
}

/** The input an Agent's prompt gave it by `name`. */
function promptInput(prompt: string, name: string): unknown {
  const block = new RegExp(`### ${name}: [^\\n]*\\n\\n\`\`\`(json)?\\n([\\s\\S]*?)\\n\`\`\`\\n`).exec(prompt)
  assert.ok(block, `no ${name} input in the prompt`)
  return block[1] ? JSON.parse(block[2]) : block[2]
}

/** An Answers file of `run`'s Brief, saved in Downloads. */
function answer_(answers: AnswersFile['answers'], savedAt = '2026-10-27T16:00:00.000Z') {
  const file: AnswersFile = { kind: 'stocks-answers', run: runId, savedAt, answers }
  const folder = join(ws.homeDir, 'Downloads')
  mkdirSync(folder, { recursive: true })
  writeFileSync(join(folder, answersFileName(file)), JSON.stringify(file))
}

test('the Journal is applied while a Lesson waits for Saransh, which `agents memory` lists', async () => {
  ws = makeWorkspace()
  prepare(runId)
  ws.writeMemory('portfolio-manager', 'journal', '# Journal\n')

  const [queued] = await judgeAndSave(runId, [plain])

  assert.match(ws.readMemory('portfolio-manager', 'journal') ?? '', /- Held the plan/)
  assert.equal(ws.readMemory('portfolio-manager', 'lessons'), null, 'nothing is in the Lessons file until Saransh answers')
  assert.deepEqual([queued.lesson?.id, queued.why], [1, null])
  assert.match(ws.readRunFile(runId, 'logs', 'save-state.log'), /Queued Lesson 1 for Saransh's Answer: Weigh a Chart veto/)
  const listed = (await ws.agents('memory')).stdout
  assert.match(listed, /^portfolio-manager lesson-1, proposed in Run 2026-10-27-0930:/m)
  assert.match(listed, /\+### Lesson 1, from Run 2026-10-27-0930/)
  assert.match(listed, /agents memory accept portfolio-manager lesson-1/)
  // The Brief asks about it, with its Answers.
  assert.equal((await step('brief')).status, 0)
  const brief = ws.readRunFile(runId, 'brief.html')
  assert.match(brief, /<h2>Lessons waiting for your Answer: 1<\/h2>/)
  assert.match(brief, /data-item="lesson:1"/)
})

test("an approving Answer makes the Lesson the Portfolio Manager's input and its range change the Playbook's", async () => {
  ws = makeWorkspace()
  prepare(runId)
  ws.setPd({ judgement: [{ example: 'judgement-propose.narrower.json' }, { example: 'judgement-decide.approved.json' }] })

  // A narrower range needs no scorecard figures; ash_new records it as proposal 5, which the Lesson's Answer decides.
  const [queued] = await judgeAndSave(runId, [narrowing])
  assert.deepEqual([queued.lesson?.id, queued.lesson?.judgement], [1, 5])
  assert.equal((await step('brief')).status, 0)
  const brief = ws.readRunFile(runId, 'brief.html')
  assert.match(brief, /Changes the India Book&#39;s timing Lever: timing_sessions 3, as ash_new's proposal 5/)
  assert.doesNotMatch(brief, /data-item="judgement:5"/, "the Lesson's Answer decides its proposal")

  prepare(nextRun, ['answers', 'plan', 'portfolio-manager', 'brief'])
  answer_([{ item: 'lesson:1', answer: 'approve' }])
  const applied = await step('answers', nextRun)

  assert.equal(applied.status, 0, applied.stderr)
  assert.deepEqual(ws.pdCalls().slice(-1)[0].args, ['judgement', 'approve', '5'])
  const lessons = ws.readMemory('portfolio-manager', 'lessons') ?? ''
  assert.match(lessons, /^# Lessons\n\n## Approved\n\n### Lesson 1, from Run 2026-10-27-0930\n\nHold a buy back at most 3 sessions/)
  assert.match((await ws.agents('memory')).stdout, /^No Memory changes are waiting for you\.$/m)

  ws.setWorkerCli('claude', claudeCodeAnswering(answer([])))
  assert.equal((await step('portfolio-manager', nextRun)).status, 0)
  const [call] = ws.workerCliCalls('claude').slice(-1)
  const input = promptInput(call.stdin, 'lessons') as { file: string; waiting: unknown[] }
  assert.match(input.file, /## Approved\n\n### Lesson 1/)
  assert.deepEqual(input.waiting, [])
})

test('a rejected Lesson stays rejected: kept for the Portfolio Manager, never queued again, and a later approval changes nothing', async () => {
  ws = makeWorkspace()
  prepare(runId)
  await judgeAndSave(runId, [plain])

  const rejected = await ws.agents('memory', 'reject', 'portfolio-manager', 'lesson-1')

  assert.equal(rejected.status, 0, rejected.stderr)
  assert.match(rejected.stdout, /Rejected Lesson 1 from Run 2026-10-27-0930: it is under Rejected/)
  assert.match(ws.readMemory('portfolio-manager', 'lessons') ?? '', /## Rejected\n\n### Lesson 1, from Run 2026-10-27-0930\n\nWeigh a Chart veto/)
  // An Answer approving it afterwards finds nothing waiting.
  prepare(nextRun, ['answers', 'plan', 'portfolio-manager', 'save-state', 'brief'])
  answer_([{ item: 'lesson:1', answer: 'approve' }])
  assert.equal((await step('answers', nextRun)).status, 0)
  const [outcome] = JSON.parse(ws.readRunFile(nextRun, 'answers.json')).files[0].answers
  assert.deepEqual([outcome.outcome, outcome.why], ['ignored', 'No Lesson 1 is waiting for you'])
  assert.doesNotMatch(ws.readMemory('portfolio-manager', 'lessons') ?? '', /## Approved/)
  // Proposed again in other spacing, it isn't queued.
  const [again] = await judgeAndSave(nextRun, [{ ...plain, lesson: '  weigh a Chart veto above an Events one   in a Correction' }])
  assert.deepEqual([again.lesson, again.why], [null, 'It is Lesson 1, and you rejected it'])
  assert.match((await ws.agents('memory')).stdout, /^No Memory changes are waiting for you\.$/m)
})

test("a Lesson widening a range isn't queued without the override scorecard's figures for its Lever, and ash_new may still refuse one citing them", async () => {
  ws = makeWorkspace()
  prepare(runId)
  ws.writeRunFile(runId, 'review.json', example('review.saturday.json'))
  ws.setPd({ judgement: { example: 'judgement-propose.refused.json', exitCode: 1 } })
  const wider = { ...narrowing, lesson: 'Let a buy wait up to 8 sessions', ranges: [{ name: 'timing_sessions', value: 8 }] }
  const citing = { ...wider, lesson: 'Let a buy wait up to 7 sessions', ranges: [{ name: 'timing_sessions', value: 7 }], figures: [{ input: 'review.json', security: 'timing', field: 'bps', value: -18.1 }] }

  const [bare, cited] = await judgeAndSave(runId, [wider, citing])

  assert.deepEqual([bare.lesson, bare.why], [null, "It widens the timing Lever's range without citing the override scorecard's figures for it"])
  assert.equal(cited.lesson, null)
  assert.match(cited.why ?? '', /needs the override scorecard's support/)
  // Only the one citing the scorecard reached ash_new.
  assert.deepEqual(ws.pdCalls().map((c) => c.args.slice(0, 5)), [['judgement', 'propose', 'IN', '--playbook', 'timing_sessions=7']])
  assert.match((await ws.agents('memory')).stdout, /^No Memory changes are waiting for you\.$/m)
})

test('the Check Step hands ash_new only the approved Lessons a Decision record follows', async () => {
  ws = makeWorkspace()
  prepare(runId)
  ws.writeMemory('portfolio-manager', 'lessons', '# Lessons\n\n## Approved\n\n### Lesson 1, from Run 2026-10-20-0930\n\nHold buys back less.\n\n## Rejected\n\n### Lesson 2, from Run 2026-10-21-0930\n\nWait longer.\n')
  const books = example('judgement.answered.json').books.map((book: { changes: { decision: object }[] }) => ({
    ...book,
    changes: book.changes.map((change) => ({ ...change, decision: { ...change.decision, lessons: [1, 2, 9] } })),
  }))
  ws.writeRunFile(runId, 'portfolio-manager.json', { status: 'answered', answer: { ...answer([]), books }, journalRead: '', inputs: ['plan.json'] })
  ws.setPd({ check: { example: 'check.recorded.json' }, 'paper-books': { example: 'paper-books.json' }, judgement: { example: 'judgement-show.books.json' }, orders: { example: 'orders.waiting.json' } })

  const checked = await step('check')

  assert.equal(checked.status, 0, checked.stderr)
  const handed = JSON.parse(ws.readRunFile(runId, 'judgement.json'))
  const cited = handed.books.flatMap((b: { changes: { decision: { lessons: number[] } }[] }) => b.changes.map((c) => c.decision.lessons))
  assert.ok(cited.length)
  for (const lessons of cited) assert.deepEqual(lessons, [1])
})
