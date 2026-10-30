import assert from 'node:assert/strict'
import { readFileSync, realpathSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, test } from 'node:test'
import { makeWorkspace, pdExamples, type Workspace, type WorkerCliCall } from './helpers.ts'

let ws: Workspace
afterEach(() => ws.cleanup())

const runId = '2026-10-27-0930'
const example = (name: string) => JSON.parse(readFileSync(join(pdExamples, name), 'utf8'))
const step = (name: string, run = runId) => ws.agents('step', name, '--run', run)
const stepStatus = (name: string, run = runId) => ws.readRun(run).steps.find((s) => s.name === name)!.status
const desk = (run = runId) => JSON.parse(ws.readRunFile(run, 'desk.json'))
const log = (run = runId) => ws.readRunFile(run, 'logs', 'desk.log')

/** Rategain's dossier, as pd plan wrote it; Stove Kraft's, the same but for its name and order. */
function dossiers(): Record<string, any> {
  const rategain = example('dossier.india.json')
  const stovekraft = {
    ...rategain,
    security_id: 'IN:STOVEKRAFT',
    name: 'Stove Kraft Ltd',
    sector: 'Consumer Discretionary',
    events: [],
    orders: [{ ...rategain.orders[0], id: 'IN-paper-2026-10-26-002', shares: 2398, price: 62.52, limit: 64.4 }],
  }
  return { 'IN:RATEGAIN': rategain, 'IN:STOVEKRAFT': stovekraft }
}

/**
 * A stocks Run whose Plan Step made `plan` (plan.normal.json's: two buys, Rategain with results
 * coming, so Chart, Events and Risk are needed) with its dossiers, and whose Feeds Step fetched.
 */
function prepare({ run = runId, plan = example('plan.normal.json'), dossierOf = dossiers(), dryRun = false } = {}) {
  const steps = ['plan', 'feeds', 'desk', 'portfolio-manager', 'check', 'brief'].map((name) => ({ name, status: ['plan', 'feeds'].includes(name) ? 'succeeded' : 'pending' }))
  ws.prepareRun(run, { pipeline: 'stocks', steps, dryRun })
  ws.writeRunFile(run, 'plan.json', plan)
  ws.writeRunFile(run, 'book-states.json', { states: [example('book-state.paper.json')] })
  ws.writeRunFile(run, 'feeds.json', example('feeds.fetched.json'))
  for (const [id, dossier] of Object.entries(dossierOf)) ws.writeRunFile(run, `dossiers/${id.replace(':', '_')}.json`, dossier)
}

const view = (security_id: string, kind = 'none', more: Record<string, unknown> = {}) => ({
  book: 'IN',
  security_id,
  view: kind,
  size: null,
  reasons: kind === 'none' ? 'Nothing against it.' : 'Results in two days, after a run of 30%.',
  evidence: kind === 'none' ? [] : [{ source: 'feed', cite: 'nse_board_meetings:IN:RATEGAIN:2026-10-29', says: 'Its board meets on 29 October to consider results.' }],
  ...more,
})

/** Each analyst's answer, by its instructions' title as its prompt holds it. */
const answers: Record<string, unknown> = {
  '# Events analyst': { views: [view('IN:RATEGAIN', 'veto')], searches: [] },
  '# Chart analyst': { views: [view('IN:RATEGAIN', 'trim', { size: 0.5, evidence: [{ source: 'dossier', cite: 'bars', says: 'It closed 24% above its 50-day average.' }] }), view('IN:STOVEKRAFT')], searches: [] },
  '# Risk analyst': { views: [view('IN:RATEGAIN'), view('IN:STOVEKRAFT')], searches: [] },
}

const claudeCodeAnswering = (answer: unknown) => ({
  stdout: JSON.stringify({ type: 'result', subtype: 'success', is_error: false, num_turns: 4, result: JSON.stringify(answer), structured_output: answer }),
})
const codexAnswering = (answer: unknown) => ({
  stdout: [{ type: 'thread.started', thread_id: 'thread-1' }, { type: 'item.completed', item: { id: 'item_1', type: 'agent_message', text: JSON.stringify(answer) } }, { type: 'turn.completed', usage: { input_tokens: 900, output_tokens: 60 } }]
    .map((event) => JSON.stringify(event))
    .join('\n'),
})
const failing = { stderr: 'down\n', exitCode: 1 }

/** Both Workers answer as each analyst would; `failOn` names the Worker that fails every call. */
function workersAnswer({ failOn }: { failOn?: 'claude' | 'codex' } = {}) {
  for (const [cli, answering] of [['claude', claudeCodeAnswering], ['codex', codexAnswering]] as const) {
    const byPrompt = Object.fromEntries(Object.entries(answers).map(([title, answer]) => [title, cli === failOn ? failing : answering(answer)]))
    ws.setWorkerCli(cli, { ...failing, byPrompt })
  }
}

/** The calls a Worker's CLI received for an analyst, by its instructions' title. */
const callsFor = (cli: 'claude' | 'codex', title: string) => ws.workerCliCalls(cli).filter((c) => c.stdin.includes(title))

/** The value of one input in an Agent's prompt. */
function promptInput(call: WorkerCliCall, name: string): any {
  const block = new RegExp(`### ${name}: [^\\n]*\\n\\n\`\`\`json\\n([\\s\\S]*?)\\n\`\`\`\\n`).exec(call.stdin)
  assert.ok(block, `no ${name} input in the prompt`)
  return JSON.parse(block[1])
}

test("each analyst the review list needs is called at once, read-only in the Run folder, with its names and its part of their dossiers", async () => {
  ws = makeWorkspace()
  prepare()
  workersAnswer()

  const ran = await step('desk')

  assert.equal(ran.status, 0, ran.stderr)
  const [events] = callsFor('codex', '# Events analyst')
  const [risk] = callsFor('claude', '# Risk analyst')
  const [chart] = callsFor('claude', '# Chart analyst')
  assert.equal(ws.workerCliCalls('codex').length, 1)
  assert.equal(ws.workerCliCalls('claude').length, 2)
  for (const call of [events, risk, chart]) assert.equal(realpathSync(call.cwd), realpathSync(join(ws.dataDir, 'runs', runId)))
  // Events and Risk may search the web; Chart may not. Events runs on Codex, Chart and Risk on Claude Code.
  assert.ok(events.args.includes('web_search="live"'))
  assert.equal(risk.args[risk.args.indexOf('--tools') + 1], 'Read,Grep,Glob,Bash,WebSearch')
  assert.equal(chart.args[chart.args.indexOf('--tools') + 1], 'Read,Grep,Glob,Bash')
  // Events reviews the name with results coming, from its events, fundamentals and MarketSmith's snapshot.
  const [rategain] = promptInput(events, 'names')
  assert.deepEqual(promptInput(events, 'names').map((n: any) => n.security_id), ['IN:RATEGAIN'])
  assert.deepEqual(rategain.coming, ['nse_board_meetings:IN:RATEGAIN:2026-10-29'])
  assert.deepEqual(Object.keys(rategain.dossier), ['security_id', 'name', 'market', 'currency', 'sector', 'industry', 'marketsmith', 'fundamentals', 'events', 'orders'])
  assert.equal(rategain.dossier.events[0].id, 'nse_board_meetings:IN:RATEGAIN:2026-10-29')
  assert.deepEqual(promptInput(events, 'feeds').map((s: any) => s.status), example('feeds.fetched.json').sources.map((s: any) => s.status))
  // Chart reviews each buy from its bars.
  assert.deepEqual(promptInput(chart, 'names').map((n: any) => n.security_id), ['IN:RATEGAIN', 'IN:STOVEKRAFT'])
  assert.deepEqual(promptInput(chart, 'names')[0].dossier.bars, example('dossier.india.json').bars)
  // Risk reviews the Book's buys together, against its holdings.
  assert.deepEqual(promptInput(risk, 'names').map((n: any) => n.security_id), ['IN:RATEGAIN', 'IN:STOVEKRAFT'])
  assert.deepEqual(promptInput(risk, 'holdings'), { IN: [] })
  // Its holdings come with their results and board meetings to come, but no amounts.
  const held = example('plan.normal.json')
  held.plans.find((p: any) => p.kind === 'paper').holdings = [{ sleeve: 'in-super30-ok-tuned', security_id: 'IN:RATEGAIN', name: 'Rategain Travel Technologies Ltd', shares: 865, close: 173.38, sector: 'Information Technology', rs_rating: 94, value: 149974, stop: 140, sellable: true }]
  ws.cleanup()
  ws = makeWorkspace()
  prepare({ plan: held })
  workersAnswer()
  assert.equal((await step('desk')).status, 0)
  assert.deepEqual(promptInput(callsFor('claude', '# Risk analyst')[0], 'holdings'), {
    IN: [{ security_id: 'IN:RATEGAIN', name: 'Rategain Travel Technologies Ltd', sector: 'Information Technology', coming: [{ date: '2026-10-29', kind: 'results', title: 'Financial Results' }] }],
  })
  const kept = desk()
  assert.deepEqual(kept.analysts.map((a: any) => [a.analyst, a.status, a.asked]), [['chart', 'answered', 2], ['events', 'answered', 1], ['risk', 'answered', 2]])
  assert.deepEqual(kept.views.map((v: any) => [v.analyst, v.security_id, v.view, v.reused]), [
    ['chart', 'IN:RATEGAIN', 'trim', false],
    ['chart', 'IN:STOVEKRAFT', 'none', false],
    ['events', 'IN:RATEGAIN', 'veto', false],
    ['risk', 'IN:RATEGAIN', 'none', false],
    ['risk', 'IN:STOVEKRAFT', 'none', false],
  ])
  assert.deepEqual(kept.missing, [])
  assert.match(log(), /Events on Rategain Travel Technologies Ltd \(IN:RATEGAIN, a buy\): veto: Results in two days/)
})

test("an analyst no name needs isn't called, and the Desk skips itself when no analyst is needed", async () => {
  ws = makeWorkspace()
  const plan = example('plan.normal.json')
  plan.review = { ...plan.review, names: plan.review.names.map((n: any) => ({ ...n, analysts: n.analysts.filter((a: any) => a.analyst === 'chart') })), risk: [], analysts: ['chart'] }
  prepare({ plan })
  workersAnswer()

  assert.equal((await step('desk')).status, 0)

  assert.deepEqual(ws.workerCliCalls('codex'), [])
  assert.deepEqual(ws.workerCliCalls('claude').map((c) => c.stdin.split(/\r?\n/)[0]), ['# Chart analyst'])
  assert.deepEqual(desk().analysts.map((a: any) => a.analyst), ['chart'])
  ws.cleanup()

  ws = makeWorkspace()
  prepare({ plan: { ...plan, review: { ...plan.review, names: [], analysts: [] } } })
  assert.equal((await step('desk')).status, 0)
  assert.equal(stepStatus('desk'), 'skipped')
  assert.match(log(), /Skipped: No name needs an analyst today/)
  assert.deepEqual([...ws.workerCliCalls('claude'), ...ws.workerCliCalls('codex')], [])
})

test("a view is reused, keeping its date, while nothing its analyst reads for the name has changed, and the Plan Step passes Events' last views", async () => {
  ws = makeWorkspace()
  prepare()
  workersAnswer()
  assert.equal((await step('desk')).status, 0)
  const first = desk().views
  const later = '2026-10-28-0930'

  prepare({ run: later })
  assert.equal((await step('desk', later)).status, 0)

  // Nothing changed, so no analyst is called, and every view keeps the date it was made.
  assert.equal(ws.workerCliCalls('claude').length + ws.workerCliCalls('codex').length, 3)
  assert.deepEqual(desk(later).analysts.map((a: any) => [a.analyst, a.status]), [['chart', 'reused'], ['events', 'reused'], ['risk', 'reused']])
  assert.deepEqual(desk(later).views.map((v: any) => [v.analyst, v.security_id, v.viewed_at, v.reused]), first.map((v: any) => [v.analyst, v.security_id, v.viewed_at, true]))

  // A new event for Rategain is new to Events and Risk, which read events; Chart reads only the bars.
  const third = '2026-10-29-0930'
  const changed = dossiers()
  changed['IN:RATEGAIN'].events = [...changed['IN:RATEGAIN'].events, { ...changed['IN:RATEGAIN'].events[0], id: 'nse_announcements:IN:RATEGAIN:1', kind: 'announcement', title: 'Resignation of the auditor' }]
  prepare({ run: third, dossierOf: changed })
  assert.equal((await step('desk', third)).status, 0)
  assert.deepEqual(desk(third).analysts.map((a: any) => [a.analyst, a.status, a.asked, a.reused]), [['chart', 'reused', 0, 2], ['events', 'answered', 1, 0], ['risk', 'answered', 2, 0]])

  // The next plan is told when Events last viewed each name, so an event fetched since is new.
  ws.setPd({ plan: { example: 'plan.normal.json' }, 'book-state': { example: 'book-state.paper.json' } })
  const fourth = '2026-10-30-0930'
  ws.prepareRun(fourth, { pipeline: 'stocks', steps: [{ name: 'plan', status: 'pending' }] })
  assert.equal((await step('plan', fourth)).status, 0)
  const [planned] = ws.pdCalls()
  assert.deepEqual(planned.args.slice(-2), ['--last-views', 'last-views.json'])
  const events = desk(third).views.find((v: any) => v.analyst === 'events')
  assert.deepEqual(JSON.parse(ws.readRunFile(fourth, 'last-views.json')), { 'IN:RATEGAIN': events.viewed_at })
  assert.match(events.viewed_at, /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d$/, 'in UTC without an offset')
})

test('each analyst falls back to the other Worker', async () => {
  ws = makeWorkspace()
  prepare()
  // Events starts on Codex; Chart and Risk start on Claude Code. Each primary fails, and the other answers.
  ws.setWorkerCli('codex', {
    ...failing,
    byPrompt: {
      '# Events analyst': failing,
      '# Chart analyst': codexAnswering(answers['# Chart analyst']),
      '# Risk analyst': codexAnswering(answers['# Risk analyst']),
    },
  })
  ws.setWorkerCli('claude', {
    ...failing,
    byPrompt: {
      '# Events analyst': claudeCodeAnswering(answers['# Events analyst']),
      '# Chart analyst': failing,
      '# Risk analyst': failing,
    },
  })
  assert.equal((await step('desk')).status, 0)
  assert.equal(callsFor('claude', '# Events analyst').length, 1)
  assert.equal(callsFor('codex', '# Chart analyst').length, 1)
  assert.equal(callsFor('codex', '# Risk analyst').length, 1)
  assert.deepEqual(desk().analysts.map((a: any) => a.status), ['answered', 'answered', 'answered'])
  assert.match(log(), /events failed on codex[\s\S]*retrying once on claude-code[\s\S]*events answered on claude-code/)
  for (const analyst of ['chart', 'risk']) assert.match(log(), new RegExp(`${analyst} failed on claude-code[\\s\\S]*retrying once on codex[\\s\\S]*${analyst} answered on codex`))
})

test("an analyst that fails on both Workers fails the Step, and the buys it had to review are missing their review; a view it may not give is refused", async () => {
  ws = makeWorkspace()
  prepare()
  // Chart fails on both Workers; Events vetoes Rategain but cites the web without a link.
  const unsourced = { views: [view('IN:RATEGAIN', 'veto', { evidence: [{ source: 'web', cite: 'Moneycontrol', says: 'Results moved.' }] })], searches: [] }
  ws.setWorkerCli('codex', failing)
  ws.setWorkerCli('claude', { ...failing, byPrompt: { '# Events analyst': claudeCodeAnswering(unsourced), '# Risk analyst': claudeCodeAnswering(answers['# Risk analyst']) } })

  const ran = await step('desk')

  assert.equal(ran.status, 1)
  assert.equal(stepStatus('desk'), 'failed')
  const kept = desk()
  assert.equal(kept.analysts.find((a: any) => a.analyst === 'chart').status, 'failed')
  assert.deepEqual(kept.missing.map((m: any) => [m.security_id, m.analyst]), [['IN:RATEGAIN', 'chart'], ['IN:STOVEKRAFT', 'chart'], ['IN:RATEGAIN', 'events']])
  assert.match(kept.missing[0].why, /^The Chart analyst failed: claude-code failed: down; then codex failed/)
  assert.deepEqual(kept.refused.map((r: any) => [r.analyst, r.security_id, r.why]), [['events', 'IN:RATEGAIN', 'It cites the web without the link of its source']])
  assert.deepEqual(kept.views.map((v: any) => v.analyst), ['risk', 'risk'])
  assert.match(log(), /The Chart analyst failed, so the buys it had to review wait a session/)
})

test("an analyst's inputs carry none of the Books' shares or amounts, and a web search that does raises a To-do", async () => {
  ws = makeWorkspace()
  prepare()
  workersAnswer()
  const searched = { ...(answers['# Risk analyst'] as object), searches: [{ query: 'Rategain 865 shares block deal', source: 'https://example.com/rategain' }, { query: 'Rategain results date 2026', source: 'https://www.nseindia.com/' }] }
  ws.setWorkerCli('claude', {
    ...failing,
    byPrompt: {
      '# Chart analyst': claudeCodeAnswering(answers['# Chart analyst']),
      '# Risk analyst': claudeCodeAnswering(searched),
    },
  })

  assert.equal((await step('desk')).status, 0)

  const plan = example('plan.normal.json')
  const amounts = plan.plans.flatMap((p: any) => (p.orders ?? []).flatMap((o: any) => [o.shares, Math.round(o.value)]))
  for (const call of [...ws.workerCliCalls('claude'), ...ws.workerCliCalls('codex')]) {
    const names = promptInput(call, 'names')
    for (const order of names.flatMap((n: any) => n.dossier.orders)) {
      assert.deepEqual(Object.keys(order), ['side', 'strategy', 'reason', 'signal', 'cut_by'], 'an order without its shares, price, value or limit')
      assert.ok(!('weight' in order.signal), 'a signal without its weight')
    }
    for (const amount of amounts) assert.ok(!JSON.stringify(names).includes(String(amount)), `${amount} is in the prompt`)
  }
  assert.deepEqual(desk().searches.map((s: any) => [s.query, s.amounts]), [['Rategain 865 shares block deal', ['865']], ['Rategain results date 2026', []]])
  const [todo] = JSON.parse(ws.readRunFile(runId, 'todos', 'desk.json'))
  assert.match(todo, /The Risk analyst searched the web for "Rategain 865 shares block deal", which carries 865: an amount from your Books/)
})

test("an early exit an analyst proposes is recorded in ash_new for Saransh's Answer, and the Brief asks for it", async () => {
  ws = makeWorkspace()
  const plan = example('plan.normal.json')
  const holding = { ...plan.review.names[0], security_id: 'IN:IDFCFIRSTB', name: 'IDFC First Bank Ltd', role: 'holding', held: true, orders: [], analysts: [{ analyst: 'events', why: 'Financial Results on 31 Oct 2026' }], dossier: 'dossiers/IN_IDFCFIRSTB.json' }
  plan.review = { ...plan.review, names: [holding], risk: [], analysts: ['events'] }
  const idfc = { ...dossiers()['IN:RATEGAIN'], security_id: 'IN:IDFCFIRSTB', name: 'IDFC First Bank Ltd', orders: [] }
  prepare({ plan, dossierOf: { 'IN:IDFCFIRSTB': idfc } })
  const exit = view('IN:IDFCFIRSTB', 'exit', { reasons: "The RBI's order against its lending practices is serious enough to sell before results." })
  ws.setWorkerCli('codex', codexAnswering({ views: [exit], searches: [] }))
  ws.setPd({ exits: { example: 'exits-decide.proposed.json' } })

  assert.equal((await step('desk')).status, 0)

  const [proposed] = ws.pdCalls()
  assert.deepEqual(proposed.args, ['exits', 'propose', 'IN', 'IN:IDFCFIRSTB', '--why', exit.reasons, '--by', "the Desk's Events analyst", '--run', runId])
  assert.equal(desk().exits[0].decided.exit.id, 4)
  assert.match(log(), /Proposed the early exit of IN:IDFCFIRSTB as exit 4, for Saransh's Answer/)
  assert.equal((await step('brief')).status, 0)
  const brief = ws.readRunFile(runId, 'brief.html')
  assert.match(brief, /<h2>Early exits waiting for your approval: 1<\/h2>/)
  assert.match(brief, /"item":"exit:4"/)
  assert.match(brief, /<h2>The Desk<\/h2>/)
  assert.match(brief, /exit the holding early/)
})

test("an early exit ash_new couldn't record fails the Step but loses nothing else, and its view isn't kept, so the next Run gives it again", async () => {
  ws = makeWorkspace()
  const plan = example('plan.normal.json')
  const holding = { ...plan.review.names[0], security_id: 'IN:IDFCFIRSTB', name: 'IDFC First Bank Ltd', role: 'holding', held: true, orders: [], analysts: [{ analyst: 'events', why: 'Financial Results on 31 Oct 2026' }], dossier: 'dossiers/IN_IDFCFIRSTB.json' }
  plan.review = { ...plan.review, names: [holding], risk: [], analysts: ['events'] }
  const idfc = { ...dossiers()['IN:RATEGAIN'], security_id: 'IN:IDFCFIRSTB', name: 'IDFC First Bank Ltd', orders: [] }
  prepare({ plan, dossierOf: { 'IN:IDFCFIRSTB': idfc } })
  ws.setWorkerCli('codex', codexAnswering({ views: [view('IN:IDFCFIRSTB', 'exit')], searches: [] }))
  ws.setPd({ exits: { stderr: 'database is locked\n', exitCode: 1 } })

  assert.equal((await step('desk')).status, 1)

  assert.equal(stepStatus('desk'), 'failed')
  assert.deepEqual(desk().views.map((v: any) => v.view), ['exit'], 'desk.json is written all the same')
  assert.match(log(), /Couldn't propose the early exit of IN:IDFCFIRSTB, so its view isn't kept/)
  const later = '2026-10-28-0930'
  prepare({ run: later, plan, dossierOf: { 'IN:IDFCFIRSTB': idfc } })
  ws.setPd({ exits: { example: 'exits-decide.proposed.json' } })
  assert.equal((await step('desk', later)).status, 0)
  assert.equal(ws.workerCliCalls('codex').length, 2, 'Events is asked again')
  assert.equal(desk(later).exits[0].decided.exit.id, 4)
})

test('a dry run calls the analysts on the fake Worker, and keeps no view and proposes no early exit', async () => {
  ws = makeWorkspace()
  prepare({ dryRun: true })

  assert.equal((await step('desk')).status, 0)

  assert.deepEqual([...ws.workerCliCalls('claude'), ...ws.workerCliCalls('codex')], [])
  assert.deepEqual(ws.pdCalls(), [])
  assert.deepEqual(desk().analysts.map((a: any) => a.status), ['answered', 'answered', 'answered'])
  assert.match(log(), /Dry run: no view is kept for later Runs/)
  prepare({ run: '2026-10-28-0930', dryRun: true })
  assert.equal((await step('desk', '2026-10-28-0930')).status, 0)
  assert.ok(desk('2026-10-28-0930').views.every((v: any) => !v.reused))
})
