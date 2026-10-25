// Brief: writes the Stocks Brief, one self-contained HTML page in the Run folder that loads nothing
// from the internet, from what earlier Steps wrote there: the Data gate's verdict and its reasons;
// under them, the Health Agent's diagnosis and proposed fix, or that it failed, with what became of
// the Corrections it proposed; each Correction waiting for approval with what it would change; each
// Quarantine with its flag; each market's latest session in the Lake against its last finished one;
// the To-dos the Steps raised; how this Run's Lake Step went and how ash_new's last refresh ended;
// the Health report's verdict and flags; and the Run's health.
// It runs even when earlier Steps failed, and says when the Lake's status is missing.
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { readJson, writeText } from '../../src/files.ts'
import type { PdStatus } from '../../src/pd.ts'
import { readRun, stepsNotSucceeded, type RunRecord } from '../../src/run.ts'
import { runAsStep } from '../../src/step.ts'
import { readTodos } from '../../src/todos.ts'
import type { HealthResult, Proposals } from './health.ts'
import type { LakeResult, RefreshAttempt } from './lake.ts'

/** Escapes text for HTML, so nothing from the Lake or a log is read as markup. */
const esc = (text: string) => text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#39;')
const firstLine = (text: string) => text.split('\n')[0]
const plural = (n: number, one: string) => `${n} ${one}${n === 1 ? '' : 's'}`
/** An ISO time as minutes in UTC: 2026-10-27 01:40 UTC. */
const minutes = (iso: string) => `${new Date(iso).toISOString().slice(0, 16).replace('T', ' ')} UTC`
const list = (items: string[]) => `<ul>\n${items.map((item) => `<li>${item}</li>`).join('\n')}\n</ul>`
const table = (head: string[], rows: string[][]) =>
  `<table>\n<thead><tr>${head.map((h) => `<th>${h}</th>`).join('')}</tr></thead>\n<tbody>\n${rows.map((row) => `<tr>${row.map((cell) => `<td>${cell}</td>`).join('')}</tr>`).join('\n')}\n</tbody>\n</table>`
const logLink = (log: string) => `<a href="${esc(log)}">${esc(log)}</a>`

function gateSection(status: PdStatus | null, lakeLog: string): string {
  if (!status)
    return `<section class="gate unknown"><h2>Data gate: unknown.</h2><p>The Lake's status couldn't be read in this Run, so treat the data as failing the gate. See the Lake Step's log: ${logLink(lakeLog)}</p></section>`
  const { verdict, reasons } = status.gate
  if (verdict === 'pass') return `<section class="gate pass"><h2>Data gate: pass.</h2><p>India's and the US's data are as of their last finished sessions, and the Health report fails neither.</p></section>`
  return `<section class="gate fail"><h2>Data gate: fail. Nothing should be decided on this data:</h2>\n${list(reasons.map(esc))}</section>`
}

/**
 * The Health Agent's diagnosis, or that it failed; nothing when the Health Step didn't run or
 * skipped itself. A Health Step that failed before recording its failure may have left the
 * diagnosis of an earlier run of it, which says nothing about this Lake.
 */
function diagnosisSection(run: RunRecord, health: HealthResult | null): string {
  const step = run.steps.find((s) => s.name === 'health')
  const failed = (why: string) => `<section class="diagnosis"><h2>Health Agent</h2><p>${why} See its log: ${logLink(step?.log ?? 'logs/health.log')}</p></section>`
  if (health?.status === 'failed') return failed(`The Health Agent failed, so there is no diagnosis: ${esc(health.error.replace(/\.$/, ''))}.`)
  if (step?.status === 'failed') return failed('The Health Agent failed before it recorded a diagnosis.')
  if (!health) return ''
  const evidence = health.evidence.map(({ source, shows }) => `<code>${esc(source)}</code>: ${esc(shows)}`)
  return [
    `<section class="diagnosis"><h2>Health Agent's diagnosis</h2>`,
    `<p class="text">${esc(health.diagnosis)}</p>`,
    `<h3>Proposed fix, not applied</h3>`,
    `<p class="text">${esc(health.fix)}</p>`,
    ...(health.proposals ? [`<p>${proposalsLine(health.proposals, health.corrections.length)}</p>`] : []),
    ...(evidence.length ? [`<details><summary>Evidence it read: ${plural(evidence.length, 'item')}</summary>\n${list(evidence)}</details>`] : []),
    '</section>',
  ].join('\n')
}

/** What became of the Corrections the Health Agent proposed in this Run. */
function proposalsLine(proposals: Proposals, proposed: number): string {
  const corrections = plural(proposed, 'Correction')
  if (proposals.status === 'dry-run') return `It proposed ${corrections}; a dry run records none in ash_new.`
  if (proposals.status === 'failed') return `It proposed ${corrections}, but they couldn't be recorded in ash_new: ${esc(proposals.error)}`
  const { recorded, known, refused } = proposals.printed
  const parts = [
    `${recorded.length} recorded, waiting for your approval`,
    ...(known.length ? [`${known.length} proposed before`] : []),
    ...(refused.length ? [`${refused.length} refused by ash_new (${refused.map((r) => esc(r.why)).join('; ')})`] : []),
  ]
  return `It proposed ${corrections}: ${parts.join(', ')}.`
}

/** A Correction in a few words: "Split of 11.655 for 1 on 2026-10-08". */
function correctionText(c: PdStatus['corrections'][number]): string {
  if (c.kind === 'split') return `Split of ${c.ratio} for 1 on ${c.date}`
  if (c.kind === 'demerger') return `Demerger on ${c.date}, the company keeping ${Math.round((c.ratio ?? 0) * 1000) / 10}% of its value`
  return c.value === null ? `No dividend on ${c.date}` : `Dividend of ${c.value} on ${c.date}`
}

function correctionsSection(status: PdStatus | null): string {
  if (!status) return ''
  if (!status.corrections.length) return '<section><h2>Corrections</h2><p>No Correction is waiting for your approval.</p></section>'
  const rows = status.corrections.map((c) => [
    String(c.id),
    `${esc(c.security_id)}${c.name ? `<br><span class="muted">${esc(c.name)}</span>` : ''}`,
    esc(correctionText(c)),
    esc(c.effect),
    esc(c.why),
    `${esc(c.proposed_by)}<br><span class="muted">${esc(minutes(c.proposed_at))}</span>`,
  ])
  return [
    `<section><h2>Corrections waiting for your approval: ${status.corrections.length}</h2>`,
    '<p>Nothing is applied until you approve it. In ash_new, <code>pd corrections approve &lt;id&gt;</code> adds one to the Corrections file, which the next refresh applies, running again the backtests it affects; <code>pd corrections reject &lt;id&gt;</code> drops it.</p>',
    table(['Id', 'Security', 'Correction', 'What it would change', 'Why', 'Proposed by'], rows),
    '</section>',
  ].join('\n')
}

/** "1 security", "3 securities". */
const securities = (n: number) => `${n} securit${n === 1 ? 'y' : 'ies'}`

function quarantineSection(status: PdStatus | null): string {
  if (!status) return ''
  const { quarantines } = status
  if (!quarantines.length) return '<section><h2>Quarantine</h2><p>No security is quarantined.</p></section>'
  const names = new Map(status.markets.map((m) => [m.market, m.name]))
  const held = (qs: PdStatus['quarantines']) => securities(new Set(qs.map((q) => q.security_id)).size)
  const lists = [...new Set(quarantines.map((q) => q.market))].map((market) => {
    const mine = quarantines.filter((q) => q.market === market)
    const rows = mine.map((q) => [String(q.id), esc(q.security_id), esc(q.name ?? ''), esc(q.check), esc(q.date ?? '—'), esc(q.detail), esc(q.since)])
    return `<details><summary>${esc(names.get(market) ?? market)}: ${held(mine)}</summary>\n${table(['Id', 'Security', 'Name', 'Flag', 'Date', 'Detail', 'Since'], rows)}</details>`
  })
  return [
    `<section><h2>Quarantine: ${held(quarantines)}</h2>`,
    '<p>A security the Health report flagged is held out of every Book, neither bought nor sold on a signal while its Disaster stop stays, until its Correction is approved or you dismiss its flag: <code>pd quarantines dismiss &lt;id&gt;</code> in ash_new.</p>',
    ...lists,
    '</section>',
  ].join('\n')
}

function marketsSection(status: PdStatus | null): string {
  if (!status) return ''
  const state = (m: PdStatus['markets'][number]) => {
    const lag = m.latest_session === null ? 'No prices' : m.sessions_behind ? `${plural(m.sessions_behind, 'session')} behind` : 'Up to date'
    return m.gated ? lag : `${lag} (not gated)`
  }
  const rows = status.markets.map((m) => [esc(m.name), esc(m.latest_session ?? '—'), esc(m.last_finished_session), esc(state(m))])
  return `<section><h2>Markets</h2>\n${table(['Market', 'Latest session in the Lake', 'Last finished session', ''], rows)}</section>`
}

function todosSection(todos: { step: string; todo: string }[]): string {
  if (!todos.length) return '<section><h2>To-dos</h2><p>Nothing is waiting on you.</p></section>'
  return `<section><h2>To-dos</h2>\n${list(todos.map(({ step, todo }) => `${esc(todo)} <span class="muted">(${esc(step)})</span>`))}</section>`
}

/** How a run of pd daily ended, as "exit 1" or "timed out". */
const ended = (attempt: RefreshAttempt) => (attempt.timedOut ? 'timed out' : `exit ${attempt.exitCode}`)

function lakeSection(lake: LakeResult | null, status: PdStatus | null): string {
  const lines: string[] = []
  if (!lake) lines.push('The Lake Step recorded nothing in this Run.')
  else if (lake.dryRun) lines.push('Dry run: the Lake was read as it is, not refreshed.')
  else {
    for (const job of lake.cleared?.cleared ?? []) lines.push(`Cleared refresh job ${job.job}, left running: ${esc(job.error)}`)
    if (lake.cleared?.refused) lines.push(`Left a running refresh alone: ${esc(lake.cleared.refused)}`)
    const [first, retry] = lake.attempts
    if (lake.refreshed && !retry) lines.push('Refreshed with pd daily on the first try.')
    else if (lake.refreshed) lines.push(`Refreshed with pd daily on the retry, after the first try failed (${ended(first)}).`)
    else if (lake.attempts.length) lines.push(`pd daily failed ${lake.attempts.length === 2 ? 'twice' : 'once'} (${lake.attempts.map(ended).join(', then ')}), so the Lake is as the last refresh left it.`)
  }
  const refresh = status?.refresh
  if (status && !refresh) lines.push('ash_new records no refresh.')
  if (refresh) {
    const how = refresh.status === 'succeeded' && refresh.finished_at ? `succeeded at ${minutes(refresh.finished_at)}` : refresh.status
    lines.push(`The last refresh, job ${refresh.job}, ${esc(how)}${refresh.error ? `: ${esc(firstLine(refresh.error))}` : '.'}`)
  }
  return `<section><h2>The Lake</h2>\n${lines.map((line) => `<p>${line}</p>`).join('\n')}</section>`
}

function healthSection(status: PdStatus | null): string {
  const health = status?.health
  if (!status) return ''
  if (!health) return '<section><h2>Health report</h2><p>ash_new has no Health report to read.</p></section>'
  const names = new Map(status.markets.map((m) => [m.market, m.name]))
  const name = (market: string) => esc(names.get(market) ?? market)
  const counts = (flags: Record<string, number>) => esc(Object.entries(flags).map(([check, n]) => `${check} ${n}`).join(', ') || 'none')
  const rows = health.markets.map((m) => [name(m.market), esc(m.status), esc(m.data_as_of ?? '—'), counts(m.flags), esc(m.problems.join('; '))])
  const flagLists = health.markets.flatMap((m) => {
    const flags = health.flags.filter((f) => f.market === m.market)
    if (!flags.length) return []
    const flagRows = flags.map((f) => [esc(f.security_id), esc(f.name ?? ''), esc(f.check), esc(f.date ?? '—'), esc(f.detail)])
    return [`<details><summary>${name(m.market)}: ${plural(flags.length, 'flag')}</summary>\n${table(['Security', 'Name', 'Check', 'Date', 'Detail'], flagRows)}</details>`]
  })
  return [
    `<section><h2>Health report of ${esc(health.date)}: ${esc(health.status)}</h2>`,
    table(['Market', 'Verdict', 'Data as of', 'Flags', 'Problems'], rows),
    ...flagLists,
    '</section>',
  ].join('\n')
}

function runHealthSection(run: RunRecord): string {
  const notSucceeded = stepsNotSucceeded(run.steps).filter((s) => s.name !== 'brief')
  const steps = notSucceeded.length ? list(notSucceeded.map((s) => `${esc(s.name)}: ${esc(s.status)}. Log: ${logLink(s.log)}`)) : '<p>No Step failed or was skipped.</p>'
  return `<section><h2>Run health</h2><p>Run ${esc(run.id)} of the ${esc(run.pipeline)} Pipeline.</p>\n${steps}</section>`
}

const style = `
:root { --bg: #fbfbfa; --fg: #1d1d1b; --muted: #6b6b66; --line: #deddd8; --pass: #1f7a3d; --fail: #b3261e; --unknown: #8a5a00; --panel: #f1f0ec; }
@media (prefers-color-scheme: dark) { :root { --bg: #161615; --fg: #ecebe6; --muted: #a09f99; --line: #3a3a37; --pass: #5cc783; --fail: #ff8a80; --unknown: #f0b44c; --panel: #222220; } }
body { background: var(--bg); color: var(--fg); font: 15px/1.5 system-ui, sans-serif; max-width: 60rem; margin: 0 auto; padding: 1.5rem 1rem 3rem; }
h1 { font-size: 1.5rem; margin: 0 0 1rem; }
h2 { font-size: 1.1rem; margin: 1.75rem 0 0.5rem; }
h3 { font-size: 1rem; margin: 1rem 0 0.25rem; }
.gate { border-left: 4px solid var(--unknown); background: var(--panel); padding: 0.25rem 1rem 0.5rem; }
.gate h2 { margin-top: 0.75rem; }
.gate.pass { border-color: var(--pass); } .gate.pass h2 { color: var(--pass); }
.gate.fail { border-color: var(--fail); } .gate.fail h2 { color: var(--fail); }
.gate.unknown h2 { color: var(--unknown); }
.muted, .note { color: var(--muted); }
.text { white-space: pre-line; }
table { border-collapse: collapse; width: 100%; display: block; overflow-x: auto; }
th, td { text-align: left; padding: 0.3rem 0.75rem 0.3rem 0; border-bottom: 1px solid var(--line); vertical-align: top; }
th { font-weight: 600; }
details { margin: 0.5rem 0; } summary { cursor: pointer; }
a { color: inherit; }
`

/**
 * `status` is the Lake's as the Lake Step read it; `latest`, as the Health Step read it again once it
 * recorded the Health Agent's Corrections, so they are among those waiting.
 */
function render(run: RunRecord, lake: LakeResult | null, status: PdStatus | null, latest: PdStatus | null, health: HealthResult | null, todos: { step: string; todo: string }[]): string {
  const lakeLog = run.steps.find((s) => s.name === 'lake')?.log ?? 'logs/lake.log'
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Stocks Brief ${esc(run.id)}</title>
<style>${style}</style>
</head>
<body>
<h1>Stocks Brief ${esc(run.id)}</h1>
${run.dryRun ? '<p class="note">Dry run: the Lake was read as it is, not refreshed, and nothing was recorded in ash_new.</p>\n' : ''}${gateSection(status, lakeLog)}
${diagnosisSection(run, health)}
${correctionsSection(latest ?? status)}
${quarantineSection(latest ?? status)}
${marketsSection(status)}
${todosSection(todos)}
${lakeSection(lake, status)}
${healthSection(status)}
${runHealthSection(run)}
</body>
</html>
`
}

await runAsStep(({ runId, runFolder, force }) => {
  const out = join(runFolder, 'brief.html')
  if (!force && existsSync(out)) {
    console.log('Brief already written in this Run, skipping')
    return
  }
  const read = <T>(file: string) => (existsSync(join(runFolder, file)) ? readJson<T>(join(runFolder, file)) : null)
  writeText(out, render(readRun(runId), read<LakeResult>('lake.json'), read<PdStatus>(join('lake', 'status.json')), read<PdStatus>(join('health', 'status.json')), read<HealthResult>('health.json'), readTodos(runFolder)))
  console.log(`Wrote ${out}`)
})
