// Brief: writes the Stocks Brief, one self-contained HTML page in the Run folder that loads nothing
// from the internet, from what earlier Steps wrote there: the Data gate's verdict and its reasons;
// under them, the Health Agent's diagnosis and proposed fix, or that it failed, with what became of
// the Corrections it proposed; what became of the Answers this Run applied; each Correction waiting
// for approval with what it would change; each Quarantine with its flag; each Candidate waiting for
// approval into Paper; each promotion the Portfolio Manager proposed, waiting for approval; each
// proposal to move a Judgement mode or change a Playbook's ranges; each market's latest session in
// the Lake against its last finished one; the To-dos the Steps raised; each Book's Sleeves with their
// Stages and how long each has been in its Stage; on Saturdays, the weekly review (the Portfolio
// Manager's commentary, each demotion the demotion rule made, each paper Book and Sleeve against its
// backtest's range and its benchmark, the promotions due and Reconciliation's differences); on a
// month's first Saturday, the monthly review (the Portfolio Manager's commentary, each paper Book's
// return over the month attributed to its sources, the correlation between its Sleeves, its drawdown
// against its limits and the promotions due); each
// Book's real holdings and value, its latest Reconciliation's differences and this Run's Broker inbox
// files; each market's Market condition with MarketSmith's outlook beside it and each Book's exposure
// level; on a day the Data gate fails, that every plan is in Hold mode; the India Book's state
// beside its shadow Rule plan and each paper Book's beside its Rule plan, every order marked not for
// placing, with its rules-only paper Book's plan after it; the Portfolio Manager's judgement of each paper Book (its Judgement
// mode, its commentary, what went out and why, each change with its Decision record in plain
// sentences, and each change the final check dropped with why) and each Book's Judgement modes; the
// Order lists the Check Step recorded, or why none was; how each paper Book stands (its value and its
// gap to its rules-only paper Book, its drawdown against its breakers, its Sleeves and Stages, the
// Disaster stops that would lose more than 1% of it, and the Books together in rupees); on Saturdays,
// what MarketSmith's fetch brought; how this Run's Lake Step went and how ash_new's last refresh
// ended; the Health report's verdict and flags; and the Run's health.
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
import { changeText, decisionText, modeName, proposalText } from '../../src/judgement.ts'
import type { PdBook, PdBookState, PdJudgementShow, PdMarketSmith, PdOrderList, PdPaperBook, PdPaperBooks, PdPlan, PdReview, PdRulePlan, PdSleeve, PdStageProposal, PdStagesCheck, PdStatus } from '../../src/pd.ts'
import { breadthOf, conditionName, cutText, percent, ruleName, signalText, stateOf } from '../../src/plans.ts'
import { readRun, stepsNotSucceeded, type RunRecord } from '../../src/run.ts'
import { stageName } from '../../src/stages.ts'
import { runAsStep } from '../../src/step.ts'
import { readTodos } from '../../src/todos.ts'
import type { AnswersResult } from './answers.ts'
import type { BrokerInboxResult } from './broker-inbox.ts'
import type { CheckResult } from './check.ts'
import type { HealthResult, Proposals } from './health.ts'
import type { LakeResult, RefreshAttempt } from './lake.ts'
import type { BookStates } from './plan.ts'
import type { PortfolioManagerResult } from './portfolio-manager.ts'
import type { PromotionsResult } from './save-state.ts'

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

/** Each proposal to move a Book's Judgement mode or change its Playbook's ranges, with its Answer buttons; nothing when none waits. */
function proposalsSection(modes: PdJudgementShow | null): string {
  if (!modes?.proposals.length) return ''
  const books = new Map(modes.books.map((b) => [b.book, b.name]))
  const rows = modes.proposals.map((p) => {
    const book = books.get(p.book) ?? p.book
    return [String(p.id), esc(proposalText(p, book)), esc(`${p.at.slice(0, 10)}, ${p.by}`), esc(p.why), answerButtons(answerItem('judgement', p.id))]
  })
  return [
    `<section><h2>Judgement proposals waiting for your Answer: ${modes.proposals.length}</h2>`,
    "<p>A Book's Judgement mode and its Playbook's ranges change only by your Answer. Approve or reject each, then Save answers: the next Run records your Answers in ash_new, and an approved range is in force from then on, under a new Playbook version.</p>",
    table(['Id', 'Proposal', 'Proposed', 'Why', 'Your Answer'], rows),
    '</section>',
  ].join('\n')
}

/** The promotions waiting on Saransh: those the Stages Step read, then those Save state recorded in this Run. */
function waitingPromotions(stages: PdStagesCheck | null, promotions: PromotionsResult | null): PdStageProposal[] {
  const proposed = (promotions?.promotions ?? []).flatMap(({ decided }) => (decided.changed && decided.proposal ? [decided.proposal] : []))
  const found = [...(stages?.proposals ?? []), ...proposed]
  return found.filter((p, i) => found.findIndex((q) => q.id === p.id) === i)
}

/** Each promotion waiting for Saransh's Answer, with its Approve and Reject buttons; nothing when none waits. */
function promotionsSection(waiting: PdStageProposal[], stages: PdStagesCheck | null): string {
  if (!waiting.length) return ''
  const books = new Map((stages?.books ?? []).map((b) => [b.book, b]))
  const rows = waiting.map((p) => {
    const sleeve = books.get(p.book)?.sleeves.find((s) => s.id === p.sleeve)
    return [
      String(p.id),
      esc(books.get(p.book)?.name ?? p.book),
      sleeve ? strategyCell(sleeve) : esc(p.strategy_id),
      esc(`${stageName(p.from)} to ${stageName(p.stage)}`),
      esc(`${p.at.slice(0, 10)}, ${p.by}`),
      esc(p.why),
      answerButtons(answerItem('promotion', p.id)),
    ]
  })
  return [
    `<section><h2>Promotions waiting for your approval: ${waiting.length}</h2>`,
    "<p>A strategy gets more money only by your Answer. The Portfolio Manager proposes a promotion when its time in its Stage is up (3 months of Paper, 6 of Real-small) and its live record is inside its tested range. Approve or reject each, then Save answers: the next Run records your Answers in ash_new, and its Rule plans hold an approved one at its new Stage. One you don't answer waits here while it stays in its Stage.</p>",
    table(['Id', 'Book', 'Strategy', 'Promotion', 'Proposed', 'Why', 'Your Answer'], rows),
    '</section>',
  ].join('\n')
}

type MonthlyBook = NonNullable<PdReview['monthly']>['books'][number]

/** A part of a month's return, to the hundredth of a point: a part of a month is often under a tenth. */
const part = (share: number) => `${(Math.round(share * 10_000) / 100).toFixed(2)}%`

/** The month YYYY-MM in words: October 2026. */
const monthName = (month: string) => {
  const [year, number] = month.split('-').map(Number)
  return new Date(year, number - 1, 1).toLocaleString('en-GB', { month: 'long', year: 'numeric' })
}

/** A currency against the rupee, as the attribution's row names it. */
const currencyName: Record<string, string> = { USD: 'The dollar against the rupee', HKD: 'The Hong Kong dollar against the rupee' }

/** The Mandate's drawdown limits in words. */
const limitName = { no_new_buys_at: 'no new buys', halve_exposure_at: 'half the exposure level', drawdown_limit: 'the drawdown limit' } as const

/** A Book's month: its return attributed to its sources, the correlation between its Sleeves and its drawdown against its limits. */
function monthlyBookPart(book: MonthlyBook, names: Map<string, string>): string {
  const { attribution: a, correlation: c, drawdown: d } = book
  const name = (id: string) => (id === 'gold' ? 'Gold' : (names.get(id) ?? id))
  const out = [`<h3>${esc(book.name)}</h3>`]
  if (a.parts && a.return !== null) {
    const p = a.parts
    const rows = [
      ['Sleeve weights', esc(part(p.sleeve_weights)), "Each Sleeve's holdings at the benchmark's return"],
      ['Picks within Sleeves', esc(part(p.picks)), "What the Sleeves' holdings made beyond the benchmark"],
      ['Gold', esc(part(p.gold)), ''],
      ['Cash', esc(part(p.cash)), "The cash fund's return"],
      ['Costs', esc(part(p.costs)), ''],
      ['Overrides', p.overrides === null ? '—' : esc(part(p.overrides)), p.overrides === null ? esc(a.overrides_why ?? '') : 'The paper Book against its rules-only paper Book'],
      ...(p.currency !== null && a.fx ? [[esc(currencyName[book.currency] ?? book.currency), esc(part(p.currency)), esc(`${a.fx.from.toFixed(2)} to ${a.fx.to.toFixed(2)} rupees`)]] : []),
      ['<strong>Its return</strong>', `<strong>${esc(part(a.return))}</strong>`, esc(`In ${a.currency === 'INR' ? 'rupees' : a.currency}, ${plural(a.sessions, 'session')} from ${a.start}'s close to ${a.end}'s`)],
    ]
    out.push(table(['Source', 'Part of its return', ''], rows))
    if (a.sleeves.length > 1) out.push(list(a.sleeves.map((s) => esc(`${name(s.strategy_id)}: ${part(s.weights)} from its weight, ${part(s.picks)} from its picks`))))
    const versus = [a.benchmark_return !== null ? `its benchmark made ${part(a.benchmark_return)}` : null, a.rules_only_return !== null ? `its rules-only paper Book ${part(a.rules_only_return)}` : null].filter(Boolean)
    if (versus.length) out.push(`<p>Over the month ${esc(versus.join(' and '))}${a.currency === book.currency ? '' : esc(` in ${book.currency}`)}.</p>`)
    if (a.currency_why) out.push(`<p class="muted">${esc(a.currency_why)}.</p>`)
  } else out.push(`<p class="muted">${esc(a.why ?? 'Nothing to attribute')}.</p>`)
  if (c.pairs.length)
    out.push(
      `<p>The correlation of the Sleeves' daily returns from ${esc(c.start)} to ${esc(c.end)}:</p>`,
      table(['Sleeves', 'Correlation'], c.pairs.map((pair) => [esc(`${name(pair.a)} and ${name(pair.b)}`), pair.correlation === null ? '—' : esc(pair.correlation.toFixed(2))])),
    )
  if (d.status === 'measured' && d.drawdown !== null && d.max_drawdown !== null) {
    const limits = (Object.keys(limitName) as (keyof typeof limitName)[]).map((key) => `${percent(d.limits[key])} for ${limitName[key]}`).join(', ')
    const reached = d.reached.length ? ` Its deepest reached ${d.reached.map((key) => limitName[key]).join(' and ')}.` : ' It reached none of them.'
    out.push(`<p>${esc(`Its drawdown: ${percent(d.drawdown)} at the month's end, ${percent(d.max_drawdown)} at its deepest; its limits ${limits}.${reached}`)}</p>`)
  }
  return out.join('\n')
}

/**
 * On a month's first Saturday, the monthly review of the month before: the Portfolio Manager's
 * commentary, each Book's return over the month attributed to its sources, the correlation between its
 * Sleeves, its drawdown against its limits, and the promotions due. Nothing on other days.
 */
function monthlySection(review: PdReview | null, pm: PortfolioManagerResult | null): string {
  const monthly = review?.monthly
  if (!review || !monthly) return ''
  const commentary = pm?.status === 'answered' ? pm.answer.monthly : null
  const names = new Map(review.books.flatMap((b) => b.sleeves.map((s) => [s.strategy_id, s.name ?? s.strategy_id] as const)))
  const books = monthly.books.filter((b) => b.attribution.status === 'measured' || b.drawdown.status === 'measured')
  const reviewed = new Map(review.books.map((b) => [b.book, b]))
  const due = review.promotions_due.map((p) => esc(`${names.get(p.strategy_id) ?? p.strategy_id} in the ${reviewed.get(p.book)?.name ?? p.book}: from ${stageName(p.from)} to ${p.to_name}`))
  return [
    `<section><h2>Monthly review: ${esc(monthName(monthly.month))}</h2>`,
    commentary ? `<p class="text">${esc(commentary)}</p>` : pm?.status === 'failed' ? '<p class="muted">The Portfolio Manager failed, so the monthly review has no commentary.</p>' : '',
    ...(books.length ? books.map((b) => monthlyBookPart(b, names)) : [`<p>No paper Book filled a close in ${esc(monthName(monthly.month))}.</p>`]),
    `<h3>Promotions due</h3>\n${due.length ? list(due) : '<p>None.</p>'}`,
    "<p class=\"muted\">Each paper Book's return is attributed close by close, so the parts add up to it. A Sleeve's weight is what it held at its Book's benchmark's return; its picks, what its holdings made beyond that. The Overrides' part is the paper Book's gap to its rules-only paper Book, which trades the Rule plan unchanged: what the Portfolio Manager's changes did together, not the sum of their own scores, and it lasts as long as their effect does, past the month they were made. The other parts are then the rules-only paper Book's: what the Rule plan's sources made. A Book not in rupees is in rupees here, its currency's move a part of its own.</p>",
    '</section>',
  ]
    .filter(Boolean)
    .join('\n')
}

type ReviewedBook = PdReview['books'][number]
type Judged = ReviewedBook['paper'] | ReviewedBook['sleeves'][number]

/** A live record against its backtest's range and its benchmark, as a row's cells after its name. */
function reviewCells(judged: Judged): string[] {
  const { record, backtest } = judged
  if (!record) return [`<span class="muted">${esc(judged.why ?? '')}</span>`, '', '', '', '', '']
  const window = record.window
  const range = backtest?.window ? `${percent(backtest.window.p5)} to ${percent(backtest.window.p95)}` : '—'
  const inRange =
    judged.in_range === null ? `<span class="muted">${esc(judged.backtest_why ?? "Its range can't be measured yet")}</span>` : judged.in_range ? 'Inside' : `Outside: ${esc(judged.outside.join('; '))}`
  return [
    esc(`${percent(record.return)} since ${record.start}`),
    esc(`${percent(record.drawdown)} now, ${percent(record.max_drawdown)} at worst`),
    esc(record.benchmark ? `${percent(record.benchmark.return)}, ${percent(record.benchmark.max_drawdown)} at worst` : '—'),
    esc(backtest ? percent(backtest.max_drawdown) : '—'),
    esc(window ? `${window.months} months: ${window.return === null ? '—' : percent(window.return)} against ${range}` : 'Under a month'),
    inRange,
  ]
}

/** A demotion in a sentence: what the demotion rule did, or would have, and why. */
function demotionText(d: PdReview['demotions'][number], books: Map<string, ReviewedBook>): string {
  const book = books.get(d.book)
  const name = book?.sleeves.find((s) => s.id === d.sleeve)?.name ?? d.strategy_id
  const moved = d.status === 'demoted' ? 'demoted' : 'not demoted'
  return `${name} in the ${book?.name ?? d.book} was ${moved} from ${stageName(d.from)} to ${stageName(d.to)} by the demotion rule: ${d.why}.${d.held_why ? ` ${d.held_why}.` : ''}`
}

/**
 * On Saturdays, the weekly review: the Portfolio Manager's commentary, each demotion the demotion rule
 * made, each Book's paper Book and Sleeves against their backtests' ranges and benchmarks, the
 * promotions due and each real Book's Reconciliation differences; that it couldn't be had when the
 * Review Step failed, and nothing on other days.
 */
function reviewSection(run: RunRecord, review: PdReview | null, pm: PortfolioManagerResult | null): string {
  const step = run.steps.find((s) => s.name === 'review')
  if (!review)
    return step?.status === 'failed' ? `<section><h2>Weekly review</h2><p>The weekly review's figures couldn't be had in this Run. See the Review Step's log: ${logLink(step.log ?? 'logs/review.log')}</p></section>` : ''
  const commentary = pm?.status === 'answered' ? pm.answer.review : null
  const books = new Map(review.books.map((b) => [b.book, b]))
  const head = ['', 'Stage', 'Live return', 'Drawdown', 'Benchmark', "Backtest's worst", 'Return against its range', 'Its tested range']
  const sections = review.books
    .filter((b) => b.paper.status !== 'not_started' || b.sleeves.length || b.reconciliation?.differences.length)
    .map((book) => {
      const rows = [
        ['Paper Book', '', ...reviewCells(book.paper)],
        ...book.sleeves.map((s) => [esc(s.name ?? s.strategy_id), esc(`${s.stage_name} since ${s.since}`), ...reviewCells(s)]),
      ]
      const differences = book.reconciliation?.differences ?? []
      return [
        `<h3>${esc(book.name)}</h3>`,
        table(head, rows),
        ...(differences.length ? [`<p>Reconciliation, as of ${esc(book.reconciliation!.as_of)}:</p>`, list(differences.map((d) => esc(differenceText(d, book))))] : []),
      ].join('\n')
    })
  const due = review.promotions_due.map((p) => {
    const name = books.get(p.book)?.sleeves.find((s) => s.id === p.sleeve)?.name ?? p.strategy_id
    return esc(`${name} in the ${books.get(p.book)?.name ?? p.book}: from ${stageName(p.from)} to ${p.to_name}, its time up on ${p.due}`)
  })
  return [
    '<section><h2>Weekly review</h2>',
    commentary ? `<p class="text">${esc(commentary)}</p>` : pm?.status === 'failed' ? '<p class="muted">The Portfolio Manager failed, so the review has no commentary.</p>' : '',
    review.demotions.length ? `<h3>Demotions</h3>\n${list(review.demotions.map((d) => esc(demotionText(d, books))))}` : '<p>No strategy broke the demotion rule.</p>',
    ...(sections.length ? sections : ['<p>No Book has a live record yet.</p>']),
    due.length ? `<h3>Promotions due</h3>\n${list(due)}` : '',
    `<p class="muted">Each live record is measured against its backtest over the ten years before it began, and against its benchmark over the same sessions. A strategy is demoted when its live drawdown passes 1.5 times its backtest's worst, or after 12 months its rolling 12-month return falls under its backtest's 5th percentile.${review.gate.verdict === 'fail' ? ' The Data gate failed, so no demotion was applied.' : ''}</p>`,
    '</section>',
  ]
    .filter(Boolean)
    .join('\n')
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
  const cash = !state.paper
    ? `${at(state.cash)} in cash: ${capital}, with ${ledger}. No open order or Disaster stop is recorded yet.`
    : state.as_of
      ? `${at(state.cash)} in cash on its last close filled, ${esc(state.as_of)}.`
      : `${at(state.cash)} in cash: ${capital}, all of it in cash until its first Order list fills.`
  const sessions = [...new Set(state.open_orders.map((o) => o.session))]
  const waiting = state.open_orders.length
    ? `<p>${plural(state.open_orders.length, 'order')} of its Order list for ${esc(sessions.join(', '))} wait to be filled at the open, its buys reserving ${at(state.reserved)}.</p>`
    : ''
  const stops = state.stops.map((stop) => `${esc(stop.security_id)}: ${esc(money(stop.price, state.currency, 2))}`)
  return [
    `<h3>The Book state ${esc(state.id)}</h3>`,
    `<p>${cash}</p>`,
    rows.length ? table(['Holding', 'Shares', 'Average cost', ''], rows) : '<p>It holds nothing.</p>',
    waiting,
    ...(stops.length ? ['<p>Its Disaster stops:</p>', list(stops)] : []),
    ...(unsettled.length ? ['<p>Unsettled, so neither bought nor sold on a signal until a holdings export settles it:</p>', list(unsettled)] : []),
  ]
    .filter(Boolean)
    .join('\n')
}

/** A Rule plan's orders, each marked not for placing, with the signal behind it and any cut. */
function ordersPart(plan: PdRulePlan): string {
  const orders = plan.orders ?? []
  const currency = plan.currency ?? 'INR'
  if (!orders.length) return `<p>No order for the next session${plan.mode === 'hold' ? ': Hold mode' : ''}.</p>`
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

/** What a kind of Rule plan is, under its heading. */
const planAbout = {
  shadow: '<p>One Book end to end before any judgement: its state, and the Rule plan the Book engine makes from it with one Sleeve at its full share beside gold and the cash fund. Nothing here is recorded as an order, and none of it is for placing.</p>',
  paper: '<p>The paper Book holds each strategy from Paper up at its full share, beside gold and the cash fund. The Portfolio Manager judges its Rule plan within its Playbook, the Check Step records its final Order list and ash_new\'s daily chain fills it at the next open: none of it is for you to place.</p>',
  rules_only: "<p>The rules-only paper Book starts with the paper Book and holds the same Sleeves, but always trades its Rule plan unchanged: the paper Book's gap to it is what the Portfolio Manager's judgement added.</p>",
}

/** Whether two plans make the same orders: the same Sleeves, securities, sides and shares. */
const sameOrders = (one: PdRulePlan, other: PdRulePlan) =>
  JSON.stringify((one.orders ?? []).map((o) => [o.sleeve, o.security_id, o.side, o.shares])) === JSON.stringify((other.orders ?? []).map((o) => [o.sleeve, o.security_id, o.side, o.shares]))

/** A rules-only paper Book's Rule plan, short when it makes its paper Book's orders. */
function rulesOnlyPart(plan: PdRulePlan, paper: PdRulePlan | undefined): string {
  const head = `<h2>${esc(plan.name)}${plan.session ? `: its Rule plan for ${esc(plan.session)}` : ''}</h2>`
  if (plan.status !== 'planned') return [`<section>${head}`, `<p>No Rule plan: ${esc(plan.why ?? '')}</p>`, '</section>'].join('\n')
  const currency = plan.currency ?? 'INR'
  const same = paper?.status === 'planned' && sameOrders(plan, paper)
  const orders = `${plural(plan.orders?.length ?? 0, 'order')}, buys of ${esc(money(plan.buys ?? 0, currency))} and sales of ${esc(money(plan.sales ?? 0, currency))}`
  return [
    `<section>${head}`,
    planAbout.rules_only,
    `<p>The Rule plan ${esc(plan.id)}, made from its Book state ${esc(plan.state_id)}: ${orders}${same ? ", the same as its paper Book's" : ''}.</p>`,
    same ? '' : ordersPart(plan),
    '</section>',
  ]
    .filter(Boolean)
    .join('\n')
}

/** A Book's state beside its Rule plan: what the plan was made from, its orders, what it stopped and its Disaster stops. */
function planPart(plan: PdRulePlan, state: PdBookState | undefined): string {
  const shadow = plan.kind === 'shadow'
  const title = shadow ? `${esc(plan.name)} in shadow` : esc(plan.name)
  const head = `<h2>${title}${plan.session ? `: its Rule plan for ${esc(plan.session)}` : ''}${shadow ? ', not for placing' : ''}</h2>`
  if (plan.status === 'market_shut') return [`<section>${head}`, `<p>No order: ${esc(plan.why ?? '')}.</p>`, '</section>'].join('\n')
  if (plan.status === 'cant_plan') return [`<section>${head}`, `<p>No Rule plan could be made: ${esc(plan.why ?? '')}</p>`, statePart(state), '</section>'].join('\n')
  const currency = plan.currency ?? 'INR'
  const nameOf = (sleeve: string) => (sleeve === 'gold' ? 'gold' : (plan.strategies?.find((s) => s.id === sleeve)?.name ?? sleeve))
  const strategies = (plan.strategies ?? []).map((s) => `${esc(s.name)} (${esc(s.id)}, version ${esc(s.version)}, ${esc(stageName(s.stage))}), its Disaster stops ${percent(s.disaster_stop)} under`)
  const weights = Object.entries(plan.weights ?? {}).map(([sleeve, w]) => `${esc(nameOf(sleeve))} ${percent(w)}`)
  const hold = plan.mode === 'hold' ? '<p><strong>Hold mode:</strong> the Data gate fails, so this plan makes no order; its Disaster stops stay.</p>' : ''
  const exposure = plan.exposure
    ? `<p>It trades under an exposure level of ${percent(plan.exposure.level)}, which its market's ${esc(conditionName(plan.exposure.condition))} on the last close sets.</p>`
    : ''
  const sleeves = strategies.length ? `${strategies.join('; ')}, ` : 'no strategy yet (gold and the cash fund alone), '
  const madeFrom = `Made from the Book state ${esc(plan.state_id)}, the data to ${esc(plan.as_of ?? '')}'s close (version ${esc(plan.data_version ?? '')}), ${sleeves}the Mandate's version ${esc(plan.mandate_version)} and the Playbook's ${esc(plan.playbook_version)}.`
  const leftOut = (plan.left_out ?? []).map((l) => `${esc(l.strategy_id)} version ${esc(l.version)} (${esc(stageName(l.stage))}): ${esc(l.why)}`)
  const dropped = (plan.dropped ?? []).map((d) => `${esc(d.name ?? d.security_id)} (${esc(d.security_id)}): a ${d.side === 'BUY' ? 'buy' : 'sale'} of ${esc(shares(d.wanted))} shares stopped by ${esc(ruleName(d.rule))}`)
  const stops = (plan.stops ?? []).map((s) => `${esc(s.name ?? s.security_id)} (${esc(s.security_id)}): ${s.was === null ? 'place at' : `raise from ${esc(money(s.was, currency, 2))} to`} ${esc(money(s.price, currency, 2))}`)
  const legacy = (plan.legacy ?? []).map((h) => `${esc(h.name ?? h.security_id)} (${esc(h.security_id)}): ${esc(shares(h.qty))} shares`)
  return [
    `<section>${head}`,
    planAbout[plan.kind],
    hold,
    statePart(state),
    `<h3>The ${shadow ? 'shadow ' : ''}Rule plan ${esc(plan.id)}</h3>`,
    `<p>${madeFrom}</p>`,
    ...(leftOut.length ? ["<p>Left out, as ash_new can't run them:</p>", list(leftOut)] : []),
    exposure,
    `<p>${esc(money(plan.cash ?? 0, currency))} shared out${weights.length ? `: ${weights.join(', ')}` : ''}; the Book worth ${esc(money(plan.value ?? 0, currency))} on the last close. Buys of ${esc(money(plan.buys ?? 0, currency))}, sales of ${esc(money(plan.sales ?? 0, currency))}.</p>`,
    ordersPart(plan),
    ...(dropped.length ? ['<p>Stopped by a rule, so not in the plan:</p>', list(dropped)] : []),
    ...(stops.length ? ['<p>Disaster stops to place with the buys, or raise:</p>', list(stops)] : []),
    ...(legacy.length ? ['<p>Legacy holdings, held, not sold: issue 43 sells them as the Sleeves need the cash.</p>', list(legacy)] : []),
    '</section>',
  ].join('\n')
}

/** An index's level as a table gives it: 21,427.6. */
const level = (n: number | null) => (n === null ? '—' : n.toLocaleString('en-US', { maximumFractionDigits: 1 }))

/** Each market's Market condition, MarketSmith's outlook beside it, and the exposure level it sets its Book. */
function conditionsSection(plan: PdPlan): string {
  const rows = plan.markets.map((m) => {
    const r = m.reading
    const outlook = m.marketsmith
      ? `${m.marketsmith.outlook === null ? 'not in its snapshot' : esc(m.marketsmith.outlook)} <span class="muted">(${esc(m.marketsmith.snapshot)})</span>`
      : 'no snapshot'
    if (!r) return [esc(m.market), `Can't be read: ${esc(m.why ?? '')}`, '—', '—', '—', outlook, '—']
    return [
      esc(m.market),
      esc(conditionName(r.condition)),
      `${esc(r.index)} ${esc(level(r.close))}<br><span class="muted">50-day ${esc(level(r.short_average))}, 200-day ${esc(level(r.long_average))}</span>`,
      r.breadth === null ? '—' : esc(`${percent(r.breadth)} ${breadthOf(r.breadth_of)}`),
      String(r.distribution_days),
      outlook,
      `${esc(m.book_name)}: ${percent(m.exposure_level ?? 1)}`,
    ]
  })
  const day = plan.markets.find((m) => m.reading)?.reading?.date
  return [
    `<section><h2>Market condition${day ? ` on ${esc(day)}'s close` : ''}</h2>`,
    table(['Market', 'Condition', 'Index against its averages', 'Breadth', 'Distribution days', "MarketSmith's outlook", 'Exposure level'], rows),
    "<p class=\"muted\">Breadth is the share of the index's members (or the market's stocks, where the Lake keeps no membership) above their own 200-day average; a distribution day is a fall of the index of 0.2% or more on more volume than the day before, counted over 25 sessions. The exposure level is the most of the Book in stocks for the next session: over it, a Book makes no new buys and trims its weakest holdings first. Its levels (100%, 80% and 40%) and the thresholds are placeholders until you set them. MarketSmith's outlook decides nothing.</p>",
    '</section>',
  ].join('\n')
}

/**
 * Hold mode, when the Data gate fails; each market's condition; then each Book's state beside its Rule
 * plan, the shadow plan first; that none was made when the Plan Step failed, and nothing when it didn't run.
 */
function plansSection(run: RunRecord, plan: PdPlan | null, states: BookStates | null): string {
  const step = run.steps.find((s) => s.name === 'plan')
  if (!plan) return step?.status === 'failed' ? `<section><h2>Rule plans</h2><p>No Rule plan was made in this Run. See the Plan Step's log: ${logLink(step.log ?? 'logs/plan.log')}</p></section>` : ''
  const hold =
    plan.mode === 'hold'
      ? `<section class="gate fail"><h2>Hold mode: no Rule plan makes an order today.</h2><p>The Data gate fails, so nothing new is bought and exits happen only through Disaster stops:</p>\n${list(plan.gate.reasons.map(esc))}</section>`
      : ''
  const paperOf = (p: PdRulePlan) => plan.plans.find((other) => other.book === p.book && other.kind === 'paper')
  const parts = plan.plans.map((p) => (p.kind === 'rules_only' ? rulesOnlyPart(p, paperOf(p)) : planPart(p, stateOf(states?.states ?? [], p))))
  return [hold, conditionsSection(plan), ...parts].filter(Boolean).join('\n')
}

/** What went out for a paper Book, and why not the Portfolio Manager's changes. */
const wentOut = {
  judgement: "Its Order list went out with the Portfolio Manager's changes that passed the final check.",
  rule_plan: 'Its Rule plan went out instead',
  exits_only: 'Only its exits and Disaster stops went out',
}

/** The Portfolio Manager's judgement of a paper Book's plan, as the final check left it. */
function bookJudgement(listed: PdOrderList, modes: PdJudgementShow | null): string {
  const judged = listed.judgement!
  const mode = modes?.books.find((b) => b.book === listed.book)?.paper
  const went = judged.applied === 'judgement' ? wentOut.judgement : `${wentOut[judged.applied]}: ${esc(judged.why ?? '')}.`
  const accepted = judged.changes.filter((c) => c.accepted)
  const dropped = judged.changes.filter((c) => !c.accepted)
  const sent = judged.applied === 'judgement' ? '' : ', each passing on its own but not sent'
  return [
    `<h3>${esc(listed.name)}${mode ? `, in ${esc(modeName(mode.mode))} mode` : ''}</h3>`,
    judged.commentary ? `<p class="text">${esc(judged.commentary)}</p>` : '',
    `<p>${went} Its exposure level for the day: ${percent(judged.level)}.</p>`,
    ...(accepted.length
      ? [`<p>Its changes from the Rule plan${sent}:</p>`, list(accepted.map((c) => `<strong>${esc(changeText(c))}.</strong> ${esc(decisionText(c.decision))}`))]
      : ['<p>No change from the Rule plan.</p>']),
    ...(dropped.length ? ['<p>Dropped by the final check:</p>', list(dropped.map((c) => `${esc(changeText(c))}: ${esc(c.why ?? '')}`))] : []),
  ]
    .filter(Boolean)
    .join('\n')
}

/**
 * The Portfolio Manager's judgement of each paper Book, or that it failed or didn't run, then each
 * Book's Judgement modes; nothing when it isn't in this Run.
 */
function judgementSection(run: RunRecord, pm: PortfolioManagerResult | null, result: CheckResult | null, modes: PdJudgementShow | null): string {
  const step = run.steps.find((s) => s.name === 'portfolio-manager')
  if (!step && !pm) return ''
  const log = logLink(step?.log ?? 'logs/portfolio-manager.log')
  let intro = ''
  if (pm?.status === 'failed') intro = `<p>The Portfolio Manager failed, so each paper Book's Rule plan went out instead, once it passed the final check: ${esc(pm.error)}. See its log: ${log}</p>`
  else if (!pm) intro = `<p>The Portfolio Manager didn't judge the plans in this Run, so each paper Book's Rule plan went out, once it passed the final check. See its log: ${log}</p>`
  const books = (result?.check?.lists ?? []).filter((l) => l.judgement && l.kind === 'paper').map((l) => bookJudgement(l, modes))
  const rows = (modes?.books ?? []).map((b) => [
    esc(b.name),
    esc(`${modeName(b.real.mode)}${b.real.change ? `, since ${b.real.change.date}` : ''}`),
    esc(`${modeName(b.paper.mode)}${b.paper.change ? `, since ${b.paper.change.date}` : ''}`),
    esc(`size ${b.playbook.size_min}× to ${b.playbook.size_max}×, waits up to ${b.playbook.timing_sessions} sessions, rebalances under ${percent(b.playbook.rebalance_under)} skipped, exposure floors ${percent(b.playbook.exposure_floor.uptrend)}, ${percent(b.playbook.exposure_floor.under_pressure)} and ${percent(b.playbook.exposure_floor.correction)}`) +
      `<br><span class="muted">version ${esc(b.playbook.version)}</span>`,
  ])
  return [
    '<section><h2>The Portfolio Manager</h2>',
    intro,
    ...books,
    ...(rows.length
      ? [
          '<h3>Judgement modes and Playbooks</h3>',
          table(['Book', 'Real Book', 'Paper Book', 'Playbook'], rows),
          "<p class=\"muted\">In plan only mode no change goes out; in subtract only mode, exposure cuts, dropped buys, sizes down, trims, waits and rebalance skips; in Playbook mode also swaps to Pool names and sizes up to the range's top. The ranges are placeholders until you set them.</p>",
        ]
      : []),
    '</section>',
  ]
    .filter(Boolean)
    .join('\n')
}

/** What became of each paper Book's Order list in this Run, or why none was recorded. */
function checkSection(run: RunRecord, result: CheckResult | null): string {
  const step = run.steps.find((s) => s.name === 'check')
  const head = '<section><h2>Order lists</h2>'
  if (!result) return step?.status === 'failed' ? `${head}<p>No Order list was recorded: the Check Step failed. See its log: ${logLink(step.log ?? 'logs/check.log')}</p></section>` : ''
  if (!result.check) return `${head}<p>No Order list was recorded in this Run: ${esc(result.why ?? '')}.</p></section>`
  const shown = { recorded: 'Recorded', unchanged: 'Recorded already', not_recorded: 'Not recorded', would_record: 'Would be recorded' }
  const rows = result.check.lists.map((l) => [
    esc(l.name),
    esc(l.session ?? '—'),
    String(l.orders),
    `${shown[l.status]}${l.superseded ? `, superseding ${plural(l.superseded, 'order')} recorded earlier` : ''}${l.why ? `: ${esc(l.why)}` : ''}`,
  ])
  return [
    head,
    result.check.dry_run ? '<p>Dry run: nothing was recorded.</p>' : '',
    '<p>Each paper Book\'s Order list is its Rule plan with the Portfolio Manager\'s changes that passed the final check; each rules-only paper Book\'s is always its Rule plan. Their orders fill at the next open, once ash_new\'s daily chain\'s Health report passes.</p>',
    table(['Paper Book', 'Session', 'Orders', ''], rows),
    '</section>',
  ]
    .filter(Boolean)
    .join('\n')
}

/** A paper Book's value in a cell: on its last close filled, or its capital before its first list fills. */
function standingCell(book: PdPaperBook, kind: 'paper' | 'rules_only'): string {
  const standing = book[kind]
  const value = esc(money(standing.value, book.currency))
  return standing.as_of ? `${value}<br><span class="muted">on ${esc(standing.as_of)}</span>` : `${value}<br><span class="muted">not started: all cash</span>`
}

/** A paper Book's drawdown against its breakers, and which have tripped. */
function drawdownCell(book: PdPaperBook): string {
  const { drawdown, buying, halved } = book.paper
  const tripped = [!buying ? 'no new buys' : '', halved ? 'half exposure' : ''].filter(Boolean)
  const breakers = `breakers at ${percent(book.breakers.no_new_buys_at)} and ${percent(book.breakers.halve_exposure_at)}`
  return `${percent(drawdown)}<br><span class="muted">${tripped.length ? `tripped: ${tripped.join(', ')}` : breakers}</span>`
}

/** How each paper Book stands against its rules-only paper Book, its Sleeves, its riskiest stops, and the Books together in rupees. */
function paperBooksSection(run: RunRecord, standing: PdPaperBooks | null): string {
  const step = run.steps.find((s) => s.name === 'check')
  const head = '<section><h2>Paper Books</h2>'
  if (!standing) return step?.status === 'failed' ? `${head}<p>How the paper Books stand couldn't be read in this Run. See the Check Step's log: ${logLink(step.log ?? 'logs/check.log')}</p></section>` : ''
  const rows = standing.books.map((b) => [
    esc(b.name),
    standingCell(b, 'paper'),
    standingCell(b, 'rules_only'),
    b.gap === null ? '—' : `${esc(money(b.gap.value, b.currency))}<br><span class="muted">${percent(b.gap.share)}</span>`,
    drawdownCell(b),
  ])
  const details = standing.books.flatMap((b) => {
    const sleeves = b.sleeves.map((s) => `${esc(s.strategy_id)} in ${esc(s.stage_name)} since ${esc(s.since)}${s.value === null ? '' : `: ${esc(money(s.value, b.currency))}`}`)
    if (b.gold !== null) sleeves.push(`gold: ${esc(money(b.gold, b.currency))}`)
    const risky = b.stops_at_risk.map((r) => `${esc(r.name ?? r.security_id)} (${esc(r.security_id)}): ${esc(shares(r.qty))} shares at ${esc(money(r.close, b.currency, 2))}, its stop at ${esc(money(r.stop, b.currency, 2))}, would lose ${esc(money(r.loss, b.currency))}, ${percent(r.share)} of the Book`)
    return [
      `<h3>${esc(b.name)}'s paper Book</h3>`,
      sleeves.length ? `<p>Its Sleeves: ${sleeves.join('; ')}.</p>` : '<p>No Sleeve yet.</p>',
      b.paper.lists_waiting.length ? `<p>${plural(b.paper.orders_waiting, 'order')} of its Order list for ${esc(b.paper.lists_waiting.join(', '))} wait to be filled.</p>` : '',
      ...(risky.length ? [`<p>Disaster stops that would lose more than ${percent(b.risk_per_trade)} of the Book:</p>`, list(risky)] : []),
    ]
  })
  const combined = standing.combined
  const rates = Object.entries(combined.rates)
    .filter(([currency]) => currency !== combined.currency)
    .map(([currency, rate]) => `${esc(currency)} at ${esc(money(rate, combined.currency, 2))}`)
  const missing = combined.missing.length ? ` The ${esc(combined.missing.join(' and '))} ${combined.missing.length === 1 ? "Book's currency has" : "Books' currencies have"} no exchange rate in the Lake, so ${combined.missing.length === 1 ? 'it is' : 'they are'} left out.` : ''
  return [
    head,
    table(['Book', 'Paper Book', 'Rules-only paper Book', 'Gap', 'Drawdown'], rows),
    `<p>The paper Books together: ${esc(money(combined.value, combined.currency))}${rates.length ? `, at ${rates.join(' and ')}` : ''}.${missing}</p>`,
    ...details,
    '</section>',
  ]
    .filter(Boolean)
    .join('\n')
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

/** What the Brief is written from: the Run, and what each earlier Step wrote (null: nothing). */
interface Inputs {
  run: RunRecord
  answers: AnswersResult | null
  inbox: BrokerInboxResult | null
  marketSmith: PdMarketSmith | null
  lake: LakeResult | null
  /** The Lake's status as the Lake Step read it. */
  status: PdStatus | null
  /** The Lake's status as the Health Step read it again once it recorded the Health Agent's Corrections, so they are among those waiting. */
  latest: PdStatus | null
  stages: PdStagesCheck | null
  health: HealthResult | null
  plan: PdPlan | null
  states: BookStates | null
  pm: PortfolioManagerResult | null
  check: CheckResult | null
  paperBooks: PdPaperBooks | null
  /** Each Book's Judgement modes and Playbook, and the proposals waiting, as the Check Step read them. */
  modes: PdJudgementShow | null
  /** On Saturdays, the weekly review's figures. */
  review: PdReview | null
  /** The promotions Save state recorded in this Run. */
  promotions: PromotionsResult | null
  todos: { step: string; todo: string }[]
}

function render({ run, answers, inbox, marketSmith, lake, status, latest, stages, health, plan, states, pm, check, paperBooks, modes, review, promotions, todos }: Inputs): string {
  const lakeLog = run.steps.find((s) => s.name === 'lake')?.log ?? 'logs/lake.log'
  const waiting = latest ?? status
  const promoting = waitingPromotions(stages, promotions)
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
${promotionsSection(promoting, stages)}
${proposalsSection(modes)}
${marketsSection(status)}
${todosSection(todos)}
${stagesSection(run, stages)}
${reviewSection(run, review, pm)}
${monthlySection(review, pm)}
${booksSection(run, inbox)}
${plansSection(run, plan, states)}
${judgementSection(run, pm, check, modes)}
${checkSection(run, check)}
${paperBooksSection(run, paperBooks)}
${marketSmithSection(marketSmith)}
${lakeSection(lake, status)}
${healthSection(status)}
${runHealthSection(run)}
${saveAnswers(run.id, waitingItems(waiting, stages, modes, promoting))}
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
  writeText(
    out,
    render({
      run: readRun(runId),
      answers: read<AnswersResult>('answers.json'),
      inbox: read<BrokerInboxResult>('broker-inbox.json'),
      marketSmith: read<PdMarketSmith>('marketsmith.json'),
      lake: read<LakeResult>('lake.json'),
      status: read<PdStatus>(join('lake', 'status.json')),
      latest: read<PdStatus>(join('health', 'status.json')),
      stages: read<PdStagesCheck>('stages.json'),
      health: read<HealthResult>('health.json'),
      plan: read<PdPlan>('plan.json'),
      states: read<BookStates>('book-states.json'),
      pm: read<PortfolioManagerResult>('portfolio-manager.json'),
      check: read<CheckResult>('check.json'),
      paperBooks: read<PdPaperBooks>('paper-books.json'),
      modes: read<PdJudgementShow>('judgement-show.json'),
      review: read<PdReview>('review.json'),
      promotions: read<PromotionsResult>('promotions.json'),
      todos: readTodos(runFolder),
    }),
  )
  console.log(`Wrote ${out}`)
})
