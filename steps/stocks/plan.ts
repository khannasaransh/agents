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
// exit Saransh approved. `pd plan` and `pd book-state` record nothing in ash_new, so a dry run runs
// them as they are. A plan ash_new couldn't make says why in the Brief; a state whose id isn't the
// one its plan was made from (the ledger changed between the two commands) is said in the log.
//
// Between the two, the closes the plans rest on are checked against a second source (the audit of 10
// November 2026, docs/audit): `pd cross-check --plan plan.json`, kept as cross-check.json. The Lake's
// prices have one source outside India, so a wrong close reached the strategies unseen. A close the
// second source gives over 1% away is a gap: ash_new quarantines its security (an index under its
// own id, which fails the Data gate), and releases one quarantined so before whose closes agree now.
// When it changed a Quarantine the plans are made again, so they leave a quarantined name alone or
// go into Hold mode. Each gap is a To-do; so is a second source that couldn't be reached, which
// holds nothing up: the plans stand as made. A dry run compares and records nothing.
//
// The names the plans hold or may trade are kept in the state area for the next Run's Health Step
// (src/watched.ts); a dry run keeps none.
import { rmSync } from 'node:fs'
import { join } from 'node:path'
import { lastEventsViews, readViews } from '../../src/desk.ts'
import { writeJson } from '../../src/files.ts'
import { pdJson, type PdBookState, type PdCrossCheck, type PdPlan } from '../../src/pd.ts'
import { analystName, dossiersFolder, stateArgs, stateOf } from '../../src/plans.ts'
import { readRun } from '../../src/run.ts'
import { runAsStep } from '../../src/step.ts'
import { writeTodos } from '../../src/todos.ts'
import { recordWatched } from '../../src/watched.ts'

/** How long pd plan may take: each Book's strategies run on its market's panels, from a year back, and a dossier for each name the Desk reviews. */
const planMs = 15 * 60_000
/** How long pd book-state may take: a ledger replayed. */
const stateMs = 2 * 60_000
/** How long pd cross-check may take: one file for India, and one request for each of the other markets' names. */
const checkMs = 5 * 60_000

/** The Book states this Step read, one for each Book with a plan, a paper Book's apart. */
export interface BookStates {
  states: PdBookState[]
}

const marketNames: Record<string, string> = { IN: 'India', US: 'the US', HK: 'Hong Kong' }
const marketName = (market: string) => marketNames[market] ?? market
/** A market as a sentence begins with it: "The US". */
const MarketName = (market: string) => marketName(market).replace(/^./, (first) => first.toUpperCase())

/** The plans' closes against the second source, kept as cross-check.json; null when the check couldn't run, which the log says. */
async function crossCheck(runFolder: string, dryRun: boolean): Promise<PdCrossCheck | null> {
  const file = join(runFolder, 'cross-check.json')
  rmSync(file, { force: true })
  try {
    const checked = await pdJson<PdCrossCheck>(['cross-check', '--plan', 'plan.json', ...(dryRun ? ['--dry-run'] : [])], { cwd: runFolder, timeoutMs: checkMs })
    writeJson(file, checked)
    return checked
  } catch (error) {
    console.log(`Cross-check: the plans' closes couldn't be checked against a second source: ${error instanceof Error ? error.message : String(error)}`)
    return null
  }
}

/** What the cross-check found, as the log says it and as To-dos for Saransh. */
function crossCheckTodos(checked: PdCrossCheck | null): string[] {
  if (!checked) return ["The plans' closes weren't checked against a second source (pd cross-check failed: see the Plan Step's log), so today's Order lists rest on the Lake's prices alone."]
  const todos: string[] = []
  for (const m of checked.markets) {
    const closes = `${m.checked} close${m.checked === 1 ? '' : 's'}`
    if (m.error) {
      console.log(`Cross-check: ${marketName(m.market)}'s closes of ${m.as_of} weren't checked: ${m.error}`)
      todos.push(`${MarketName(m.market)}'s closes of ${m.as_of} weren't checked against a second source (${m.error}), so its Order lists rest on the Lake's prices alone.`)
    } else {
      console.log(`Cross-check: ${marketName(m.market)}'s ${closes} of ${m.as_of} against ${m.source}: ${m.agreed} agree${m.unavailable.length ? `, ${m.unavailable.length} it hasn't (${m.unavailable.join(', ')})` : ''}`)
      // A source that has none of a market's closes checked nothing, though it answered.
      if (!m.checked && m.unavailable.length) todos.push(`${MarketName(m.market)}'s closes of ${m.as_of} weren't checked against a second source: ${m.source} had none of the ${m.unavailable.length} asked for, so its Order lists rest on the Lake's prices alone.`)
    }
  }
  for (const gap of checked.gaps) {
    const name = gap.name ? `${gap.name} (${gap.security_id})` : gap.security_id
    console.log(`Cross-check: a gap on ${name}: ${gap.detail}`)
    const then = checked.dry_run
      ? 'A dry run quarantines nothing.'
      : gap.index
        ? 'It is quarantined, which fails the Data gate, so every plan is in Hold mode: check the close, then dismiss its Quarantine.'
        : 'It is quarantined, so no Book buys or sells it on a signal: check the close, then approve a Correction for it or dismiss its Quarantine.'
    todos.push(`Two sources disagree on ${name}: ${gap.detail}. ${then}`)
  }
  for (const q of checked.lifted) console.log(`Cross-check: ${q.name ?? q.security_id} (${q.security_id}) is released: its closes agree now`)
  return todos
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
  const dryRun = readRun(runId).dryRun ?? false
  const viewed = lastEventsViews(readViews())
  const lastViews = Object.keys(viewed).length ? ['--last-views', 'last-views.json'] : []
  if (lastViews.length) writeJson(join(runFolder, 'last-views.json'), viewed)
  const makePlans = () => pdJson<PdPlan>(['plan', '--on', on, '--dossiers', dossiersFolder, ...lastViews], { cwd: runFolder, timeoutMs: planMs })
  let plan = await makePlans()
  writeJson(planFile, plan)
  const checked = await crossCheck(runFolder, dryRun)
  writeTodos(runFolder, 'plan', crossCheckTodos(checked))
  if (checked?.changed) {
    console.log('Cross-check: it changed a Quarantine, so the Rule plans are made again')
    rmSync(join(runFolder, dossiersFolder), { recursive: true, force: true })
    plan = await makePlans()
    writeJson(planFile, plan)
  }
  const states: PdBookState[] = []
  for (const p of plan.plans) {
    if (stateOf(states, p)) continue
    states.push(await pdJson<PdBookState>(stateArgs(p.book, p.kind), { cwd: runFolder, timeoutMs: stateMs }))
  }
  writeJson(statesFile, { states } satisfies BookStates)
  if (!dryRun) recordWatched(plan, runId)
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
