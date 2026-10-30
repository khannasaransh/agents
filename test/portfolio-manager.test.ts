import assert from 'node:assert/strict'
import { readFileSync, realpathSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, test } from 'node:test'
import { makeWorkspace, pdExamples, type Workspace } from './helpers.ts'

let ws: Workspace
afterEach(() => ws.cleanup())

const runId = '2026-10-27-0930'
const example = (name: string) => JSON.parse(readFileSync(join(pdExamples, name), 'utf8'))
const step = (name: string) => ws.agents('step', name, '--run', runId)
const status = (name: string) => ws.readRun(runId).steps.find((s) => s.name === name)!.status
const result = () => JSON.parse(ws.readRunFile(runId, 'portfolio-manager.json'))

/** The Portfolio Manager's answer: the judgement pd check is handed, and its Journal. */
const answer = {
  books: example('judgement.answered.json').books,
  review: null,
  monthly: null,
  promotions: [],
  journal: { entries: ['Dropped Rategain: the weakest RS Rating of the plan in a Correction; judge on 2026-12-24'], open: ['Is Rategain still lagging on 2026-12-24?'] },
}

/** A stocks Run whose Plan Step ended as `plan`, leaving `planExample` and the Book states behind if it succeeded. */
function prepare({ plan = 'succeeded', planExample = 'plan.normal.json', dryRun = false } = {}) {
  ws = makeWorkspace()
  const steps = ['plan', 'portfolio-manager', 'check', 'save-state', 'brief'].map((name) => ({ name, status: name === 'plan' ? plan : 'pending' }))
  ws.prepareRun(runId, { pipeline: 'stocks', steps, dryRun })
  if (plan === 'succeeded') {
    ws.writeRunFile(runId, 'plan.json', example(planExample))
    ws.writeRunFile(runId, 'book-states.json', { states: [example('book-state.paper.json')] })
  }
  ws.writeRunFile(runId, 'stages.json', example('stages-check.books.json'))
}

/** What `claude --print --output-format json` prints when its schema-checked answer is `answer`. */
const claudeCodeAnswering = (answer: unknown) => ({
  stdout: JSON.stringify({ type: 'result', subtype: 'success', is_error: false, num_turns: 6, result: JSON.stringify(answer), structured_output: answer }),
})

/** What `codex exec --json` prints when its final answer is `answer`. */
const codexAnswering = (answer: unknown) => ({
  stdout: [
    { type: 'thread.started', thread_id: 'thread-1' },
    { type: 'item.completed', item: { id: 'item_1', type: 'agent_message', text: JSON.stringify(answer) } },
    { type: 'turn.completed', usage: { input_tokens: 1200, output_tokens: 80 } },
  ]
    .map((event) => JSON.stringify(event))
    .join('\n'),
})

/** The value of one input in an Agent's prompt, as the Worker's CLI was given it. */
function promptInput(prompt: string, name: string): unknown {
  const block = new RegExp(`### ${name}: [^\\n]*\\n\\n\`\`\`(json)?\\n([\\s\\S]*?)\\n\`\`\`\\n`).exec(prompt)
  assert.ok(block, `no ${name} input in the prompt:\n${prompt}`)
  return block[1] ? JSON.parse(block[2]) : block[2]
}

test('the Portfolio Manager runs on Claude Code, read-only in the Run folder, given the Rule plans, the Book states, the Stages, the diagnosis and its Journal', async () => {
  prepare()
  ws.writeMemory('portfolio-manager', 'journal', '# Journal\n\n## Open\n\n- Watch Stove Kraft\n')
  ws.setWorkerCli('claude', claudeCodeAnswering(answer))

  const ran = await step('portfolio-manager')

  assert.equal(ran.status, 0, ran.stderr)
  const [call, ...more] = ws.workerCliCalls('claude')
  assert.deepEqual(more, [])
  assert.deepEqual(ws.workerCliCalls('codex'), [])
  assert.equal(realpathSync(call.cwd), realpathSync(join(ws.dataDir, 'runs', runId)))
  assert.equal(call.args[call.args.indexOf('--tools') + 1], 'Read,Grep,Glob,Bash', 'no tool that writes')
  assert.deepEqual(promptInput(call.stdin, 'plans'), example('plan.normal.json'))
  assert.deepEqual(promptInput(call.stdin, 'bookStates'), { states: [example('book-state.paper.json')] })
  assert.deepEqual(promptInput(call.stdin, 'stages'), example('stages-check.books.json'))
  assert.equal(promptInput(call.stdin, 'health'), null, 'the Lake was healthy, so there is no diagnosis')
  assert.equal(promptInput(call.stdin, 'dossiers'), null)
  assert.match(promptInput(call.stdin, 'journal') as string, /Watch Stove Kraft/)
  // Its answer is kept with the Journal it read and the files its Decision records may cite.
  assert.deepEqual(result(), {
    status: 'answered',
    answer,
    journalRead: '# Journal\n\n## Open\n\n- Watch Stove Kraft\n',
    inputs: ['plan.json', 'book-states.json', 'stages.json'],
  })
  assert.match(ws.readRunFile(runId, 'logs', 'portfolio-manager.log'), /India Book's paper Book: exposure level 40%, 2 changes from the Rule plan/)
})

test('the Portfolio Manager falls back to Codex when Claude Code fails', async () => {
  prepare()
  ws.setWorkerCli('claude', { stderr: 'Claude Code is down\n', exitCode: 1 })
  ws.setWorkerCli('codex', codexAnswering(answer))

  const ran = await step('portfolio-manager')

  assert.equal(ran.status, 0, ran.stderr)
  assert.equal(ws.workerCliCalls('codex').length, 1)
  assert.equal(result().status, 'answered')
  assert.match(ws.readRunFile(runId, 'logs', 'portfolio-manager.log'), /portfolio-manager failed on claude-code[\s\S]*retrying once on codex[\s\S]*portfolio-manager answered on codex/)
})

test('after both Workers fail, the failure is recorded and the Check Step sends the Rule plans with a note the Brief shows', async () => {
  prepare()
  ws.setWorkerCli('claude', { stderr: 'Claude Code is down\n', exitCode: 1 })
  ws.setWorkerCli('codex', { stdout: JSON.stringify({ type: 'turn.failed', error: { message: "You've hit your usage limit." } }), exitCode: 1 })
  ws.setPd({ check: { example: 'check.recorded.json' }, 'paper-books': { example: 'paper-books.json' }, judgement: { example: 'judgement-show.books.json' } })

  const ran = await step('portfolio-manager')
  const checked = await step('check')
  await step('brief')

  assert.equal(ran.status, 1)
  assert.equal(status('portfolio-manager'), 'failed')
  assert.equal(result().status, 'failed')
  assert.match(result().error, /claude-code failed: Claude Code is down; then codex failed: You've hit your usage limit\./)
  assert.equal(checked.status, 0, checked.stderr)
  const judgement = JSON.parse(ws.readRunFile(runId, 'judgement.json'))
  assert.equal(judgement.status, 'failed')
  assert.match(judgement.why, /^The Portfolio Manager failed: claude-code failed: Claude Code is down/)
  assert.deepEqual(judgement.books, [])
  const [check] = ws.pdCalls()
  assert.ok(check.args[check.args.indexOf('--judgement') + 1].endsWith(join(runId, 'judgement.json')))
  assert.match(ws.readRunFile(runId, 'logs', 'check.log'), /The Portfolio Manager failed: .*each paper Book's Rule plan goes out instead/)
  assert.match(ws.readRunFile(runId, 'brief.html'), /The Portfolio Manager failed, so each paper Book's Rule plan went out instead, once it passed the final check: claude-code failed: Claude Code is down/)
})

test('the Portfolio Manager judges nothing when the Plan Step failed, or no paper Book has a plan', async () => {
  prepare({ plan: 'failed' })
  assert.equal((await step('portfolio-manager')).status, 0)
  assert.equal(status('portfolio-manager'), 'skipped')
  assert.match(ws.readRunFile(runId, 'logs', 'portfolio-manager.log'), /Skipped: The Plan Step failed, so there is no Rule plan to judge/)
  ws.cleanup()

  prepare({ planExample: 'plan.cant-plan.json' })
  assert.equal((await step('portfolio-manager')).status, 0)
  assert.equal(status('portfolio-manager'), 'skipped')
  assert.deepEqual(ws.workerCliCalls('claude'), [])
})

test('a dry run judges on the fake Worker, and its Journal is never applied', async () => {
  prepare({ dryRun: true })
  ws.writeMemory('portfolio-manager', 'journal', 'Before')

  assert.equal((await step('portfolio-manager')).status, 0)
  assert.equal((await step('save-state')).status, 0)

  assert.deepEqual(ws.workerCliCalls('claude'), [])
  assert.equal(result().status, 'answered')
  assert.equal(status('save-state'), 'skipped')
  assert.equal(ws.readMemory('portfolio-manager', 'journal'), 'Before')
})

test("Save state applies the Portfolio Manager's Journal: its new entries under the Run, and what is still open", async () => {
  prepare()
  ws.writeMemory('portfolio-manager', 'journal', '# Journal\n\n## Open\n\n- Watch Stove Kraft\n\n## Entries\n\n### 2026-10-26-0930\n\n- Held the plan\n')
  ws.setWorkerCli('claude', claudeCodeAnswering(answer))

  await step('portfolio-manager')
  const saved = await step('save-state')

  assert.equal(saved.status, 0, saved.stderr)
  assert.equal(
    ws.readMemory('portfolio-manager', 'journal'),
    [
      '# Journal',
      '',
      '## Open',
      '',
      '- Is Rategain still lagging on 2026-12-24?',
      '',
      '## Entries',
      '',
      '### 2026-10-26-0930',
      '',
      '- Held the plan',
      '',
      `### ${runId}`,
      '',
      '- Dropped Rategain: the weakest RS Rating of the plan in a Correction; judge on 2026-12-24',
      '',
    ].join('\n'),
  )
  // Run again, it applies nothing twice.
  assert.equal((await step('save-state')).status, 0)
  assert.match(ws.readRunFile(runId, 'logs', 'save-state.log'), /already settled in this Run/)
})

test('a Journal Saransh changed after the Portfolio Manager read it is queued for him, not applied over his change', async () => {
  prepare()
  ws.writeMemory('portfolio-manager', 'journal', 'Before')
  ws.setWorkerCli('claude', claudeCodeAnswering(answer))
  await step('portfolio-manager')
  ws.writeMemory('portfolio-manager', 'journal', 'Saransh edited it')

  assert.equal((await step('save-state')).status, 0)

  assert.equal(ws.readMemory('portfolio-manager', 'journal'), 'Saransh edited it')
  assert.match(ws.readRunFile(runId, 'logs', 'save-state.log'), /Queued the Journal for Saransh/)
})

test("on Saturdays the Portfolio Manager gets the review's figures, writes its commentary and proposes the promotions due, which Save state records for Saransh's Answer", async () => {
  prepare()
  ws.writeRunFile(runId, 'review.json', example('review.saturday.json'))
  const proposing = {
    ...answer,
    review: 'India Super 30 OK is inside its tested range after three months of Paper.',
    promotions: [
      { sleeve: 2, why: 'Three months of Paper inside its tested range' },
      { sleeve: 7, why: 'Not due' },
    ],
  }
  ws.setWorkerCli('claude', claudeCodeAnswering(proposing))
  ws.setPd({ stages: [{ example: 'stages-propose.proposed.json' }, { example: 'stages-propose.not-due.json' }] })

  assert.equal((await step('portfolio-manager')).status, 0)
  const saved = await step('save-state')

  const [call] = ws.workerCliCalls('claude')
  assert.deepEqual(promptInput(call.stdin, 'review'), example('review.saturday.json'))
  assert.deepEqual(result().inputs, ['plan.json', 'book-states.json', 'stages.json', 'review.json'], 'a Decision record may cite the review')
  assert.match(ws.readRunFile(runId, 'logs', 'portfolio-manager.log'), /Proposes promoting Sleeve 2: Three months of Paper inside its tested range/)
  assert.equal(saved.status, 0, saved.stderr)
  assert.deepEqual(
    ws.pdCalls().map((c) => c.args),
    [
      ['stages', 'propose', '2', '--why', 'Three months of Paper inside its tested range', '--by', 'the Portfolio Manager'],
      ['stages', 'propose', '7', '--why', 'Not due', '--by', 'the Portfolio Manager'],
    ],
  )
  const recorded = JSON.parse(ws.readRunFile(runId, 'promotions.json'))
  assert.deepEqual(recorded.promotions.map((p: { sleeve: number; decided: { changed: boolean } }) => [p.sleeve, p.decided.changed]), [[2, true], [7, false]])
  const log = ws.readRunFile(runId, 'logs', 'save-state.log')
  assert.match(log, /Proposed promoting Sleeve 2 into Real-small, as promotion 4, for Saransh's Answer/)
  assert.match(log, /Didn't propose promoting Sleeve 7: Its promotion isn't due: Its record is outside its tested range/)
})

test("on a month's first Saturday the Portfolio Manager gets the monthly review's figures with the weekly ones, and writes its commentary", async () => {
  prepare()
  ws.writeRunFile(runId, 'review.json', example('review.monthly.json'))
  const monthly = "The India Book made 2.1% in October: 1.1% from the market through its Sleeve's weight, 0.6% from its picks, and 0.1% from my Overrides."
  ws.setWorkerCli('claude', claudeCodeAnswering({ ...answer, review: 'Both Books are inside their tested ranges.', monthly }))

  assert.equal((await step('portfolio-manager')).status, 0)

  const [call] = ws.workerCliCalls('claude')
  assert.deepEqual((promptInput(call.stdin, 'review') as { monthly: unknown }).monthly, example('review.monthly.json').monthly)
  assert.match(call.stdin, /The monthly review/)
  assert.equal(result().answer.monthly, monthly)
})

test('a weekly review is commented on even on a day the Plan Step failed', async () => {
  prepare({ plan: 'failed' })
  ws.writeRunFile(runId, 'review.json', example('review.saturday.json'))
  ws.setWorkerCli('claude', claudeCodeAnswering({ ...answer, books: [], review: 'Nothing to judge today; the India Book is inside its range.' }))

  assert.equal((await step('portfolio-manager')).status, 0)

  assert.equal(status('portfolio-manager'), 'succeeded')
  const [call] = ws.workerCliCalls('claude')
  assert.equal(promptInput(call.stdin, 'plans'), null)
  assert.equal(result().answer.review, 'Nothing to judge today; the India Book is inside its range.')
})
