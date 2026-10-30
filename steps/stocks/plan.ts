// Plan: records the Rule plans ash_new makes, each the Book engine's next session from a Book's
// state, so the Brief can show each state and plan side by side. It runs `pd plan --on <the Run's
// day>`, then `pd book-state` for each plan's Book (--paper for a paper Book's, --rules-only for a
// rules-only paper Book's), and keeps them as plan.json and book-states.json. The plans are each real
// Book's (issue 42: for Saransh to place, each Sleeve scaled by its Stage, run on from what its Order
// lists actually filled), each paper Book's (issue 32: each strategy from Paper up at its full share)
// and each rules-only paper Book's (issue 33); the Check Step records each as an Order list. On a day
// the Data gate fails, every plan is in Hold mode; a Book whose market was shut the session before
// gets no order. `pd plan` also lists the names the Desk reviews (issue 37: each real and paper
// Book's buys and sales, and its holdings with results or another event in the next 5 sessions), each
// with the analysts it needs and why, and writes a dossier for each into the Run's dossiers folder:
// everything the Desk may read of it, copied, so a Decision record can be checked against it later.
// It passes when the Desk's Events analyst last viewed each name (issue 39, `--last-views
// last-views.json`), so an event fetched since is new to it. A paper Book's plan sells each early
// exit Saransh approved. Neither command records anything in ash_new, so a dry run runs them as they
// are. A plan ash_new couldn't make says why in the Brief; a state whose id isn't the one its plan
// was made from (the ledger changed between the two commands) is said in the log.
import { rmSync } from 'node:fs'
import { join } from 'node:path'
import { lastEventsViews, readViews } from '../../src/desk.ts'
import { writeJson } from '../../src/files.ts'
import { pdJson, type PdBookState, type PdPlan } from '../../src/pd.ts'
import { analystName, dossiersFolder, stateArgs, stateOf } from '../../src/plans.ts'
import { runAsStep } from '../../src/step.ts'

/** How long pd plan may take: each Book's strategies run on its market's panels, from a year back, and a dossier for each name the Desk reviews. */
const planMs = 15 * 60_000
/** How long pd book-state may take: a ledger replayed. */
const stateMs = 2 * 60_000

/** The Book states this Step read, one for each Book with a plan, a paper Book's apart. */
export interface BookStates {
  states: PdBookState[]
}

await runAsStep(async ({ runId, runFolder }) => {
  const planFile = join(runFolder, 'plan.json')
  const statesFile = join(runFolder, 'book-states.json')
  // Plans an earlier run of this Step made would say nothing true about this Run's data.
  rmSync(planFile, { force: true })
  rmSync(statesFile, { force: true })
  rmSync(join(runFolder, dossiersFolder), { recursive: true, force: true })
  rmSync(join(runFolder, 'last-views.json'), { force: true })
  // The Run's id is its local start date and time: its day is what the plan is for.
  const on = runId.slice(0, 10)
  const viewed = lastEventsViews(readViews())
  const lastViews = Object.keys(viewed).length ? ['--last-views', 'last-views.json'] : []
  if (lastViews.length) writeJson(join(runFolder, 'last-views.json'), viewed)
  const plan = await pdJson<PdPlan>(['plan', '--on', on, '--dossiers', dossiersFolder, ...lastViews], { cwd: runFolder, timeoutMs: planMs })
  const states: PdBookState[] = []
  for (const p of plan.plans) {
    if (stateOf(states, p)) continue
    states.push(await pdJson<PdBookState>(stateArgs(p.book, p.kind), { cwd: runFolder, timeoutMs: stateMs }))
  }
  writeJson(planFile, plan)
  writeJson(statesFile, { states } satisfies BookStates)
  if (plan.mode === 'hold') console.log(`Hold mode: the Data gate fails (${plan.gate.reasons.join('; ')}), so no plan makes an order`)
  for (const p of plan.plans) {
    const placing = p.for_placing ? ', for placing' : ''
    if (p.status !== 'planned') console.log(`${p.name}: no Rule plan: ${p.why}`)
    else console.log(`${p.name}: Rule plan for ${p.session}${placing}, ${p.orders?.length ?? 0} orders, made from state ${p.state_id}`)
    for (const left of p.left_out ?? []) console.log(`${p.name}: left out ${left.strategy_id} version ${left.version}: ${left.why}`)
    const state = stateOf(states, p)
    if (state && p.state_id && state.id !== p.state_id) console.log(`${p.name}: its state is now ${state.id}, not ${p.state_id}, which the plan was made from: the ledger changed between the two`)
  }
  const { names, risk, analysts } = plan.review
  if (!names.length) console.log('The Desk has no name to review')
  for (const n of names) {
    const needs = n.analysts.map((a) => `${analystName[a.analyst]} (${a.why})`).join(', ')
    console.log(`Desk: ${n.name ?? n.security_id} in the ${n.plan}, a ${n.role}: ${needs || n.why || 'no analyst'}`)
  }
  for (const r of risk) console.log(`Desk: Risk for the ${r.plan} (${r.why})`)
  for (const p of plan.plans) {
    for (const e of p.early_exits ?? []) console.log(`${p.name}: early exit ${e.id} of ${e.name ?? e.security_id}: ${e.status === 'planned' ? `sold by ${e.orders.join(', ')}` : e.why}`)
  }
  if (names.length) console.log(`Desk: ${analysts.length ? analysts.map((a) => analystName[a]).join(', ') : 'no analyst'} needed`)
})
