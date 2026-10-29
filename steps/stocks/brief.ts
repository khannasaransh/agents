// Brief: writes the Stocks Brief, one self-contained HTML page in the Run folder that loads nothing
// from the internet, from what earlier Steps wrote there: the Data gate's verdict and its reasons;
// under them, the Health Agent's diagnosis and proposed fix, or that it failed, with what became of
// the Corrections it proposed; what became of the Answers this Run applied; each Correction waiting
// for approval with what it would change; each Quarantine with its flag; each Candidate waiting for
// approval into Paper; each market's latest session in the Lake against its last finished one; the
// To-dos the Steps raised; each Book's Sleeves with their Stages and how long each has been in its
// Stage; each Book's real holdings and value, its latest Reconciliation's differences and this Run's
// Broker inbox files; the India Book's state beside its shadow Rule plan, every order of it marked not
// for placing; on Saturdays, what MarketSmith's fetch brought; how this Run's Lake Step went and how ash_new's last refresh ended;
// the Health report's verdict and flags; and the Run's health.
// It runs even when earlier Steps failed, and says when the Lake's status is missing.
// Each item waiting on Saransh has its id and buttons for its Answers. The Save answers button
// downloads them as one Answers file, built in the page by answersFile's own source, for the next
// Run's Answers Step: the page works opened from disk, with nothing running.
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { answerItem, answersFile, answersFileName, capitalised, itemName, waitingCandidates, waitingItems, type AnswerItem } from '../../src/answers.ts'
import { brokerFiles, differenceText, fileLine, securityName, shares } from '../../src/brokers.ts'
import { readJson, writeText } from '../../src/files.ts'
import { fetchLine } from '../../src/marketsmith.ts'
import { brokerInboxDir } from '../../src/paths.ts'
import type { PdBook, PdBookState, PdMarketSmith, PdPlan, PdRulePlan, PdSleeve, PdStagesCheck, PdStatus } from '../../src/pd.ts'
import { cutText, percent, ruleName, signalText } from '../../src/plans.ts'
import { readRun, stepsNotSucceeded, type RunRecord } from '../../src/run.ts'
import { stageName } from '../../src/stages.ts'
import { runAsStep } from '../../src/step.ts'
import { readTodos } from '../../src/todos.ts'
import type { AnswersResult } from './answers.ts'
import type { BrokerInboxResult } from './broker-inbox.ts'
import type { HealthResult, Proposals } from './health.ts'
import type { LakeResult, RefreshAttempt } from './lake.ts'
import type { BookStates } from './plan.ts'

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
  if (c.kind === 'bar') return `Bar of ${c.date} left out`
  return c.value === null ? `No dividend on ${c.date}` : `Dividend of ${c.value} on ${c.date}`
}

/** An item's buttons, one per Answer it takes, and a note, shown once an Answer is chosen. */
function answerButtons({ item, answers }: AnswerItem): string {
  const buttons = answers.map((answer) => `<button type="button" data-answer="${esc(answer)}" aria-pressed="false">${esc(capitalised(answer))}</button>`)
  return `<div class="answer" data-item="${esc(item)}">${buttons.join('')}<input class="answer-note" type="text" placeholder="Note, if any" aria-label="Your note on ${esc(itemName(item))}"></div>`
}

/** What became of the Answers this Run's Answers Step read; nothing when it recorded nothing. */
function answersSection(answers: AnswersResult | null): string {
  if (!answers) return ''
  if (!answers.files.length) return '<section><h2>Your Answers</h2><p>No Answers file was waiting in Downloads or the Broker inbox.</p></section>'
  const all = answers.files.flatMap((f) => f.answers)
  const count = (outcome: string) => all.filter((a) => a.outcome === outcome).length
  const summary = answers.dryRun
    ? `Dry run: none of your ${plural(all.length, 'Answer')} was applied, and each Answers file was left where it was.`
    : [`${count('applied')} of your ${plural(all.length, 'Answer')} applied`, `${count('ignored')} ignored`, ...(count('failed') ? [`${count('failed')} couldn't be applied, so its file and every later one wait for the next Run`] : [])].join(', ') + '.'
  const shown = { applied: 'applied', ignored: 'ignored', failed: "couldn't be applied", 'not-tried': 'not tried yet', 'dry-run': 'not applied in a dry run' }
  const files = answers.files.map((f) => {
    const lines = f.answers.map((a) => `${esc(itemName(a.item))}: ${esc(a.answer)}, ${shown[a.outcome]}${a.why ? `: ${esc(a.why)}` : ''}${a.note ? ` <span class="muted">(your note: ${esc(a.note)})</span>` : ''}`)
    return `<p>${esc(f.file)}, saved at ${esc(minutes(f.savedAt))} from the Brief of Run ${esc(f.run)}:</p>\n${lines.length ? list(lines) : '<p>No Answer in it.</p>'}`
  })
  return [`<section><h2>Your Answers</h2>`, `<p>${summary}</p>`, `<details><summary>Each Answer, by file, oldest first</summary>`, ...files, '</details>', '</section>'].join('\n')
}

/**
 * The bar with the Save answers button, the items it may answer, and the script that saves them,
 * running answersFile and answersFileName from their own source; nothing when nothing is waiting.
 */
function saveAnswers(runId: string, items: AnswerItem[]): string {
  if (!items.length) return ''
  // Escaped so nothing in the data or the code can end the script early: `<\/` means `</` in a string or a pattern alike.
  const json = (value: unknown) => JSON.stringify(value).replaceAll('<', '\\u003c')
  const code = (fn: Function) => String(fn).replaceAll('</', '<\\/').replaceAll('<!--', '<\\!--')
  return `<div class="save-bar"><span id="answer-count">No Answer chosen yet.</span> <button type="button" id="save-answers" disabled>Save answers</button> <span id="answers-saved" class="muted"></span></div>
<script type="application/json" id="answer-items">${json(items)}</script>
<script>
const answersFile = ${code(answersFile)}
const answersFileName = ${code(answersFileName)}
const run = ${json(runId)}
const items = JSON.parse(document.getElementById('answer-items').textContent)
const chosen = {}
let unsaved = false
const count = document.getElementById('answer-count')
const save = document.getElementById('save-answers')
const saved = document.getElementById('answers-saved')
function show() {
  const n = Object.keys(chosen).length
  count.textContent = n ? n + (n === 1 ? ' Answer' : ' Answers') + ' chosen.' : 'No Answer chosen yet.'
  save.disabled = !n
}
document.addEventListener('click', (event) => {
  const button = event.target.closest('button[data-answer]')
  if (!button) return
  const cell = button.closest('[data-item]')
  const item = cell.dataset.item
  if (chosen[item] && chosen[item].answer === button.dataset.answer) delete chosen[item]
  else chosen[item] = { answer: button.dataset.answer, note: cell.querySelector('.answer-note').value }
  for (const each of cell.querySelectorAll('button[data-answer]')) each.setAttribute('aria-pressed', String(Boolean(chosen[item]) && chosen[item].answer === each.dataset.answer))
  cell.classList.toggle('chosen', Boolean(chosen[item]))
  unsaved = true
  show()
})
document.addEventListener('input', (event) => {
  const cell = event.target.closest('[data-item]')
  if (!cell || !chosen[cell.dataset.item]) return
  chosen[cell.dataset.item].note = event.target.value
  unsaved = true
})
save.addEventListener('click', () => {
  const file = answersFile(run, items, chosen, new Date().toISOString())
  const link = document.createElement('a')
  link.href = URL.createObjectURL(new Blob([JSON.stringify(file, null, 2)], { type: 'application/json' }))
  link.download = answersFileName(file)
  link.click()
  setTimeout(() => URL.revokeObjectURL(link.href), 1000)
  unsaved = false
  saved.textContent = 'Saved ' + file.answers.length + (file.answers.length === 1 ? ' Answer' : ' Answers') + ' as ' + link.download + ' (in Downloads, unless your browser asked where): the next Run applies them from Downloads or the Broker inbox. The first Answer applied to an item settles it.'
})
window.addEventListener('beforeunload', (event) => {
  if (unsaved && Object.keys(chosen).length) event.preventDefault()
})
</script>`
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
    answerButtons(answerItem('correction', c.id)),
  ])
  return [
    `<section><h2>Corrections waiting for your approval: ${status.corrections.length}</h2>`,
    '<p>Nothing is applied until you approve it. Approve or reject each, then Save answers: the next Run records your Answers in ash_new before it refreshes the Lake. An approved Correction joins the Corrections file and that refresh applies it, running again the backtests it affects; a rejected one is dropped.</p>',
    table(['Id', 'Security', 'Correction', 'What it would change', 'Why', 'Proposed by', 'Your Answer'], rows),
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
    const rows = mine.map((q) => [String(q.id), esc(q.security_id), esc(q.name ?? ''), esc(q.check), esc(q.date ?? '—'), esc(q.detail), esc(q.since), answerButtons(answerItem('quarantine', q.id))])
    return `<details><summary>${esc(names.get(market) ?? market)}: ${held(mine)}</summary>\n${table(['Id', 'Security', 'Name', 'Flag', 'Date', 'Detail', 'Since', 'Your Answer'], rows)}</details>`
  })
  return [
    `<section><h2>Quarantine: ${held(quarantines)}</h2>`,
    '<p>A security the Health report flagged is held out of every Book, neither bought nor sold on a signal while its Disaster stop stays, until its Correction is approved or you dismiss its flag as a false alarm: Dismiss it, then Save answers.</p>',
    ...lists,
    '</section>',
  ].join('\n')
}

/** How long from one day to a later one, in calendar months and days: "2 months and 29 days", "today". */
function lasted(since: string, today: string): string {
  const [y1, m1, d1] = since.split('-').map(Number)
  const [y2, m2, d2] = today.split('-').map(Number)
  const months = (y2 - y1) * 12 + (m2 - m1) - (d2 < d1 ? 1 : 0)
  // The day as many months on, or the last of its month when it has fewer days.
  const lastDay = new Date(Date.UTC(y1, m1 - 1 + months + 1, 0)).getUTCDate()
  const anchor = Date.UTC(y1, m1 - 1 + months, Math.min(d1, lastDay))
  const days = Math.round((Date.UTC(y2, m2 - 1, d2) - anchor) / 86_400_000)
  const parts = [...(months > 0 ? [plural(months, 'month')] : []), ...(days > 0 ? [plural(days, 'day')] : [])]
  return parts.length ? parts.join(' and ') : 'today'
}

/** A Sleeve's strategy: its name over its id. */
const strategyCell = (s: PdSleeve) => `${esc(s.name ?? s.strategy_id)}<br><span class="muted">${esc(s.strategy_id)}</span>`

/** A Sleeve's version, and what became of its strategy when it changed since. */
function versionCell(s: PdSleeve): string {
  if (s.current_version === s.version) return esc(s.version)
  const why = s.current_version === null ? 'its strategy is no built-in now' : `its strategy changed since: version ${s.current_version} is a Sleeve of its own`
  return `${esc(s.version)}<br><span class="muted">${esc(why)}</span>`
}

/** Each Candidate waiting for approval into Paper, with its Approve button; nothing when the Stages weren't read. */
function candidatesSection(stages: PdStagesCheck | null): string {
  if (!stages) return ''
  const candidates = waitingCandidates(stages)
  if (!candidates.length) return '<section><h2>Candidates</h2><p>No Candidate is waiting for your approval.</p></section>'
  const books = new Map(stages.books.map((b) => [b.book, b.name]))
  const rows = candidates.map((s) => [
    String(s.id),
    esc(books.get(s.book) ?? s.book),
    strategyCell(s),
    esc(s.version),
    esc(`${s.since}, ${s.history[0]?.by ?? ''}`),
    esc(s.history[0]?.why ?? ''),
    answerButtons(answerItem('candidate', s.id)),
  ])
  return [
    `<section><h2>Candidates waiting for your approval: ${candidates.length}</h2>`,
    "<p>Approving one moves it into Paper: ash_new launches it, so its live track starts that day, and the paper Book holds it at its full share, while the real Book holds none of it until it is promoted. Approve each you want, then Save answers: the next Run records your Answers in ash_new. One you don't approve waits here.</p>",
    table(['Id', 'Book', 'Strategy', 'Version', 'Recorded', 'Why', 'Your Answer'], rows),
    '</section>',
  ].join('\n')
}

/**
 * Each Book's Sleeves with their Stages, since when and for how long, and the Retired ones winding
 * down; that they couldn't be read when the Stages Step failed, and nothing when it didn't run.
 */
function stagesSection(run: RunRecord, stages: PdStagesCheck | null): string {
  const step = run.steps.find((s) => s.name === 'stages')
  if (!stages)
    return step?.status === 'failed' ? `<section><h2>Sleeves and Stages</h2><p>The Books' Sleeves couldn't be read in this Run. See the Stages Step's log: ${logLink(step.log ?? 'logs/stages.log')}</p></section>` : ''
  const books = stages.books.map((book) => {
    if (!book.sleeves.length) return `<h3>${esc(book.name)}</h3>\n<p>No strategy has a Sleeve yet.</p>`
    const held = book.sleeves.filter((s) => s.stage !== 'retired')
    const retired = book.sleeves.filter((s) => s.stage === 'retired')
    const since = (s: PdSleeve) => esc(`${s.since}, ${lasted(s.since, book.today)}`)
    const rows = held.map((s) => [strategyCell(s), versionCell(s), esc(stageName(s.stage)), since(s), esc(s.launch_date ?? '—')])
    const retiredRows = retired.map((s) => [strategyCell(s), esc(s.version), since(s), esc(s.history.at(-1)?.why ?? '')])
    return [
      `<h3>${esc(book.name)}</h3>`,
      held.length ? table(['Strategy', 'Version', 'Stage', 'Since', 'Live since'], rows) : '<p>Only Retired strategies, winding down.</p>',
      ...(retired.length ? [`<details><summary>Retired, winding down through their strategies' own exits: ${retired.length}</summary>\n${table(['Strategy', 'Version', 'Retired', 'Why'], retiredRows)}</details>`] : []),
    ].join('\n')
  })
  return [
    '<section><h2>Sleeves and Stages</h2>',
    ...books,
    '<p class="muted">In a real Book a Paper strategy holds nothing, a Real-small one a quarter of its share and a Real-full one all of it; the paper Book holds each from Paper up at its full share. A strategy whose version changes starts again as a Candidate, the old version keeping its Stage until the new one replaces it.</p>',
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

/** An amount in a Book's currency, as its market writes it: ₹1,52,180; `decimals` for a share's price. */
function money(amount: number, currency: string, decimals = 0): string {
  const locale = currency === 'INR' ? 'en-IN' : 'en-US'
  return new Intl.NumberFormat(locale, { style: 'currency', currency, minimumFractionDigits: decimals, maximumFractionDigits: decimals }).format(amount)
}

/** A Book's real money: its holdings and value, and its latest Reconciliation's differences. */
function bookSection(book: PdBook): string {
  const files = brokerFiles(book.broker)
  if (book.portfolio_id === null)
    return `<section><h2>${esc(book.name)}</h2><p>No ${esc(book.broker_name)} file is recorded yet: drop its ${esc(files.tradebook)} and ${esc(files.holdings)} export in the Broker inbox, ${esc(brokerInboxDir())}, and the next Run records them.</p></section>`
  const at = (amount: number | null, decimals = 0) => (amount === null ? '—' : esc(money(amount, book.currency, decimals)))
  const value = `<p>${at(book.value)} at ${esc(book.broker_name)}${book.as_of ? ` on the closes of ${esc(book.as_of)}` : ''}, ${at(book.cash)} of it in cash.</p>`
  const rows = book.holdings.map((h) => [
    esc(h.security_id),
    esc(h.name ?? ''),
    esc(shares(h.qty)),
    at(h.avg_cost, 2),
    h.price === null ? '—' : `${at(h.price, 2)}${h.priced_on ? ` on ${esc(h.priced_on)}` : ''}`,
    at(h.value),
  ])
  const holdings = rows.length ? table(['Security', 'Name', 'Shares', 'Average cost', 'Close', 'Value'], rows) : '<p>It holds nothing.</p>'
  return [`<section><h2>${esc(book.name)}</h2>`, value, holdings, reconciliationPart(book), '</section>'].join('\n')
}

/** A Book's latest Reconciliation: what matched, and each difference with what to do about it. */
function reconciliationPart(book: PdBook): string {
  const r = book.reconciliation
  const held = brokerFiles(book.broker).holdings
  if (!r) return `<p>No ${esc(book.broker_name)} ${esc(held)} export has been reconciled yet: drop one in the Broker inbox each Saturday.</p>`
  const of = `Reconciled with ${esc(r.file)}, ${esc(book.broker_name)}'s ${esc(held)} of ${esc(r.as_of)}: ${r.matched} match`
  if (!r.differences.length) return `<p>${of}, and nothing differs.</p>`
  const rows = r.differences.map((d) => [esc(securityName(d)), d.ledger_qty === null ? '—' : esc(shares(d.ledger_qty)), esc(shares(d.broker_qty)), esc(differenceText(d, book))])
  return `<p>${of}, and these ${r.differences.length} differ, each a To-do until a later holdings export settles it:</p>\n${table(['Security', 'Ledger', esc(book.broker_name), ''], rows)}`
}

/**
 * Each Book's real money, and what became of this Run's Broker inbox files; that they couldn't be read
 * when the Broker inbox Step failed first, and nothing when it didn't run.
 */
function booksSection(run: RunRecord, inbox: BrokerInboxResult | null): string {
  const step = run.steps.find((s) => s.name === 'broker-inbox')
  const unread = `<section><h2>Real Books</h2><p>The Books' holdings couldn't be read in this Run. See the Broker inbox Step's log: ${logLink(step?.log ?? 'logs/broker-inbox.log')}</p></section>`
  if (!inbox) return step?.status === 'failed' ? unread : ''
  const books = inbox.books?.books.map(bookSection) ?? [unread]
  const files = inbox.files.length
    ? [`<section><h2>This Run's Broker inbox files</h2>`, inbox.dryRun ? '<p>Dry run: none was recorded, and each stays in the Broker inbox.</p>' : '', list(inbox.files.map((f) => esc(fileLine(f)))), '</section>'].filter(Boolean)
    : []
  return [...books, ...files].join('\n')
}

/** A security in a table cell: its name over its id. */
const securityCell = (id: string, name: string | null) => (name ? `${esc(name)}<br><span class="muted">${esc(id)}</span>` : esc(id))

/** A Book state, as its Rule plan starts from it: its cash, its holdings, what is unsettled. */
function statePart(state: PdBookState | undefined): string {
  if (!state) return "<p>Its state couldn't be read in this Run.</p>"
  const at = (amount: number) => esc(money(amount, state.currency))
  const capital = state.capital_set ? `its capital of ${at(state.capital)}` : `its capital, ${at(state.capital)} until you set it (its market's cost preset's)`
  const ledger = state.ledger.transactions ? `${plural(state.ledger.transactions, 'trade')} in its ledger, the last on ${esc(state.ledger.last ?? '')}` : 'nothing in its ledger yet'
  const rows = state.holdings.map((h) => [securityCell(h.security_id, h.name), esc(shares(h.qty)), h.avg_cost === null ? '—' : esc(money(h.avg_cost, state.currency, 2)), h.legacy ? 'Legacy' : ''])
  const unsettled = state.unsettled.map(
    (u) => `${esc(u.name ?? u.security_id ?? '')}${u.security_id ? ` (${esc(u.security_id)})` : ''}: ${esc(u.kind.replaceAll('_', ' '))}, ledger ${u.ledger_qty === null ? '—' : esc(shares(u.ledger_qty))}, broker ${esc(shares(u.broker_qty))}`,
  )
  return [
    `<h3>The Book state ${esc(state.id)}</h3>`,
    `<p>${at(state.cash)} in cash: ${capital}, with ${ledger}. No open order or Disaster stop is recorded yet.</p>`,
    rows.length ? table(['Holding', 'Shares', 'Average cost', ''], rows) : '<p>It holds nothing.</p>',
    ...(unsettled.length ? ['<p>Unsettled, so neither bought nor sold on a signal until a holdings export settles it:</p>', list(unsettled)] : []),
  ].join('\n')
}

/** A Rule plan's orders, each marked not for placing, with the signal behind it and any cut. */
function ordersPart(plan: PdRulePlan): string {
  const orders = plan.orders ?? []
  const currency = plan.currency ?? 'INR'
  if (!orders.length) return '<p>No order for the next session.</p>'
  const rows = orders.map((o) => [
    esc(o.id),
    securityCell(o.security_id, o.name),
    o.side === 'BUY' ? 'Buy' : 'Sell',
    esc(shares(o.shares)),
    esc(money(o.price, currency, 2)),
    o.limit === null ? '—' : esc(money(o.limit, currency, 2)),
    esc(signalText(o, plan)),
    esc(o.cuts.map(cutText).join('; ')) || '—',
    'Not for placing',
  ])
  return table(['Id', 'Security', 'Side', 'Shares', 'Last close', 'Limit', 'Signal', 'Cut', ''], rows)
}

/** A Book's state beside its shadow Rule plan: what the plan was made from, its orders, what it stopped and its Disaster stops. */
function shadowPart(plan: PdRulePlan, state: PdBookState | undefined): string {
  const head = `<h2>${esc(plan.name)} in shadow${plan.session ? `: its Rule plan for ${esc(plan.session)}` : ''}, not for placing</h2>`
  if (plan.status === 'cant_plan') return [`<section>${head}`, `<p>No shadow Rule plan could be made: ${esc(plan.why ?? '')}</p>`, statePart(state), '</section>'].join('\n')
  const currency = plan.currency ?? 'INR'
  const nameOf = (sleeve: string) => (sleeve === 'gold' ? 'gold' : (plan.strategies?.find((s) => s.id === sleeve)?.name ?? sleeve))
  const strategies = (plan.strategies ?? []).map((s) => `${esc(s.name)} (${esc(s.id)}, version ${esc(s.version)}), its Disaster stops ${percent(s.disaster_stop)} under`).join('; ')
  const weights = Object.entries(plan.weights ?? {}).map(([sleeve, w]) => `${esc(nameOf(sleeve))} ${percent(w)}`)
  const madeFrom = `Made from the Book state ${esc(plan.state_id)}, the data to ${esc(plan.as_of ?? '')}'s close (version ${esc(plan.data_version ?? '')}), ${strategies}, and the Mandate's version ${esc(plan.mandate_version)}.`
  const dropped = (plan.dropped ?? []).map((d) => `${esc(d.name ?? d.security_id)} (${esc(d.security_id)}): a ${d.side === 'BUY' ? 'buy' : 'sale'} of ${esc(shares(d.wanted))} shares stopped by ${esc(ruleName(d.rule))}`)
  const stops = (plan.stops ?? []).map((s) => `${esc(s.name ?? s.security_id)} (${esc(s.security_id)}): ${s.was === null ? 'place at' : `raise from ${esc(money(s.was, currency, 2))} to`} ${esc(money(s.price, currency, 2))}`)
  const legacy = (plan.legacy ?? []).map((h) => `${esc(h.name ?? h.security_id)} (${esc(h.security_id)}): ${esc(shares(h.qty))} shares`)
  return [
    `<section>${head}`,
    '<p>One Book end to end before any judgement: its state, and the Rule plan the Book engine makes from it with one Sleeve at its full share beside gold and the cash fund. Nothing here is recorded as an order, and none of it is for placing.</p>',
    statePart(state),
    `<h3>The shadow Rule plan ${esc(plan.id)}</h3>`,
    `<p>${madeFrom}</p>`,
    `<p>${esc(money(plan.cash ?? 0, currency))} shared out${weights.length ? `: ${weights.join(', ')}` : ''}; the Book worth ${esc(money(plan.value ?? 0, currency))} on the last close. Buys of ${esc(money(plan.buys ?? 0, currency))}, sales of ${esc(money(plan.sales ?? 0, currency))}.</p>`,
    ordersPart(plan),
    ...(dropped.length ? ['<p>Stopped by a rule, so not in the plan:</p>', list(dropped)] : []),
    ...(stops.length ? ['<p>Disaster stops to place with the buys, or raise:</p>', list(stops)] : []),
    ...(legacy.length ? ['<p>Legacy holdings, held, not sold: issue 43 sells them as the Sleeves need the cash.</p>', list(legacy)] : []),
    '</section>',
  ].join('\n')
}

/**
 * Each Book's state beside its shadow Rule plan; that none was made when the Plan Step failed, and
 * nothing when it didn't run.
 */
function plansSection(run: RunRecord, plan: PdPlan | null, states: BookStates | null): string {
  const step = run.steps.find((s) => s.name === 'plan')
  if (!plan) return step?.status === 'failed' ? `<section><h2>Rule plans</h2><p>No Rule plan was made in this Run. See the Plan Step's log: ${logLink(step.log ?? 'logs/plan.log')}</p></section>` : ''
  return plan.plans.map((p) => shadowPart(p, states?.states.find((s) => s.book === p.book))).join('\n')
}

/** What MarketSmith's fetch brought, on a Saturday: nothing on other days, when the Step skips itself. */
function marketSmithSection(fetched: PdMarketSmith | null): string {
  if (!fetched) return ''
  const lines = fetched.regions.map((r) => `${esc(fetchLine(r))}.`)
  return `<section><h2>MarketSmith</h2>\n${lines.map((line) => `<p>${line}</p>`).join('\n')}</section>`
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
.answer { display: flex; flex-wrap: wrap; gap: 0.25rem; min-width: 9rem; }
.answer button, .save-bar button { font: inherit; font-size: 0.9rem; color: var(--fg); background: var(--bg); border: 1px solid var(--line); border-radius: 4px; padding: 0.1rem 0.6rem; cursor: pointer; }
.answer button[aria-pressed="true"] { background: var(--fg); color: var(--bg); border-color: var(--fg); }
.answer-note { font: inherit; font-size: 0.85rem; width: 100%; box-sizing: border-box; color: var(--fg); background: var(--bg); border: 1px solid var(--line); border-radius: 4px; padding: 0.1rem 0.4rem; }
.answer:not(.chosen) .answer-note { display: none; }
.save-bar { position: sticky; bottom: 0; background: var(--panel); border-top: 1px solid var(--line); padding: 0.5rem 1rem; margin: 2rem -1rem 0; }
.save-bar button { background: var(--fg); color: var(--bg); border-color: var(--fg); }
.save-bar button:disabled { opacity: 0.4; cursor: default; }
`

/**
 * `status` is the Lake's as the Lake Step read it; `latest`, as the Health Step read it again once it
 * recorded the Health Agent's Corrections, so they are among those waiting.
 */
function render(run: RunRecord, answers: AnswersResult | null, inbox: BrokerInboxResult | null, marketSmith: PdMarketSmith | null, lake: LakeResult | null, status: PdStatus | null, latest: PdStatus | null, stages: PdStagesCheck | null, health: HealthResult | null, plan: PdPlan | null, states: BookStates | null, todos: { step: string; todo: string }[]): string {
  const lakeLog = run.steps.find((s) => s.name === 'lake')?.log ?? 'logs/lake.log'
  const waiting = latest ?? status
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
${answersSection(answers)}
${correctionsSection(waiting)}
${quarantineSection(waiting)}
${candidatesSection(stages)}
${marketsSection(status)}
${todosSection(todos)}
${stagesSection(run, stages)}
${booksSection(run, inbox)}
${plansSection(run, plan, states)}
${marketSmithSection(marketSmith)}
${lakeSection(lake, status)}
${healthSection(status)}
${runHealthSection(run)}
${saveAnswers(run.id, waitingItems(waiting, stages))}
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
  writeText(out, render(readRun(runId), read<AnswersResult>('answers.json'), read<BrokerInboxResult>('broker-inbox.json'), read<PdMarketSmith>('marketsmith.json'), read<LakeResult>('lake.json'), read<PdStatus>(join('lake', 'status.json')), read<PdStatus>(join('health', 'status.json')), read<PdStagesCheck>('stages.json'), read<HealthResult>('health.json'), read<PdPlan>('plan.json'), read<BookStates>('book-states.json'), readTodos(runFolder)))
  console.log(`Wrote ${out}`)
})
