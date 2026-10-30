// Desk: the Desk's three analysts (issue 39), Events, Chart and Risk, each write their own view of the
// names this Run's plan asks them to review (`pd plan`'s review list): Events of each name with
// results or another event coming, or an event new since its last view; Chart of each buy; Risk of
// each Book's buys together. Only the analysts the review list needs are called, all at once, each
// with its names, what it reads of their dossiers and which Feeds were fetched; it skips itself when
// no analyst is needed. A view of a name is reused, with its date, while nothing its analyst reads for
// the name has changed, and an analyst whose views are all reused isn't called. Events runs on Codex
// with Claude Code as fallback; Chart and Risk run on Claude Code with Codex as fallback, because on
// Windows Codex's unelevated sandbox can't enforce a deny-read rule (see the Health Agent). Each is
// read-only in the Run folder. Events and Risk may search the web to check one item; Chart can't.
// Each answer is checked against its schema, and each view against what the analyst may say of its
// name: none, a veto or a trim of a buy, an early exit of a holding, with its evidence. A view it may
// not give is refused. A buy without a view it needed (its analyst failed, gave none, or gave one
// refused) is missing its review, and the Check Step holds it back a session. Each web search is
// checked for amounts from Saransh's Books, with a To-do for one that carries any. The views are kept
// as desk.json for the Portfolio Manager, the Check Step and the Brief, and in the state folder for
// later Runs; each early exit proposed is recorded in ash_new (`pd exits propose`), to wait for
// Saransh's Answer in the Brief. An exit view whose proposal fails isn't kept, so the next Run's
// analyst gives it again. A dry run calls the fake Worker, and keeps no view and proposes nothing. An
// analyst that fails on both Workers, or an exit that can't be proposed, fails the Step, once the
// rest is recorded.
import { existsSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { loadAgent } from '../../src/agent.ts'
import {
  amountsIn,
  bookAmounts,
  deskWork,
  feedsRead,
  fingerprints,
  keepView,
  readViews,
  refusal,
  requiredReviews,
  reusable,
  reviewKey,
  writeViews,
  type AnalystAnswer,
  type AnalystWork,
  type DeskResult,
  type DeskView,
  type NameToReview,
} from '../../src/desk.ts'
import { readJson, writeJson } from '../../src/files.ts'
import { pdJson, type PdAnalyst, type PdBookState, type PdDossier, type PdExitDecided, type PdFeeds, type PdPlan } from '../../src/pd.ts'
import { plural } from '../../src/brief.ts'
import { analystName } from '../../src/plans.ts'
import { readRun } from '../../src/run.ts'
import { runAsStep, StepSkipped } from '../../src/step.ts'
import { writeTodos } from '../../src/todos.ts'
import { callAgent } from '../../src/worker.ts'

/** How long pd exits propose may take: the paper Book's state read. */
const proposeMs = 2 * 60_000

/** One analyst's part of the Run: the views reused, the names it was asked, and its answer or why it failed. */
interface AnalystCall {
  work: AnalystWork
  prints: Map<string, string>
  reused: DeskView[]
  asked: NameToReview[]
  answer: AnalystAnswer | null
  error: string | null
}

/** What the analyst is given: the names it is asked, the Feeds' sources, and for Risk the holdings of its names' Books. */
function inputsOf(work: AnalystWork, asked: NameToReview[], feeds: ReturnType<typeof feedsRead>): Record<string, unknown> {
  if (work.analyst === 'chart') return { names: asked }
  if (work.analyst === 'events') return { names: asked, feeds }
  const books = new Set<string>(asked.map((t) => t.book))
  return { names: asked, holdings: Object.fromEntries(Object.entries(work.holdings).filter(([book]) => books.has(book))), feeds }
}

await runAsStep(async ({ runId, runFolder }) => {
  const out = join(runFolder, 'desk.json')
  // Views an earlier run of this Step wrote were of another Run of the Plan Step's plan.
  rmSync(out, { force: true })
  const run = readRun(runId)
  const read = <T>(file: string) => (existsSync(join(runFolder, file)) ? readJson<T>(join(runFolder, file)) : null)
  const planStep = run.steps.find((s) => s.name === 'plan')
  const plan = planStep?.status === 'succeeded' ? read<PdPlan>('plan.json') : null
  if (!plan) throw new StepSkipped(`The Plan Step ${planStep ? planStep.status : 'is not in this Run'}, so no name is on the review list`)
  if (!plan.review.analysts.length) throw new StepSkipped('No name needs an analyst today, so none is called')
  const dryRun = run.dryRun ?? false
  const fetched = read<PdFeeds>('feeds.json')
  const feeds = feedsRead(fetched)
  const store = readViews()
  // When the analysts are given what they read: an event fetched after it is new to their next view.
  const viewedAt = new Date().toISOString().slice(0, 19)

  const called = await Promise.all(
    deskWork(plan, (path) => read<PdDossier>(path), fetched).map(async (work): Promise<AnalystCall> => {
      const prints = fingerprints(work)
      const reused: DeskView[] = []
      const asked: NameToReview[] = []
      for (const t of work.names) {
        const kept = reusable(store, work.analyst, t, prints.get(reviewKey(work.analyst, t))!)
        if (kept) reused.push(kept)
        else asked.push(t)
      }
      if (!asked.length) return { work, prints, reused, asked, answer: null, error: null }
      try {
        const agent = await loadAgent(work.analyst)
        const answer = (await callAgent(agent, inputsOf(work, asked, feeds), { cwd: runFolder, dryRun })) as AnalystAnswer
        return { work, prints, reused, asked, answer, error: null }
      } catch (error) {
        return { work, prints, reused, asked, answer: null, error: error instanceof Error ? error.message : String(error) }
      }
    }),
  )

  const result: DeskResult = { analysts: [], views: [], missing: [], refused: [], searches: [], exits: [] }
  const failures: string[] = []
  const amounts = bookAmounts(plan, read<{ states: PdBookState[] }>('book-states.json'))
  const made: { view: DeskView; fingerprint: string }[] = []
  const required = requiredReviews(plan.review)
  const missing = (analyst: PdAnalyst, t: NameToReview, why: string) => {
    if (required.some((r) => r.analyst === analyst && r.book === t.book && r.security_id === t.security_id)) result.missing.push({ book: t.book, security_id: t.security_id, analyst, why })
  }
  for (const { work, prints, reused, asked, answer, error } of called) {
    const { analyst } = work
    const name = analystName[analyst]
    result.views.push(...reused)
    const outcome = { analyst, asked: asked.length, reused: reused.length }
    if (reused.length) console.log(`${name}: reused ${plural(reused.length, 'view')}, nothing it reads having changed`)
    if (error !== null) {
      result.analysts.push({ ...outcome, status: 'failed', why: error })
      console.error(`${name} failed, so its reviews of ${plural(asked.length, 'name')} are missing: ${error}`)
      for (const t of asked) missing(analyst, t, `The ${name} analyst failed: ${error}`)
      continue
    }
    if (!answer) {
      result.analysts.push({ ...outcome, status: 'reused', why: null })
      continue
    }
    result.analysts.push({ ...outcome, status: 'answered', why: null })
    for (const t of asked) {
      const given = answer.views.find((v) => v.book === t.book && v.security_id === t.security_id)
      const refused = given ? refusal(analyst, given, t) : null
      if (!given) {
        missing(analyst, t, `The ${name} analyst gave no view of it`)
        console.log(`${name} gave no view of ${t.security_id}`)
      } else if (refused) {
        result.refused.push({ analyst, book: t.book, security_id: t.security_id, why: refused })
        missing(analyst, t, `The ${name} analyst's view of it was refused: ${refused}`)
        console.log(`${name}'s ${given.view} of ${t.security_id} refused: ${refused}`)
      } else {
        const view: DeskView = { ...given, analyst, name: t.name, role: t.role, viewed_at: viewedAt, run: runId, reused: false }
        result.views.push(view)
        made.push({ view, fingerprint: prints.get(reviewKey(analyst, t))! })
        console.log(`${name} on ${t.name ?? t.security_id} (${t.security_id}, a ${t.role}): ${given.view}${given.size !== null ? ` to ${given.size}×` : ''}: ${given.reasons}`)
      }
    }
    for (const v of answer.views) {
      if (!asked.some((t) => t.book === v.book && t.security_id === v.security_id)) console.log(`${name} gave a view of ${v.security_id}, which it wasn't asked to review: ignored`)
    }
    for (const { query, source } of answer.searches) result.searches.push({ analyst, query, source, amounts: amountsIn(query, amounts) })
  }

  const todos = result.searches.flatMap(({ analyst, query, amounts: found }) =>
    found.length ? [`The ${analystName[analyst]} analyst searched the web for "${query}", which carries ${found.join(', ')}: an amount from your Books. Check its instructions, and that its inputs hold no shares or amounts.`] : [],
  )
  writeTodos(runFolder, 'desk', todos)
  if (dryRun) {
    console.log('Dry run: no view is kept for later Runs, and no early exit is proposed')
  } else {
    const unproposed: DeskView[] = []
    for (const { view } of made.filter((m) => m.view.view === 'exit')) {
      const by = `the Desk's ${analystName[view.analyst]} analyst`
      try {
        // It says why as JSON when it records nothing, as for a name the paper Book no longer holds.
        const decided = await pdJson<PdExitDecided>(['exits', 'propose', view.book, view.security_id, '--why', view.reasons, '--by', by, '--run', runId], { cwd: runFolder, timeoutMs: proposeMs })
        result.exits.push({ analyst: view.analyst, book: view.book, security_id: view.security_id, decided })
        console.log(decided.changed && decided.exit ? `Proposed the early exit of ${view.security_id} as exit ${decided.exit.id}, for Saransh's Answer` : `Didn't propose the early exit of ${view.security_id}: ${decided.why}`)
      } catch (error) {
        unproposed.push(view)
        console.error(`Couldn't propose the early exit of ${view.security_id}, so its view isn't kept and the next Run's ${analystName[view.analyst]} analyst gives it again: ${error instanceof Error ? error.message : String(error)}`)
      }
    }
    for (const { view, fingerprint } of made) if (!unproposed.includes(view)) keepView(store, view, fingerprint)
    writeViews(store)
    if (unproposed.length) failures.push(`${plural(unproposed.length, 'early exit')} couldn't be proposed`)
  }
  writeJson(out, result)
  const failed = result.analysts.filter((a) => a.status === 'failed').map((a) => analystName[a.analyst])
  if (failed.length) failures.unshift(`The ${failed.join(' and ')} analyst${failed.length === 1 ? '' : 's'} failed, so the buys ${failed.length === 1 ? 'it' : 'they'} had to review wait a session`)
  if (failures.length) throw new Error(failures.join('; '))
})
