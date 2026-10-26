// What the daily and weekly Briefs share between their Markdown and their HTML: what the Brief
// Step read from the Run folder, the at-a-glance summary at the top of both, the links to a Repo's
// commits and files on GitHub, and the HTML page itself, one self-contained file that loads nothing
// from the internet, where each part opens with a tap.
import { relative, sep } from 'node:path'
import { mainLine } from '../agents/docs/config.ts'
import { severities, type Severity } from '../agents/reviewer/config.ts'
import type { DiscordMessage, DiscordRead } from '../steps/discord.ts'
import type { DocsResult } from '../steps/docs.ts'
import type { Commit, FetchResult } from '../steps/fetch.ts'
import type { PmResult } from '../steps/pm.ts'
import type { Finding, ReviewResult } from '../steps/review.ts'
import type { MemoryProposal } from './memory.ts'
import { apkInboxDir, otherFilesDir } from './paths.ts'
import { coversItsRuns } from './pm-inputs.ts'
import { teams } from './repos.ts'
import { stepsNotSucceeded, type RunRecord } from './run.ts'

/** Everything the Brief is written from. */
export interface BriefInputs {
  run: RunRecord
  runFolder: string
  results: FetchResult[]
  /** The reviews of the commits in `results`, by Repo. */
  reviews: Map<string, ReviewResult>
  pm: PmResult | null
  discord: DiscordRead | null
  docs: DocsResult | null
  proposals: MemoryProposal[]
  /** Each Repo's page on GitHub, by name, for the Repos whose remote is on GitHub. */
  webUrls: Map<string, string>
}

export const short = (sha: string) => sha.slice(0, 7)
export const firstLine = (text: string) => text.split('\n')[0]
export const plural = (n: number, one: string) => `${n} ${one}${n === 1 ? '' : 's'}`

/** Saransh's own findings first, then the worst first. */
export const byPriority = (a: Finding, b: Finding) => Number(b.bySaransh) - Number(a.bySaransh) || severities.indexOf(a.severity) - severities.indexOf(b.severity)

/** A Repo's page on GitHub from its remote, over HTTPS or SSH; null for a remote elsewhere. */
export function webUrl(remote: string): string | null {
  const match = /^(?:https:\/\/github\.com\/|git@github\.com:)([^/]+\/[^/]+?)(?:\.git)?\/?$/.exec(remote)
  return match ? `https://github.com/${match[1]}` : null
}

/** Where a Repo's commit, file and range are on GitHub, or null each when it isn't there. */
export function repoLinks(inputs: BriefInputs, repo: string) {
  const web = inputs.webUrls.get(repo)
  return {
    commit: (sha: string) => (web ? `${web}/commit/${sha}` : null),
    file: (at: string, file: string, line: number | null) => (web ? `${web}/blob/${at}/${file}${line === null ? '' : `#L${line}`}` : null),
    compare: (from: string, to: string) => (web ? `${web}/compare/${from}...${to}` : null),
  }
}

/** The messages that mention Saransh or were sent in a DM with the bot. */
export const forSaransh = (discord: DiscordRead) => discord.messages.filter((m) => m.mentionsSaransh || m.dm)
/** Where a message was posted, as the Brief names it. */
export const whereFrom = (m: DiscordMessage) => (m.dm ? `DM with ${m.channel}` : `#${m.channel}${m.thread ? ` › ${m.thread}` : ''}`)

/** Each file of one kind attached to the messages read, with the message it came from. A discord.json from before APKs and other files were saved has none. */
export function attachedFiles(discord: DiscordRead | null, kind: 'apkFiles' | 'otherFiles'): { file: string; message: DiscordMessage }[] {
  return (discord?.messages ?? []).flatMap((message) => (message[kind] ?? []).map((file) => ({ file, message })))
}

/** The Repos with new commits, and the reviews among them. */
function reviewCounts(inputs: BriefInputs) {
  const changed = inputs.results.filter((r) => r.status === 'new-commits')
  const reviews = changed.flatMap((r) => (inputs.reviews.has(r.repo) ? [inputs.reviews.get(r.repo)!] : []))
  const findings = reviews.flatMap((r) => (r.status === 'reviewed' ? r.findings : []))
  return { changed, reviewed: reviews.filter((r) => r.status === 'reviewed').length, failed: reviews.filter((r) => r.status === 'failed').length, findings }
}

const severityCounts = (findings: Finding[]) =>
  severities.flatMap((s) => {
    const n = findings.filter((f) => f.severity === s).length
    return n ? [`${n} ${s}`] : []
  })

export type Tone = 'ok' | 'warn' | 'bad' | 'quiet'

/** One line of the at-a-glance summary, and the part of the Brief it points to. */
export interface GlanceItem {
  id: string
  label: string
  value: string
  note: string
  tone: Tone
}

/** The at-a-glance summary at the top of the Brief: what waits on Saransh, then what happened. */
export function glance(inputs: BriefInputs): GlanceItem[] {
  const { pm, discord, docs, proposals, run } = inputs
  const items: GlanceItem[] = []

  if (pm?.status === 'answered') {
    const n = pm.todos.length
    items.push({ id: 'todos', label: 'To-dos', value: String(n), note: n ? 'waiting on you' : 'nothing is waiting on you', tone: n ? 'warn' : 'ok' })
  } else items.push({ id: 'todos', label: 'To-dos', value: '—', note: 'the PM output is missing', tone: 'bad' })

  if (discord) {
    const n = forSaransh(discord).length
    items.push({ id: 'mentions', label: 'Mentions and DMs', value: String(n), note: `of ${plural(discord.messages.length, 'Discord message')} read`, tone: n ? 'warn' : 'quiet' })
    const apks = attachedFiles(discord, 'apkFiles').length
    if (apks) items.push({ id: 'apks', label: 'APKs to test', value: String(apks), note: run.dryRun ? 'not saved in a dry run' : 'saved in the APK inbox', tone: 'warn' })
  } else items.push({ id: 'mentions', label: 'Mentions and DMs', value: '—', note: 'no Discord messages were read', tone: 'quiet' })

  const { changed, reviewed, failed, findings } = reviewCounts(inputs)
  const reviewNote = [`${reviewed} reviewed`, ...(failed ? [`${failed} failed`] : []), ...(changed.length - reviewed - failed > 0 ? [`${changed.length - reviewed - failed} not reviewed`] : [])]
  items.push({ id: 'code-review', label: 'Repos with new commits', value: String(changed.length), note: changed.length ? reviewNote.join(', ') : 'no new commits', tone: failed ? 'bad' : 'quiet' })
  if (reviewed) {
    const yours = findings.filter((f) => f.bySaransh).length
    const worst = findings.some((f) => f.severity === 'critical' || f.severity === 'high')
    const note = findings.length ? [severityCounts(findings).join(', '), ...(yours ? [`${yours} on your commits`] : [])].join('; ') : 'nothing found'
    items.push({ id: 'code-review', label: 'Findings', value: String(findings.length), note, tone: worst ? 'bad' : findings.length ? 'warn' : 'ok' })
  }

  if (docs?.waiting) items.push({ id: 'docs', label: 'Wiki pages to review', value: String(docs.waiting.pages.length), note: `on ${docs.branch}`, tone: 'warn' })
  if (proposals.length) items.push({ id: 'memory', label: 'Memory changes', value: String(proposals.length), note: 'waiting for you', tone: 'warn' })

  const notSucceeded = stepsNotSucceeded(run.steps).filter((s) => s.name !== 'brief')
  items.push(
    notSucceeded.length
      ? { id: 'run-health', label: 'Run health', value: String(notSucceeded.length), note: notSucceeded.map((s) => `${s.name} ${s.status}`).join(', '), tone: notSucceeded.some((s) => s.status === 'failed') ? 'bad' : 'warn' }
      : { id: 'run-health', label: 'Run health', value: 'OK', note: 'no Step failed or was skipped', tone: 'ok' },
  )
  return items
}

/** Escapes text for HTML, so nothing from a commit, a review or Discord is read as markup. */
const esc = (text: string) => text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#39;')
const link = (href: string | null, text: string) => (href ? `<a href="${esc(href)}">${text}</a>` : text)
const list = (items: string[], className = '') => `<ul${className ? ` class="${className}"` : ''}>\n${items.map((item) => `<li>${item}</li>`).join('\n')}\n</ul>`
const code = (text: string) => `<code>${esc(text)}</code>`
/**
 * An Agent's line of Markdown as HTML: its links, code and bold kept, everything else escaped. A
 * link opens only over http or https, so a line can't smuggle in a script.
 */
export function inline(text: string): string {
  return esc(text)
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2">$1</a>')
}
/** A folder of the data area as a link from the Run folder, which works wherever the data area is. */
const folderLink = (runFolder: string, folder: string) => relative(runFolder, folder).split(sep).join('/')

/** A part of the Brief that opens with a tap, with its count in the heading. */
function part(id: string, title: string, body: string, { count, open = false }: { count?: number; open?: boolean } = {}): string {
  const badge = count === undefined ? '' : ` <span class="count">${count}</span>`
  return `<section id="${id}"><details${open ? ' open' : ''}><summary><h2>${esc(title)}${badge}</h2></summary>\n<div class="body">\n${body}\n</div></details></section>`
}

function glanceHtml(items: GlanceItem[]): string {
  const cards = items.map(
    (item) => `<a class="card ${item.tone}" href="#${item.id}"><span class="value">${esc(item.value)}</span><span class="label">${esc(item.label)}</span><span class="note">${esc(item.note)}</span></a>`,
  )
  return `<nav class="glance" aria-label="At a glance">\n${cards.join('\n')}\n</nav>`
}

function todosHtml({ pm }: BriefInputs): string {
  if (pm?.status !== 'answered') {
    const why = pm?.status === 'failed' ? ` The PM Agent failed: ${esc(firstLine(pm.error))}` : ''
    return part('todos', 'To-dos', `<p class="note">The PM output is missing, so this Brief has no To-dos, Discord highlights or line per Repo.${why}</p>`, { open: true })
  }
  const stale = coversItsRuns(pm)
    ? ''
    : '<p class="note warn">The PM output is out of date: an earlier Step was re-run after the PM Agent answered. Re-run the pm Step with --force to bring it up to date.</p>\n'
  const body = pm.todos.length ? list(pm.todos.map(inline), 'todos') : '<p class="muted">Nothing is waiting on you.</p>'
  return part('todos', 'To-dos', stale + body, { count: pm.todos.length, open: true })
}

function discordHtml({ pm, discord }: BriefInputs): string {
  const parts: string[] = []
  if (pm?.status === 'answered') {
    const body = pm.highlights.length ? list(pm.highlights.map(inline)) : `<p class="muted">${discord ? 'Nothing on Discord stood out.' : 'No Discord messages were read in this Run.'}</p>`
    parts.push(part('highlights', 'Discord highlights', body, { count: pm.highlights.length, open: pm.highlights.length > 0 }))
  }
  if (!discord) return parts.join('\n')
  const mine = forSaransh(discord)
  const message = (m: DiscordMessage) => {
    const more = m.content.includes('\n') || m.content.length > 160 ? `<details class="more"><summary>Whole message</summary><p class="message">${esc(m.content)}</p></details>` : ''
    return `<div class="from">${link(m.link, esc(whereFrom(m)))} <span class="muted">${esc(m.author)} · ${esc(m.timestamp.slice(0, 16).replace('T', ' '))} UTC</span></div><div>${esc(firstLine(m.content))}</div>${more}`
  }
  const body = mine.length ? list(mine.map(message), 'messages') : `<p class="muted">None of the ${discord.messages.length} messages read mention you, and none came in a DM.</p>`
  parts.push(part('mentions', 'Mentions of you and DMs on Discord', body, { count: mine.length, open: mine.length > 0 }))
  return parts.join('\n')
}

function filesHtml({ discord, run, runFolder }: BriefInputs): string {
  const parts: string[] = []
  const kinds = [
    { kind: 'apkFiles', id: 'apks', title: 'APKs to test', folder: apkInboxDir(), where: 'the APK inbox' },
    { kind: 'otherFiles', id: 'other-files', title: 'Other files from Discord', folder: otherFilesDir(), where: 'the other folder' },
  ] as const
  for (const { kind, id, title, folder, where } of kinds) {
    const files = attachedFiles(discord, kind)
    if (!files.length) continue
    const saved = run.dryRun ? '<p class="note">A dry run saves nothing, so these were not downloaded.</p>' : `<p>Saved in ${link(folderLink(runFolder, folder), esc(where))}, ${code(folder)}.</p>`
    const items = files.map(({ file, message }) => `${code(file)} <span class="muted">from ${esc(message.author)} in</span> ${link(message.link, esc(whereFrom(message)))}`)
    parts.push(part(id, title, `${saved}\n${list(items)}`, { count: files.length, open: kind === 'apkFiles' }))
  }
  return parts.join('\n')
}

function severityBadges(findings: Finding[]): string {
  return severities
    .flatMap((s) => {
      const n = findings.filter((f) => f.severity === s).length
      return n ? [`<span class="sev ${s}">${n} ${s}</span>`] : []
    })
    .join('')
}

/** A tab strip: each tab's panel shows when its tab is chosen, the first to start, with no script. */
function tabs(name: string, panels: { title: string; body: string }[]): string {
  const inputs = panels.map((p, i) => `<input type="radio" name="${name}" id="${name}-${i}"${i === 0 ? ' checked' : ''}><label for="${name}-${i}">${p.title}</label>`)
  const bodies = panels.map((p, i) => `<div class="panel p${i}">\n${p.body}\n</div>`)
  return `<div class="tabs">\n${inputs.join('\n')}\n${bodies.join('\n')}\n</div>`
}

function repoHtml(inputs: BriefInputs, r: Exclude<FetchResult, { status: 'failed' }>, line: string | undefined): string {
  const review = inputs.reviews.get(r.repo)
  const links = repoLinks(inputs, r.repo)
  const findings = review?.status === 'reviewed' ? review.findings.toSorted(byPriority) : []
  const yours = findings.filter((f) => f.bySaransh).length
  const status = !review ? '<span class="chip">not reviewed</span>' : review.status === 'failed' ? '<span class="chip bad">review failed</span>' : findings.length ? '' : '<span class="chip ok">no findings</span>'
  const summary = `<summary><span class="name">${esc(r.repo)}</span> <span class="muted">${plural(r.commits.length, 'commit')}</span> ${severityBadges(findings)}${yours ? `<span class="chip yours">${yours} yours</span>` : ''}${status}</summary>`

  const authors = [...new Set(r.commits.map((c) => c.author))]
  const facts = [
    ['Branch', code(r.branch)],
    ['Range', `${link(links.compare(r.previous!, r.head), `${code(short(r.previous!))} … ${code(short(r.head))}`)}`],
    ['Authors', esc(authors.join(', '))],
    ['Findings', findings.length ? severityCounts(findings).join(', ') : review?.status === 'reviewed' ? 'None' : '—'],
  ]
  const reviewSummary = !review
    ? '<p class="muted">No review of these commits in this Run.</p>'
    : review.status === 'failed'
      ? `<p class="note bad">Review failed: ${esc(firstLine(review.error))}</p>`
      : `<p><strong>Review:</strong> ${esc(review.summary)}</p>`
  const overview = [
    ...(line ? [`<p class="line">${inline(line)}</p>`] : []),
    reviewSummary,
    `<dl class="facts">${facts.map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join('')}</dl>`,
    ...(inputs.webUrls.has(r.repo) ? [`<p>${link(inputs.webUrls.get(r.repo)!, 'Open on GitHub')}</p>`] : []),
  ].join('\n')

  const commit = (c: Commit) =>
    `${link(links.commit(c.sha), code(short(c.sha)))} ${esc(c.subject)} <span class="muted">${esc(c.author)} · ${esc(c.date.slice(0, 16).replace('T', ' '))}</span>`
  const finding = (f: Finding) => {
    const where = f.line === null ? f.file : `${f.file}:${f.line}`
    return `<div class="finding ${f.severity}"><div><span class="sev ${f.severity}">${f.severity}</span>${f.bySaransh ? '<span class="chip yours">yours</span>' : ''} ${link(links.file(r.head, f.file, f.line), code(where))}</div><div>${esc(f.summary)}</div><div class="muted">in ${link(links.commit(f.commit), code(short(f.commit)))} by ${esc(f.author)}</div></div>`
  }
  const reviewPanel = !review || review.status === 'failed' ? reviewSummary : findings.length ? findings.map(finding).join('\n') : '<p class="muted">No findings.</p>'

  return `<details class="repo">${summary}\n${tabs(`repo-${r.repo.replace(/[^\w-]/g, '-')}`, [
    { title: 'Overview', body: overview },
    { title: `Commits <span class="count">${r.commits.length}</span>`, body: list(r.commits.map(commit), 'commits') },
    { title: `Review <span class="count">${findings.length}</span>`, body: reviewPanel },
  ])}\n</details>`
}

function codeReviewHtml(inputs: BriefInputs): string {
  const { results, pm } = inputs
  const repoLines = new Map(pm?.status === 'answered' ? pm.repoLines.map((r) => [r.repo, r.line]) : [])
  const groups: string[] = []
  for (const team of teams) {
    const ofTeam = results.filter((r) => r.team === team)
    const changed = ofTeam.flatMap((r) => (r.status === 'new-commits' ? [r] : []))
    const baselines = ofTeam.flatMap((r) => (r.status === 'baseline' ? [r] : []))
    const unchanged = ofTeam.filter((r) => r.status === 'unchanged').map((r) => r.repo)
    if (!changed.length && !baselines.length && !unchanged.length) continue
    const parts = [`<h3>${esc(team)}</h3>`, ...changed.map((r) => repoHtml(inputs, r, repoLines.get(r.repo)))]
    for (const r of baselines) parts.push(`<p class="muted">${esc(r.repo)}: baseline recorded at ${code(short(r.head))} on ${esc(r.branch)}. New commits are listed from the next Run.</p>`)
    if (unchanged.length) parts.push(`<p class="muted">Unchanged: ${esc(unchanged.join(', '))}</p>`)
    groups.push(parts.join('\n'))
  }
  const body = results.length ? groups.join('\n') : '<p class="muted">No Repo was fetched in this Run.</p>'
  return part('code-review', 'Code review', body, { count: reviewCounts(inputs).changed.length, open: true })
}

function docsHtml({ docs }: BriefInputs): string {
  if (!docs) return ''
  const parts: string[] = []
  const prds = docs.prds ?? []
  const stopped = !['updated', 'no-edits', 'nothing-to-update'].includes(docs.status)
  if (docs.waiting || stopped || prds.length) {
    const lines: string[] = []
    if (docs.waiting) {
      lines.push(`<p>${code(docs.branch)} has ${plural(docs.waiting.commits, 'commit')} not on ${esc(mainLine)}, changing these pages, each a draft:</p>`, list(docs.waiting.pages.map(code)))
    } else lines.push(`<p class="muted">Nothing on ${code(docs.branch)} is waiting for you.</p>`)
    const notCommitted = "This Run's wiki edits weren't committed, since"
    switch (docs.status) {
      case 'updated':
        if (docs.pages.length) lines.push('<p>This Run updated:</p>', list(docs.pages.map((p) => `${code(p.page)}: ${esc(p.summary)}`)))
        if (prds.length) lines.push('<p>This Run wrote PRD pages from the PRD inbox, and moved their files to done/ there:</p>', list(prds.map((p) => `${code(p.page)}, from ${code(p.file)}: ${esc(p.summary)}`)))
        break
      case 'conflict':
        lines.push(`<p class="note bad">This Run left it as it was: merging ${esc(mainLine)} into it conflicts in ${esc(docs.files.join(', '))}. Merge ${esc(mainLine)} into ${esc(docs.branch)} yourself, then re-run the docs Step.</p>`)
        break
      case 'check-failed':
        lines.push(`<p class="note bad">${notCommitted} the wiki's check still reports errors:</p>`, `<pre>${esc(docs.check)}</pre>`)
        break
      case 'tool-failed':
        lines.push(`<p class="note bad">${notCommitted} the wiki's ${esc(docs.tool)} tool failed:</p>`, `<pre>${esc(docs.output)}</pre>`)
        break
      case 'rejected':
        lines.push(`<p class="note bad">${notCommitted} the Docs Agent changed ${esc(docs.files.join(', '))}, and it may only update pages and add PRD pages with copies of PRD inbox files.</p>`)
        break
      case 'failed':
        lines.push(`<p class="note bad">This Run's Docs Step failed, so it changed nothing on the wiki: ${esc(firstLine(docs.error))}. The next Run tries the same work again.</p>`)
        break
    }
    if (docs.waiting) lines.push(`<p>Review it with ${code(`git diff ${mainLine}...${docs.branch}`)} in the wiki, and merge it into ${esc(mainLine)} when you accept it.</p>`)
    parts.push(part('docs', 'Docs branch waiting for review', lines.join('\n'), { count: docs.waiting?.pages.length, open: !!docs.waiting || stopped }))
  }
  if (docs.skipped?.length) {
    const body = `<p>The Docs Agent didn't turn these into PRD pages, so they were moved to skipped/ in the PRD inbox. Move one back into the inbox for the next Run to try it again.</p>\n${list(docs.skipped.map((s) => `${code(s.file)}: ${esc(s.reason)}`))}`
    parts.push(part('prds-set-aside', 'PRD inbox files set aside', body, { count: docs.skipped.length }))
  }
  if (docs.undocumented.length) {
    const body = `<p>The wiki has no pages of these Repos, and the Docs Agent never writes a Repo's first pages. Document one with the wiki's code-to-wiki skill when you choose.</p>\n${list(docs.undocumented.map((r) => `${esc(r.repo)} <span class="muted">(${esc(r.team)})</span>: ${plural(r.commits, 'new commit')}`))}`
    parts.push(part('undocumented', 'Undocumented Repos with new commits', body, { count: docs.undocumented.length }))
  }
  return parts.join('\n')
}

function memoryHtml({ proposals }: BriefInputs): string {
  if (!proposals.length) return ''
  const body = `${list(proposals.map((p) => `${esc(p.agent)} ${esc(p.name)}, proposed in Run ${esc(p.run)}`))}\n<p>Review them with ${code('agents memory')}.</p>`
  return part('memory', 'Memory changes waiting for you', body, { count: proposals.length, open: true })
}

function runHealthHtml(inputs: BriefInputs): string {
  const { run, results, reviews } = inputs
  const notSucceeded = stepsNotSucceeded(run.steps).filter((s) => s.name !== 'brief')
  const reviewed = [...reviews.values()].filter((r) => r.status === 'reviewed').length
  const lines = [`<p>Run ${esc(run.id)} of the ${esc(run.pipeline)} Pipeline. Repos reviewed: ${reviewed}.</p>`]
  lines.push(notSucceeded.length ? list(notSucceeded.map((s) => `${esc(s.name)}: ${esc(s.status)}. Log: ${link(s.log, esc(s.log))}`)) : '<p class="muted">No Step failed or was skipped.</p>')
  const failed = (heading: string, of: (FetchResult | ReviewResult)[]) => {
    const failures = of.flatMap((r) => (r.status === 'failed' ? [r] : []))
    return failures.length ? [`<p>${heading}</p>`, list(failures.map((r) => `${esc(r.repo)} <span class="muted">(${esc(r.team)})</span>: ${esc(firstLine(r.error))}`))] : []
  }
  lines.push(...failed('Repos that failed to fetch:', results), ...failed('Repos whose review failed:', [...reviews.values()]))
  const problems = notSucceeded.length > 0 || lines.length > 2
  return part('run-health', 'Run health', lines.join('\n'), { open: problems })
}

const style = `
:root { --bg: #fbfbfa; --fg: #1d1d1b; --muted: #6b6b66; --line: #e2e1dc; --panel: #f3f2ee; --card: #ffffff; --accent: #2f5bd3;
  --ok: #1f7a3d; --warn: #9a5b00; --bad: #b3261e; --critical: #b3261e; --high: #c2410c; --medium: #9a6700; --low: #6b6b66; --yours: #6d28d9; }
@media (prefers-color-scheme: dark) { :root { --bg: #161615; --fg: #ecebe6; --muted: #a09f99; --line: #34342f; --panel: #1f1f1d; --card: #232321; --accent: #8fb0ff;
  --ok: #5cc783; --warn: #f0b44c; --bad: #ff8a80; --critical: #ff8a80; --high: #ffa86b; --medium: #f0c94c; --low: #a09f99; --yours: #c4a5ff; } }
* { box-sizing: border-box; }
body { background: var(--bg); color: var(--fg); font: 15px/1.55 system-ui, -apple-system, sans-serif; max-width: 56rem; margin: 0 auto; padding: 1.5rem 16px 4rem; overflow-wrap: anywhere; }
header h1 { font-size: 1.6rem; margin: 0; }
header p { margin: 0.15rem 0 1.25rem; }
a { color: var(--accent); text-decoration: none; } a:hover { text-decoration: underline; }
code, pre { font: 0.85em/1.4 ui-monospace, SFMono-Regular, Menlo, monospace; }
pre { background: var(--panel); padding: 0.75rem; border-radius: 6px; overflow-x: auto; white-space: pre-wrap; }
.muted { color: var(--muted); }
.note { color: var(--muted); } .note.warn { color: var(--warn); } .note.bad { color: var(--bad); }
.glance { display: grid; grid-template-columns: repeat(auto-fill, minmax(9.5rem, 1fr)); gap: 0.6rem; margin-bottom: 1.5rem; }
.card { display: flex; flex-direction: column; background: var(--card); border: 1px solid var(--line); border-top: 3px solid var(--line); border-radius: 8px; padding: 0.6rem 0.75rem; color: var(--fg); }
.card:hover { text-decoration: none; border-color: var(--accent); }
.card .value { font-size: 1.5rem; font-weight: 650; line-height: 1.2; font-variant-numeric: tabular-nums; }
.card .label { font-weight: 600; font-size: 0.9rem; }
.card .note { font-size: 0.8rem; }
.card.ok { border-top-color: var(--ok); } .card.warn { border-top-color: var(--warn); } .card.bad { border-top-color: var(--bad); }
.card.bad .value { color: var(--bad); }
section { border-top: 1px solid var(--line); }
section > details > summary { list-style: none; cursor: pointer; padding: 0.7rem 0; display: flex; align-items: center; gap: 0.5rem; }
section > details > summary::-webkit-details-marker { display: none; }
section > details > summary::before { content: '▸'; color: var(--muted); transition: transform 0.15s; }
section > details[open] > summary::before { transform: rotate(90deg); }
section h2 { font-size: 1.1rem; margin: 0; display: inline; }
.body { padding: 0 0 1rem 1.1rem; }
.count { display: inline-block; min-width: 1.5em; padding: 0 0.4em; border-radius: 999px; background: var(--panel); color: var(--muted); font-size: 0.8rem; font-weight: 600; text-align: center; }
ul { padding-left: 1.2rem; margin: 0.4rem 0; } li { margin: 0.3rem 0; }
ul.todos li::marker { color: var(--warn); }
ul.messages { list-style: none; padding: 0; } ul.messages > li { border-left: 3px solid var(--line); padding-left: 0.75rem; margin: 0.6rem 0; }
.more summary { cursor: pointer; color: var(--muted); font-size: 0.85rem; }
.message { white-space: pre-wrap; margin: 0.3rem 0; }
h3 { font-size: 0.8rem; text-transform: uppercase; letter-spacing: 0.06em; color: var(--muted); margin: 1rem 0 0.4rem; }
details.repo { background: var(--card); border: 1px solid var(--line); border-radius: 8px; margin: 0.5rem 0; }
details.repo > summary { cursor: pointer; padding: 0.6rem 0.75rem; display: flex; flex-wrap: wrap; align-items: center; gap: 0.4rem; }
details.repo > summary .name { font-weight: 600; }
details.repo[open] > summary { border-bottom: 1px solid var(--line); }
.sev, .chip { display: inline-block; font-size: 0.75rem; font-weight: 600; padding: 0.05rem 0.45rem; border-radius: 999px; border: 1px solid currentColor; }
.sev.critical { color: var(--critical); } .sev.high { color: var(--high); } .sev.medium { color: var(--medium); } .sev.low { color: var(--low); }
.chip { color: var(--muted); } .chip.ok { color: var(--ok); } .chip.bad { color: var(--bad); } .chip.yours { color: var(--yours); margin-left: 0.3rem; }
.tabs { display: flex; flex-wrap: wrap; padding: 0 0.75rem 0.75rem; }
.tabs input { position: absolute; opacity: 0; pointer-events: none; }
.tabs label { cursor: pointer; padding: 0.55rem 0.75rem; border-bottom: 2px solid transparent; color: var(--muted); font-weight: 600; font-size: 0.9rem; }
.tabs input:checked + label { color: var(--fg); border-bottom-color: var(--accent); }
.tabs input:focus-visible + label { outline: 2px solid var(--accent); outline-offset: -2px; }
.panel { display: none; width: 100%; border-top: 1px solid var(--line); padding-top: 0.5rem; }
.tabs input:nth-of-type(1):checked ~ .p0, .tabs input:nth-of-type(2):checked ~ .p1, .tabs input:nth-of-type(3):checked ~ .p2 { display: block; }
.line { font-size: 1rem; }
dl.facts { display: grid; grid-template-columns: max-content 1fr; gap: 0.25rem 1rem; margin: 0.5rem 0; }
dl.facts dt { color: var(--muted); } dl.facts dd { margin: 0; }
ul.commits { list-style: none; padding: 0; } ul.commits li { padding: 0.3rem 0; border-bottom: 1px solid var(--line); }
.finding { border-left: 3px solid var(--line); padding: 0.4rem 0 0.4rem 0.75rem; margin: 0.5rem 0; }
.finding.critical { border-left-color: var(--critical); } .finding.high { border-left-color: var(--high); } .finding.medium { border-left-color: var(--medium); }
footer { margin-top: 2rem; font-size: 0.85rem; }
`

/** The Brief as one HTML page. */
export function renderHtml(inputs: BriefInputs): string {
  const { run } = inputs
  const dryRun = run.dryRun ? '<p class="note warn">Dry run: every Agent ran on the fake Worker, so no review in this Brief is real, and none counts as done.</p>\n' : ''
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Brief ${esc(run.id)}</title>
<style>${style}</style>
</head>
<body>
<header><h1>Brief</h1><p class="muted">Run ${esc(run.id)} of the ${esc(run.pipeline)} Pipeline</p></header>
${dryRun}${glanceHtml(glance(inputs))}
${todosHtml(inputs)}
${discordHtml(inputs)}
${filesHtml(inputs)}
${codeReviewHtml(inputs)}
${docsHtml(inputs)}
${memoryHtml(inputs)}
${runHealthHtml(inputs)}
<footer class="muted">The same Brief in Markdown is <a href="brief.md">brief.md</a>, beside this page.</footer>
</body>
</html>
`
}
