// Plan: records the Rule plans ash_new makes, each the Book engine's next session from a Book's
// state, so the Brief can show each state and plan side by side. It runs `pd plan --on <the Run's
// day>`, then `pd book-state` for each plan's Book (--paper for a paper Book's, --rules-only for a
// rules-only paper Book's), and keeps them as plan.json and book-states.json. The plans are the India
// Book's shadow plan (issue 47: one Sleeve, CW2's selected variant, not for placing), each paper
// Book's (issue 32: each strategy from Paper up at its full share) and each rules-only paper Book's
// (issue 33); the Check Step records the paper and rules-only ones as Order lists. On a day the Data
// gate fails, every plan is in Hold mode; a Book whose market was shut the session before gets no
// order. Neither command records anything in ash_new, so a dry run runs them as they are. A plan
// ash_new couldn't make says why in the Brief; a state whose id isn't the one its plan was made from
// (the ledger changed between the two commands) is said in the log.
import { rmSync } from 'node:fs'
import { join } from 'node:path'
import { writeJson } from '../../src/files.ts'
import { pdJson, type PdBookState, type PdPlan } from '../../src/pd.ts'
import { stateArgs, stateOf } from '../../src/plans.ts'
import { runAsStep } from '../../src/step.ts'

/** How long pd plan may take: each Book's strategies run on its market's panels, from a year back. */
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
  // The Run's id is its local start date and time: its day is what the plan is for.
  const on = runId.slice(0, 10)
  const plan = await pdJson<PdPlan>(['plan', '--on', on], { cwd: runFolder, timeoutMs: planMs })
  const states: PdBookState[] = []
  for (const p of plan.plans) {
    if (stateOf(states, p)) continue
    states.push(await pdJson<PdBookState>(stateArgs(p.book, p.kind), { cwd: runFolder, timeoutMs: stateMs }))
  }
  writeJson(planFile, plan)
  writeJson(statesFile, { states } satisfies BookStates)
  if (plan.mode === 'hold') console.log(`Hold mode: the Data gate fails (${plan.gate.reasons.join('; ')}), so no plan makes an order`)
  for (const p of plan.plans) {
    const kind = p.kind === 'shadow' ? 'shadow Rule plan' : 'Rule plan'
    if (p.status !== 'planned') console.log(`${p.name}: no ${kind}: ${p.why}`)
    else console.log(`${p.name}: ${kind} for ${p.session}, ${p.orders?.length ?? 0} orders, made from state ${p.state_id}`)
    for (const left of p.left_out ?? []) console.log(`${p.name}: left out ${left.strategy_id} version ${left.version}: ${left.why}`)
    const state = stateOf(states, p)
    if (state && state.id !== p.state_id) console.log(`${p.name}: its state is now ${state.id}, not ${p.state_id}, which the plan was made from: the ledger changed between the two`)
  }
})
