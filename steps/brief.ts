// Brief: renders the day's Brief in the Run folder, as Markdown and as an HTML page where each part
// opens with a tap, from what earlier Steps wrote there. Both open with a summary at a glance, then
// give the details: the PM Agent's To-dos and Discord highlights, the Discord messages that mention
// Saransh and the DMs with the bot, the APKs and other files saved from Discord, then the code review
// by Team, each Repo's line from the PM Agent, its new commits and review, then the docs branch's
// pages waiting for review, the PRD inbox files set aside and the undocumented Repos with new
// commits, then the Memory changes waiting for Saransh and the Run's health with the number of Repos
// reviewed.
// It runs even when earlier Steps failed, and says when the PM output is missing, or out of date
// since an earlier Step was re-run after the PM answered.
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { assigneesOf, attachedFiles, byPriority, byStatus, statusLabel, taskReportOf, firstLine, forSaransh, glance, renderHtml, repoLinks, short, webUrl, whereFrom, type BriefInputs } from '../src/brief.ts'
import { readJson, readJsonFiles, writeText } from '../src/files.ts'
import { pendingProposals, type MemoryProposal } from '../src/memory.ts'
import { apkInboxDir, otherFilesDir } from '../src/paths.ts'
import { coversItsRuns } from '../src/pm-inputs.ts'
import { loadRepos, teams } from '../src/repos.ts'
import { readRun, stepsNotSucceeded } from '../src/run.ts'
import { runAsStep } from '../src/step.ts'
import { mainLine } from '../agents/docs/config.ts'
import type { DiscordRead } from './discord.ts'
import type { DocsResult } from './docs.ts'
import type { FetchResult } from './fetch.ts'
import type { PmResult } from './pm.ts'
import type { ReviewResult } from './review.ts'

/** `text` linked to `href` in Markdown, or as it is with no link. */
const linked = (text: string, href: string | null) => (href ? `[${text}](${href})` : text)

function reviewLines(review: ReviewResult | undefined, links: ReturnType<typeof repoLinks>): string[] {
  if (!review) return ['No review of these commits in this Run.', '']
  if (review.status === 'failed') return [`Review failed: ${firstLine(review.error)}`, '']
  const lines = [`Review: ${review.summary}`, '']
  if (!review.findings.length) lines.push('No findings.')
  for (const f of review.findings.toSorted(byPriority)) {
    const where = linked(`\`${f.line === null ? f.file : `${f.file}:${f.line}`}\``, links.file(review.to, f.file, f.line))
    lines.push(`- **${f.severity}** ${where} in ${linked(`\`${short(f.commit)}\``, links.commit(f.commit))} by ${f.author}${f.bySaransh ? ' (yours)' : ''}: ${f.summary}`)
  }
  lines.push('')
  return lines
}

/** Under `heading`, each Repo whose result failed, with the first line of its error. */
function failureLines(heading: string, results: (FetchResult | ReviewResult)[]): string[] {
  const failed = results.flatMap((r) => (r.status === 'failed' ? [r] : []))
  if (!failed.length) return []
  return ['', heading, '', ...failed.map((r) => `- ${r.repo} (${r.team}): ${firstLine(r.error)}`)]
}

function proposalLines(proposals: MemoryProposal[]): string[] {
  if (!proposals.length) return []
  return [
    '## Memory changes waiting for you',
    '',
    ...proposals.map((p) => `- ${p.agent} ${p.name}, proposed in Run ${p.run}`),
    '',
    'Review them with `agents memory`.',
    '',
  ]
}

const noDiscord = 'No Discord messages were read in this Run.'

function pmLines(pm: PmResult | null, discord: DiscordRead | null): string[] {
  if (pm?.status !== 'answered') {
    const why = pm?.status === 'failed' ? ` The PM Agent failed: ${firstLine(pm.error)}` : ''
    return [`The PM output is missing, so this Brief has no To-dos, Discord highlights or line per Repo.${why}`, '']
  }
  const listed = (items: string[], none: string) => (items.length ? items.map((item) => `- ${item}`) : [none])
  const stale = coversItsRuns(pm)
    ? []
    : ["The PM output is out of date: an earlier Step was re-run after the PM Agent answered, so its To-dos, highlights and Repo lines may miss what changed. Re-run the pm Step with --force to bring them up to date.", '']
  return [
    ...stale,
    '## To-dos',
    '',
    ...listed(pm.todos, 'Nothing is waiting on you.'),
    '',
    '## Discord highlights',
    '',
    ...listed(pm.highlights, discord ? 'Nothing on Discord stood out.' : noDiscord),
    '',
  ]
}

/** Every message that mentions Saransh or was sent in a DM with the bot, from the Discord Step itself, so they show even without the PM output. */
function mentionLines(discord: DiscordRead | null): string[] {
  if (!discord) return []
  const forYou = forSaransh(discord)
  return [
    '## Mentions of you and DMs on Discord',
    '',
    ...(forYou.length
      ? forYou.map((m) => `- [${whereFrom(m)}](${m.link}) ${m.author}: ${firstLine(m.content)}`)
      : [`None of the ${discord.messages.length} messages read mention you, and none came in a DM.`]),
    '',
  ]
}

/** The APKs attached on Discord, waiting to be tested, and every other file attached there, each with the message it came from. */
function fileLines(discord: DiscordRead | null, dryRun: boolean): string[] {
  const lines: string[] = []
  const kinds = [
    { kind: 'apkFiles', heading: '## APKs to test', folder: apkInboxDir(), where: 'the APK inbox' },
    { kind: 'otherFiles', heading: '## Other files from Discord', folder: otherFilesDir(), where: 'the other folder' },
  ] as const
  for (const { kind, heading, folder, where } of kinds) {
    const files = attachedFiles(discord, kind)
    if (!files.length) continue
    lines.push(heading, '', dryRun ? 'A dry run saves nothing, so these were not downloaded.' : `Saved in ${where}, \`${folder}\`.`, '')
    lines.push(...files.map(({ file, message }) => `- \`${file}\` from ${message.author} in [${whereFrom(message)}](${message.link})`), '')
  }
  return lines
}

/** The docs branch's pages waiting for Saransh's review, and how this Run's Docs Step went, with the PRD pages it wrote. */
function docsLines(docs: DocsResult | null): string[] {
  const stopped = docs !== null && !['updated', 'no-edits', 'nothing-to-update'].includes(docs.status)
  // A docs.json from before the PRD inbox has no PRDs.
  const prds = docs?.prds ?? []
  if (!docs || (!docs.waiting && !stopped && !prds.length)) return []
  const lines = ['## Docs branch waiting for review', '']
  if (docs.waiting) {
    const { commits, pages } = docs.waiting
    lines.push(`\`${docs.branch}\` has ${commits === 1 ? '1 commit' : `${commits} commits`} not on ${mainLine}, changing these pages, each a draft:`, '')
    lines.push(...pages.map((page) => `- ${page}`), '')
  } else lines.push(`Nothing on \`${docs.branch}\` is waiting for you.`, '')

  const notCommitted = "This Run's wiki edits weren't committed, since"
  switch (docs.status) {
    case 'updated':
      if (docs.pages.length) lines.push('This Run updated:', '', ...docs.pages.map((p) => `- ${p.page}: ${p.summary}`), '')
      if (prds.length) {
        lines.push('This Run wrote PRD pages from the PRD inbox, and moved their files to done/ there:', '')
        lines.push(...prds.map((p) => `- ${p.page}, from ${p.file}: ${p.summary}`), '')
      }
      break
    case 'conflict':
      lines.push(
        `This Run left it as it was: merging ${mainLine} into it conflicts in ${docs.files.join(', ')}. Merge ${mainLine} into ${docs.branch} yourself, then re-run the docs Step.`,
        '',
      )
      break
    case 'check-failed':
      lines.push(`${notCommitted} the wiki's check still reports errors:`, '', '```', docs.check, '```', '')
      break
    case 'tool-failed':
      lines.push(`${notCommitted} the wiki's ${docs.tool} tool failed:`, '', '```', docs.output, '```', '')
      break
    case 'rejected':
      lines.push(`${notCommitted} the Docs Agent changed ${docs.files.join(', ')}, and it may only update pages and add PRD pages with copies of PRD inbox files.`, '')
      break
    case 'failed':
      lines.push(`This Run's Docs Step failed, so it changed nothing on the wiki: ${firstLine(docs.error)}. The next Run tries the same work again.`, '')
      break
  }
  if (docs.waiting) lines.push(`Review it with \`git diff ${mainLine}...${docs.branch}\` in the wiki, and merge it into ${mainLine} when you accept it.`, '')
  return lines
}

function skippedLines(docs: DocsResult | null): string[] {
  if (!docs?.skipped?.length) return []
  return [
    '## PRD inbox files set aside',
    '',
    "The Docs Agent didn't turn these into PRD pages, so they were moved to skipped/ in the PRD inbox. Move one back into the inbox for the next Run to try it again.",
    '',
    ...docs.skipped.map((s) => `- ${s.file}: ${s.reason}`),
    '',
  ]
}

function undocumentedLines(docs: DocsResult | null): string[] {
  if (!docs?.undocumented.length) return []
  return [
    '## Undocumented Repos with new commits',
    '',
    "The wiki has no pages of these Repos, and the Docs Agent never writes a Repo's first pages. Document one with the wiki's code-to-wiki skill when you choose.",
    '',
    ...docs.undocumented.map((r) => `- ${r.repo} (${r.team}): ${r.commits === 1 ? '1 new commit' : `${r.commits} new commits`}`),
    '',
  ]
}

/** The PM Agent's task status report on the latest sprint post, by status, what needs Saransh first. */
function sprintLines(pm: PmResult | null): string[] {
  const report = taskReportOf(pm)
  if (!report) return []
  const { post } = report
  const lines = ['## Sprint task status', '', `From ${post.author}'s [sprint post](${post.link}) in #${post.channel}, ${post.postedAt.slice(0, 10)}${post.title ? `: ${post.title}` : ''}`, '']
  if (!report.tasks.length) lines.push('The post lists no tasks.', '')
  for (const { status, tasks } of byStatus(report)) {
    lines.push(`### ${statusLabel[status]} (${tasks.length})`, '')
    for (const t of tasks) {
      const was = t.was ? ` (was ${statusLabel[t.was].toLowerCase()})` : ''
      lines.push(`- **${t.title}**${was}: ${t.note} PM ${t.pm ?? 'not named'}; ${assigneesOf(t)}.`)
      lines.push(...t.evidence.map((e) => `  - ${e}`))
    }
    lines.push('')
  }
  return lines
}

function render(inputs: BriefInputs): string {
  const { run, results, reviews, pm, discord, docs, proposals } = inputs
  const lines = [`# Brief ${run.id}`, '']
  if (run.dryRun) lines.push('Dry run: every Agent ran on the fake Worker, so no review in this Brief is real, and none counts as done.', '')
  lines.push('## At a glance', '', ...glance(inputs).map((item) => `- **${item.label}:** ${item.value}, ${item.note}`), '', '# Details', '')
  lines.push(...pmLines(pm, discord), ...mentionLines(discord), ...fileLines(discord, !!run.dryRun), ...sprintLines(pm))
  const repoLines = new Map(pm?.status === 'answered' ? pm.repoLines.map((r) => [r.repo, r.line]) : [])
  lines.push('## Code review', '')
  if (!results.length) lines.push('No Repo was fetched in this Run.', '')

  for (const team of teams) {
    const ofTeam = results.filter((r) => r.team === team)
    const changed = ofTeam.flatMap((r) => (r.status === 'new-commits' ? [r] : []))
    const baselines = ofTeam.flatMap((r) => (r.status === 'baseline' ? [r] : []))
    const unchanged = ofTeam.filter((r) => r.status === 'unchanged').map((r) => r.repo)
    if (!changed.length && !baselines.length && !unchanged.length) continue

    lines.push(`### ${team}`, '')
    for (const r of changed) {
      const count = r.commits.length === 1 ? '1 new commit' : `${r.commits.length} new commits`
      const links = repoLinks(inputs, r.repo)
      lines.push(`#### ${r.repo}`, '')
      const line = repoLines.get(r.repo)
      if (line) lines.push(line, '')
      const compare = links.compare(r.previous!, r.head)
      lines.push(`${count} on ${r.branch}${compare ? ` ([compare](${compare}))` : ''}:`, '')
      for (const c of r.commits) lines.push(`- ${linked(`\`${short(c.sha)}\``, links.commit(c.sha))} ${c.subject} (${c.author})`)
      lines.push('', ...reviewLines(reviews.get(r.repo), links))
    }
    for (const r of baselines) {
      lines.push(`#### ${r.repo}`, '', `Baseline recorded at \`${short(r.head)}\` on ${r.branch}. New commits are listed from the next Run.`, '')
    }
    if (unchanged.length) lines.push(`Unchanged: ${unchanged.join(', ')}`, '')
  }

  lines.push(...docsLines(docs), ...skippedLines(docs), ...undocumentedLines(docs), ...proposalLines(proposals))
  const reviewed = [...reviews.values()].filter((r) => r.status === 'reviewed').length
  lines.push('## Run health', '', `Run ${run.id} of the ${run.pipeline} Pipeline.`, '', `Repos reviewed: ${reviewed}.`, '')
  const notSucceeded = stepsNotSucceeded(run.steps).filter((s) => s.name !== 'brief')
  if (notSucceeded.length) for (const s of notSucceeded) lines.push(`- ${s.name}: ${s.status}. Log: ${s.log}`)
  else lines.push('- No Step failed or was skipped.')
  lines.push(...failureLines('Repos that failed to fetch:', results), ...failureLines('Repos whose review failed:', [...reviews.values()]))
  return `${lines.join('\n')}\n`
}

await runAsStep(async ({ runId, runFolder, force }) => {
  const out = join(runFolder, 'brief.md')
  const html = join(runFolder, 'brief.html')
  if (!force && existsSync(out) && existsSync(html)) {
    console.log('Brief already written in this Run, skipping')
    return
  }
  const results = readJsonFiles<FetchResult>(join(runFolder, 'fetch'))
  // A review of other commits, such as one from before Fetch was re-run, says nothing about these.
  const covers = (review: ReviewResult) =>
    results.some((r) => r.repo === review.repo && r.status === 'new-commits' && r.previous === review.from && r.head === review.to)
  const reviews = new Map(readJsonFiles<ReviewResult>(join(runFolder, 'review')).filter(covers).map((r) => [r.repo, r]))
  const pmFile = join(runFolder, 'pm.json')
  const pm = existsSync(pmFile) ? readJson<PmResult>(pmFile) : null
  const discordFile = join(runFolder, 'discord.json')
  const discord = existsSync(discordFile) ? readJson<DiscordRead>(discordFile) : null
  const docsFile = join(runFolder, 'docs.json')
  const docs = existsSync(docsFile) ? readJson<DocsResult>(docsFile) : null
  const webUrls = new Map((await loadRepos()).flatMap((repo) => (webUrl(repo.remote) ? [[repo.name, webUrl(repo.remote)!] as const] : [])))
  const inputs: BriefInputs = { run: readRun(runId), runFolder, results, reviews, pm, discord, docs, proposals: pendingProposals(), webUrls }
  writeText(out, render(inputs))
  writeText(html, renderHtml(inputs))
  console.log(`Wrote ${out} and ${html}`)
})
