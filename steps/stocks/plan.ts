// Plan: makes each Book's Rule plan in ash_new, the Book engine's next session from the Book's
// state, so the Brief can show the state and the plan side by side. It runs `pd plan --on <the Run's
// day>`, then `pd book-state` for each Book with a plan, and keeps them as plan.json and
// book-states.json. Today that is the India Book's shadow plan (issue 47): one Sleeve, CW2's selected
// variant, at its full share, nothing of it for placing and nothing recorded. Neither command records
// anything, so a dry run runs them as they are. A plan ash_new couldn't make says why in the Brief;
// a state whose id isn't the one its plan was made from (the ledger changed between the two
// commands) is said in the log.
import { rmSync } from 'node:fs'
import { join } from 'node:path'
import { writeJson } from '../../src/files.ts'
import { pdJson, type PdBookState, type PdPlan } from '../../src/pd.ts'
import { runAsStep } from '../../src/step.ts'

/** How long pd plan may take: each Book's strategies run on its market's panels, from a year back. */
const planMs = 15 * 60_000
/** How long pd book-state may take: a ledger replayed. */
const stateMs = 2 * 60_000

/** The Book states this Step read, one for each Book with a plan. */
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
  for (const book of [...new Set(plan.plans.map((p) => p.book))]) states.push(await pdJson<PdBookState>(['book-state', book], { cwd: runFolder, timeoutMs: stateMs }))
  writeJson(planFile, plan)
  writeJson(statesFile, { states } satisfies BookStates)
  for (const p of plan.plans) {
    const kind = p.kind === 'shadow' ? 'shadow Rule plan' : 'Rule plan'
    if (p.status === 'cant_plan') console.log(`${p.name}: no ${kind}: ${p.why}`)
    else console.log(`${p.name}: ${kind} for ${p.session}, ${p.orders?.length ?? 0} orders, made from state ${p.state_id}`)
    const state = states.find((s) => s.book === p.book)
    if (state && state.id !== p.state_id) console.log(`${p.name}: its state is now ${state.id}, not ${p.state_id}, which the plan was made from: the ledger changed between the two`)
  }
})
