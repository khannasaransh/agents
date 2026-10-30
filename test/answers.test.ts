import assert from 'node:assert/strict'
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, test } from 'node:test'
import { answersFile, answersFileName, type AnswerItem, type AnswersFile } from '../src/answers.ts'
import { makeWorkspace, pdExamples, type Workspace } from './helpers.ts'

let ws: Workspace
afterEach(() => ws.cleanup())

/** The Run whose Brief Saransh answers, and the next Runs, which apply his Answers. */
const briefRun = '2026-10-27-0930'
const nextRun = '2026-10-28-0930'
const runAfter = '2026-10-29-0930'

const downloads = () => join(ws.homeDir, 'Downloads')
const inbox = () => join(ws.dataDir, 'broker-inbox')
const files = (folder: string) => (existsSync(folder) ? readdirSync(folder) : [])

/** Saves an Answers file where the browser would, or into the Broker inbox, under the name the button gives it. */
function save(file: AnswersFile, folder = downloads()): string {
  mkdirSync(folder, { recursive: true })
  const name = answersFileName(file)
  writeFileSync(join(folder, name), JSON.stringify(file))
  return name
}

/** A stocks Run about to apply Answers. */
function prepareRun(id: string, { dryRun = false } = {}) {
  ws.prepareRun(id, { pipeline: 'stocks', steps: ['answers', 'lake', 'health', 'brief'].map((name) => ({ name, status: 'pending' })), dryRun })
}

const step = (id: string, ...args: string[]) => ws.agents('step', 'answers', '--run', id, ...args)
const result = (id: string) => JSON.parse(ws.readRunFile(id, 'answers.json'))
const pdCallArgs = () => ws.pdCalls().map((call) => call.args)

/** The Answers of every file a Run read, oldest file first: item, Answer and what became of it. */
const outcomes = (id: string) => result(id).files.flatMap((f: any) => f.answers.map((a: any) => [a.item, a.answer, a.outcome]))

/** One Answers file of the Brief's Run, saved at `savedAt`. */
const file = (savedAt: string, answers: AnswersFile['answers']): AnswersFile => ({ kind: 'stocks-answers', run: briefRun, savedAt, answers })

test('an Answers file built from the items embedded in a Brief, the way the button builds it, is applied once', async () => {
  ws = makeWorkspace()
  ws.prepareRun(briefRun, { pipeline: 'stocks', steps: [{ name: 'lake', status: 'succeeded' }, { name: 'brief', status: 'pending' }] })
  ws.writeRunFile(briefRun, 'lake/status.json', JSON.parse(readFileSync(join(pdExamples, 'status.healthy.json'), 'utf8')))
  assert.equal((await ws.agents('step', 'brief', '--run', briefRun)).status, 0)
  const page = ws.readRunFile(briefRun, 'brief.html')

  // What the page embeds: the Run, each item waiting with the Answers it takes, and the function its button runs.
  const items: AnswerItem[] = JSON.parse(page.match(/<script type="application\/json" id="answer-items">([\s\S]*?)<\/script>/)![1])
  assert.deepEqual(items.slice(0, 2), [
    { item: 'correction:7', answers: ['approve', 'reject'] },
    { item: 'quarantine:5', answers: ['dismiss'] },
  ])
  assert.ok(page.includes(String(answersFile)), "the button runs answersFile's own source")
  assert.ok(page.includes(String(answersFileName)), "and names the file with answersFileName's")
  assert.ok(page.includes(`const run = "${briefRun}"`), 'it names its own Run')
  const built: AnswersFile = new Function(`return ${String(answersFile)}`)()(briefRun, items, { 'correction:7': { answer: 'approve', note: '  Checked against BSE  ' }, 'quarantine:5': { answer: 'dismiss' }, 'quarantine:4': { answer: 'approve' } }, '2026-10-27T03:10:00.000Z')
  assert.deepEqual(built, {
    kind: 'stocks-answers',
    run: briefRun,
    savedAt: '2026-10-27T03:10:00.000Z',
    answers: [
      { item: 'correction:7', answer: 'approve', note: 'Checked against BSE' },
      { item: 'quarantine:5', answer: 'dismiss' },
    ],
  })

  // Saved to Downloads, and the same file dropped into the Broker inbox too.
  const name = save(built)
  save(built, inbox())
  prepareRun(nextRun)
  ws.setPd({ corrections: { example: 'corrections-decide.approved.json' }, quarantines: { example: 'quarantines-dismiss.dismissed.json' } })

  const ran = await step(nextRun)

  assert.equal(ran.status, 0, ran.stderr)
  assert.deepEqual(pdCallArgs(), [
    ['corrections', 'approve', '7'],
    ['quarantines', 'dismiss', '5'],
  ])
  assert.deepEqual(outcomes(nextRun), [
    ['correction:7', 'approve', 'applied'],
    ['quarantine:5', 'dismiss', 'applied'],
    ['correction:7', 'approve', 'ignored'],
    ['quarantine:5', 'dismiss', 'ignored'],
  ])
  assert.match(result(nextRun).files[1].answers[0].why, /applied already/)
  assert.equal(result(nextRun).files[0].answers[0].note, 'Checked against BSE')
  // Both files moved into the Run.
  assert.deepEqual(files(downloads()), [])
  assert.deepEqual(files(inbox()), [])
  assert.deepEqual(ws.runFiles(nextRun, 'answers').sort(), [name, name.replace('.json', ' (2).json')].sort())

  // The next Run finds nothing to apply.
  prepareRun(runAfter)
  assert.equal((await step(runAfter)).status, 0)
  assert.equal(ws.pdCalls().length, 2)
  assert.deepEqual(result(runAfter).files, [])
})

test('an Answer to a settled item is ignored and logged, and its file still moves into the Run', async () => {
  ws = makeWorkspace()
  prepareRun(nextRun)
  const name = save(
    file('2026-10-27T03:10:00.000Z', [
      { item: 'correction:7', answer: 'reject' },
      { item: 'quarantine:99', answer: 'dismiss' },
      { item: 'quarantine:5', answer: 'approve' },
      { item: 'lesson:12', answer: 'approve' },
    ]),
  )
  ws.setPd({ corrections: { example: 'corrections-decide.decided.json' }, quarantines: { example: 'quarantines-dismiss.none.json', exitCode: 1 } })

  const ran = await step(nextRun)

  assert.equal(ran.status, 0, ran.stderr)
  assert.deepEqual(pdCallArgs(), [
    ['corrections', 'reject', '7'],
    ['quarantines', 'dismiss', '99'],
  ])
  const answers = result(nextRun).files[0].answers
  assert.deepEqual(
    answers.map((a: any) => [a.item, a.outcome, a.why]),
    [
      ['correction:7', 'ignored', 'Correction 7 was approved already'],
      ['quarantine:99', 'ignored', 'There is no Quarantine 99'],
      ['quarantine:5', 'ignored', 'A quarantine takes dismiss, not approve'],
      ['lesson:12', 'ignored', "lesson:12 isn't an item the Brief asks about"],
    ],
  )
  const log = ws.readRunFile(nextRun, 'logs/answers.log')
  assert.match(log, /Ignored correction:7 reject.*: Correction 7 was approved already/)
  assert.deepEqual(ws.runFiles(nextRun, 'answers'), [name])
  assert.deepEqual(files(downloads()), [])
})

test("an old file can't undo a newer Answer", async () => {
  ws = makeWorkspace()
  // The newer Answer is applied first.
  prepareRun(nextRun)
  save(file('2026-10-28T08:00:00.000Z', [{ item: 'correction:7', answer: 'reject' }]))
  ws.setPd({ corrections: { example: 'corrections-decide.rejected.json' } })
  assert.equal((await step(nextRun)).status, 0)
  assert.deepEqual(outcomes(nextRun), [['correction:7', 'reject', 'applied']])

  // Then an older file turns up, in the Broker inbox.
  save(file('2026-10-27T03:10:00.000Z', [{ item: 'correction:7', answer: 'approve' }]), inbox())
  prepareRun(runAfter)
  const ran = await step(runAfter)

  assert.equal(ran.status, 0, ran.stderr)
  assert.deepEqual(pdCallArgs(), [['corrections', 'reject', '7']], 'the old Answer never reaches ash_new')
  assert.deepEqual(outcomes(runAfter), [['correction:7', 'approve', 'ignored']])
  assert.match(result(runAfter).files[0].answers[0].why, /A newer Answer, saved at 2026-10-28T08:00:00.000Z, was applied in Run 2026-10-28-0930/)
  assert.deepEqual(files(inbox()), [])
})

test('Answers files are applied oldest first, wherever they were found', async () => {
  ws = makeWorkspace()
  prepareRun(nextRun)
  save(file('2026-10-28T08:00:00.000Z', [{ item: 'correction:7', answer: 'reject' }]))
  save(file('2026-10-27T03:10:00.000Z', [{ item: 'correction:7', answer: 'approve' }]), inbox())
  ws.setPd({ corrections: [{ example: 'corrections-decide.approved.json' }, { example: 'corrections-decide.decided.json' }] })

  assert.equal((await step(nextRun)).status, 0)

  assert.deepEqual(pdCallArgs(), [
    ['corrections', 'approve', '7'],
    ['corrections', 'reject', '7'],
  ])
  assert.deepEqual(outcomes(nextRun), [
    ['correction:7', 'approve', 'applied'],
    ['correction:7', 'reject', 'ignored'],
  ])
})

test('a dry run applies no Answer and consumes no Answers file', async () => {
  ws = makeWorkspace()
  prepareRun(nextRun, { dryRun: true })
  const name = save(file('2026-10-27T03:10:00.000Z', [{ item: 'correction:7', answer: 'approve' }]))

  const ran = await step(nextRun)

  assert.equal(ran.status, 0, ran.stderr)
  assert.deepEqual(pdCallArgs(), [])
  assert.deepEqual(files(downloads()), [name])
  assert.equal(result(nextRun).dryRun, true)
  assert.deepEqual(outcomes(nextRun), [['correction:7', 'approve', 'dry-run']])

  // A real Run after it still applies the file.
  prepareRun(runAfter)
  ws.setPd({ corrections: { example: 'corrections-decide.approved.json' } })
  assert.equal((await step(runAfter)).status, 0)
  assert.deepEqual(outcomes(runAfter), [['correction:7', 'approve', 'applied']])
})

test("a file that isn't an Answers file is left where it is, with a To-do, and the rest are applied", async () => {
  ws = makeWorkspace()
  prepareRun(nextRun)
  mkdirSync(downloads(), { recursive: true })
  writeFileSync(join(downloads(), 'stocks-answers-broken.json'), '{"kind": "stocks-ans')
  writeFileSync(join(downloads(), 'tradebook.json'), '{}')
  save(file('2026-10-27T03:10:00.000Z', [{ item: 'quarantine:5', answer: 'dismiss' }]))
  ws.setPd({ quarantines: { example: 'quarantines-dismiss.dismissed.json' } })

  const ran = await step(nextRun)

  assert.equal(ran.status, 0, ran.stderr)
  assert.deepEqual(outcomes(nextRun), [['quarantine:5', 'dismiss', 'applied']])
  assert.deepEqual(files(downloads()).sort(), ['stocks-answers-broken.json', 'tradebook.json'])
  const [todo] = JSON.parse(ws.readRunFile(nextRun, 'todos/answers.json'))
  assert.match(todo, /stocks-answers-broken\.json in .*Downloads isn't an Answers file the Answers Step can read/)
})

test("an Answer pd can't apply fails the Step and leaves its file and every later one for the next Run", async () => {
  ws = makeWorkspace()
  prepareRun(nextRun)
  const older = save(file('2026-10-27T03:10:00.000Z', [{ item: 'quarantine:5', answer: 'dismiss' }, { item: 'correction:7', answer: 'approve' }]))
  const newer = save(file('2026-10-28T03:10:00.000Z', [{ item: 'quarantine:4', answer: 'dismiss' }]))
  ws.setPd({ quarantines: { example: 'quarantines-dismiss.dismissed.json' }, corrections: { stderr: 'database is locked\n', exitCode: 2 } })

  const ran = await step(nextRun)

  assert.equal(ran.status, 1)
  assert.deepEqual(pdCallArgs(), [
    ['quarantines', 'dismiss', '5'],
    ['corrections', 'approve', '7'],
  ])
  assert.deepEqual(outcomes(nextRun), [
    ['quarantine:5', 'dismiss', 'applied'],
    ['correction:7', 'approve', 'failed'],
    ['quarantine:4', 'dismiss', 'not-tried'],
  ])
  assert.match(result(nextRun).files[0].answers[1].why, /database is locked/)
  assert.deepEqual(files(downloads()).sort(), [older, newer].sort())
  assert.deepEqual(ws.runFiles(nextRun, 'answers'), [])
  const [todo] = JSON.parse(ws.readRunFile(nextRun, 'todos/answers.json'))
  assert.match(todo, new RegExp(`An Answer in ${older}, in .*Downloads, couldn't be applied, so it and every later Answers file wait for the next Run`))
})

test("two different Answers saved at the same moment are both put to pd, Downloads' first", async () => {
  ws = makeWorkspace()
  prepareRun(nextRun)
  save(file('2026-10-27T03:10:00.000Z', [{ item: 'correction:7', answer: 'approve' }]))
  save(file('2026-10-27T03:10:00.000Z', [{ item: 'correction:7', answer: 'reject' }]), inbox())
  ws.setPd({ corrections: [{ example: 'corrections-decide.approved.json' }, { example: 'corrections-decide.decided.json' }] })

  assert.equal((await step(nextRun)).status, 0)

  assert.deepEqual(pdCallArgs(), [
    ['corrections', 'approve', '7'],
    ['corrections', 'reject', '7'],
  ])
  assert.deepEqual(outcomes(nextRun), [
    ['correction:7', 'approve', 'applied'],
    ['correction:7', 'reject', 'ignored'],
  ])
})

test('an Answer approving a Candidate moves it into Paper through pd stages approve, and a second is ignored with why', async () => {
  ws = makeWorkspace()
  ws.prepareRun(briefRun, { pipeline: 'stocks', steps: [{ name: 'lake', status: 'succeeded' }, { name: 'stages', status: 'succeeded' }, { name: 'brief', status: 'pending' }] })
  ws.writeRunFile(briefRun, 'lake/status.json', JSON.parse(readFileSync(join(pdExamples, 'status.clean.json'), 'utf8')))
  ws.writeRunFile(briefRun, 'stages.json', JSON.parse(readFileSync(join(pdExamples, 'stages-check.books.json'), 'utf8')))
  assert.equal((await ws.agents('step', 'brief', '--run', briefRun)).status, 0)
  const items: AnswerItem[] = JSON.parse(ws.readRunFile(briefRun, 'brief.html').match(/<script type="application\/json" id="answer-items">([\s\S]*?)<\/script>/)![1])
  assert.deepEqual(items, [{ item: 'candidate:3', answers: ['approve'] }])
  save(answersFile(briefRun, items, { 'candidate:3': { answer: 'approve' } }, '2026-10-27T03:10:00.000Z'))
  save(file('2026-10-27T03:20:00.000Z', [{ item: 'candidate:3', answer: 'approve' }]), inbox())
  prepareRun(nextRun)
  ws.setPd({ stages: [{ example: 'stages-approve.approved.json' }, { example: 'stages-approve.decided.json' }] })

  assert.equal((await step(nextRun)).status, 0)

  assert.deepEqual(pdCallArgs(), [
    ['stages', 'approve', '3'],
    ['stages', 'approve', '3'],
  ])
  assert.deepEqual(outcomes(nextRun), [
    ['candidate:3', 'approve', 'applied'],
    ['candidate:3', 'approve', 'ignored'],
  ])
  assert.equal(result(nextRun).files[1].answers[0].why, 'It is in Paper already, since 2026-10-28')
})

test("an Answer on a Judgement proposal approves or rejects it through pd judgement", async () => {
  ws = makeWorkspace()
  ws.prepareRun(briefRun, { pipeline: 'stocks', steps: [{ name: 'check', status: 'succeeded' }, { name: 'brief', status: 'pending' }] })
  ws.writeRunFile(briefRun, 'judgement-show.json', JSON.parse(readFileSync(join(pdExamples, 'judgement-show.books.json'), 'utf8')))
  assert.equal((await ws.agents('step', 'brief', '--run', briefRun)).status, 0)
  const items: AnswerItem[] = JSON.parse(ws.readRunFile(briefRun, 'brief.html').match(/<script type="application\/json" id="answer-items">([\s\S]*?)<\/script>/)![1])
  assert.deepEqual(items, [
    { item: 'exit:3', answers: ['approve', 'reject'] },
    { item: 'judgement:3', answers: ['approve', 'reject'] },
  ])
  save(answersFile(briefRun, items, { 'judgement:3': { answer: 'reject', note: 'Not yet' } }, '2026-10-27T03:10:00.000Z'))
  prepareRun(nextRun)
  ws.setPd({ judgement: { example: 'judgement-decide.approved.json' } })

  assert.equal((await step(nextRun)).status, 0)

  assert.deepEqual(pdCallArgs(), [['judgement', 'reject', '3']])
  assert.deepEqual(outcomes(nextRun), [['judgement:3', 'reject', 'applied']])
})

test('an Answer on an early exit the Desk proposed approves it through pd exits, so the next Rule plan sells the holding', async () => {
  ws = makeWorkspace()
  ws.prepareRun(briefRun, { pipeline: 'stocks', steps: [{ name: 'check', status: 'succeeded' }, { name: 'brief', status: 'pending' }] })
  ws.writeRunFile(briefRun, 'judgement-show.json', JSON.parse(readFileSync(join(pdExamples, 'judgement-show.books.json'), 'utf8')))
  assert.equal((await ws.agents('step', 'brief', '--run', briefRun)).status, 0)
  const items: AnswerItem[] = JSON.parse(ws.readRunFile(briefRun, 'brief.html').match(/<script type="application\/json" id="answer-items">([\s\S]*?)<\/script>/)![1])
  save(answersFile(briefRun, items, { 'exit:3': { answer: 'approve' } }, '2026-10-27T03:10:00.000Z'))
  prepareRun(nextRun)
  ws.setPd({ exits: { example: 'exits-decide.approved.json' } })

  assert.equal((await step(nextRun)).status, 0)

  assert.deepEqual(pdCallArgs(), [['exits', 'approve', '3']])
  assert.deepEqual(outcomes(nextRun), [['exit:3', 'approve', 'applied']])
})

test('an Answer on a promotion approves it through pd stages promote, or rejects it through pd stages reject', async () => {
  ws = makeWorkspace()
  ws.prepareRun(briefRun, { pipeline: 'stocks', steps: [{ name: 'stages', status: 'succeeded' }, { name: 'brief', status: 'pending' }] })
  ws.writeRunFile(briefRun, 'stages.json', JSON.parse(readFileSync(join(pdExamples, 'stages-check.promotion.json'), 'utf8')))
  assert.equal((await ws.agents('step', 'brief', '--run', briefRun)).status, 0)
  const items: AnswerItem[] = JSON.parse(ws.readRunFile(briefRun, 'brief.html').match(/<script type="application\/json" id="answer-items">([\s\S]*?)<\/script>/)![1])
  assert.deepEqual(items, [
    { item: 'candidate:3', answers: ['approve'] },
    { item: 'promotion:4', answers: ['approve', 'reject'] },
  ])
  save(answersFile(briefRun, items, { 'promotion:4': { answer: 'approve' } }, '2026-10-31T03:10:00.000Z'))
  save(file('2026-10-31T03:20:00.000Z', [{ item: 'promotion:5', answer: 'reject' }]), inbox())
  prepareRun(nextRun)
  ws.setPd({ stages: [{ example: 'stages-decide.promoted.json' }, { stdout: JSON.stringify({ changed: true, why: null, proposal: null, sleeve: null }) }] })

  assert.equal((await step(nextRun)).status, 0)

  assert.deepEqual(pdCallArgs(), [
    ['stages', 'promote', '4'],
    ['stages', 'reject', '5'],
  ])
  assert.deepEqual(outcomes(nextRun), [
    ['promotion:4', 'approve', 'applied'],
    ['promotion:5', 'reject', 'applied'],
  ])
})

test("an Answer on a real Book's order or Disaster stop is applied with when it was saved, and a late one is recorded but ignored", async () => {
  ws = makeWorkspace()
  prepareRun(nextRun)
  save(
    file('2026-10-27T03:10:00.000Z', [
      { item: 'order:21', answer: 'placed' },
      { item: 'order:12', answer: 'placed' },
      { item: 'stop:7', answer: 'placed' },
      { item: 'stop:8', answer: 'skipped' },
    ]),
  )
  ws.setPd({ orders: [{ example: 'orders-mark.placed.json' }, { example: 'orders-mark.late.json', exitCode: 1 }, { example: 'orders-mark.stop.json' }] })

  const ran = await step(nextRun)

  assert.equal(ran.status, 0, ran.stderr)
  assert.deepEqual(pdCallArgs(), [
    ['orders', 'mark', '21', 'placed', '--saved-at', '2026-10-27T03:10:00.000Z'],
    ['orders', 'mark', '12', 'placed', '--saved-at', '2026-10-27T03:10:00.000Z'],
    ['orders', 'stop', '7', '--saved-at', '2026-10-27T03:10:00.000Z'],
  ])
  assert.deepEqual(
    result(nextRun).files[0].answers.map((a: any) => [a.item, a.outcome, a.why]),
    [
      ['order:21', 'applied', undefined],
      ['order:12', 'ignored', 'Its session, 2026-10-30, was over when the Answer was saved: the Answer is recorded, but the order stays expired'],
      ['stop:7', 'applied', undefined],
      ['stop:8', 'ignored', 'A stop takes placed, not skipped'],
    ],
  )
})
