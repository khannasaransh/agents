// Brief: renders the day's Brief as Markdown in the Run folder from what earlier Steps wrote there:
// the PM Agent's To-dos and Discord highlights, the Discord messages that mention Saransh and the
// DMs with the bot, then by Team each Repo's line from the PM Agent, its new commits and review,
// then the docs branch's pages waiting for review, the PRD inbox files set aside and the undocumented
// Repos with new commits, then the Memory changes waiting for Saransh and the Run's health with the
// number of Repos reviewed.
// It runs even when earlier Steps failed, and says when the PM output is missing.
import { existsSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { readJson, readJsonFiles } from '../src/files.ts'
import { pendingProposals, type MemoryProposal } from '../src/memory.ts'
import { teams } from '../src/repos.ts'
import { readRun, stepsNotSucceeded, type RunRecord } from '../src/run.ts'
import { runAsStep } from '../src/step.ts'
import { mainLine } from '../agents/docs/config.ts'
import type { DiscordMessage, DiscordRead } from './discord.ts'
import type { DocsResult } from './docs.ts'
import type { FetchResult } from './fetch.ts'
import type { PmResult } from './pm.ts'
import { severities } from '../agents/reviewer/config.ts'
import type { Finding, ReviewResult } from './review.ts'

const short = (sha: string) => sha.slice(0, 7)
const firstLine = (text: string) => text.split('\n')[0]

/** Saransh's own findings first, then the worst first. */
const byPriority = (a: Finding, b: Finding) => Number(b.bySaransh) - Number(a.bySaransh) || severities.indexOf(a.severity) - severities.indexOf(b.severity)

function reviewLines(review: ReviewResult | undefined): string[] {
  if (!review) return ['No review of these commits in this Run.', '']
  if (review.status === 'failed') return [`Review failed: ${firstLine(review.error)}`, '']
  const lines = [`Review: ${review.summary}`, '']
  if (!review.findings.length) lines.push('No findings.')
  for (const f of review.findings.toSorted(byPriority)) {
    const where = f.line === null ? f.file : `${f.file}:${f.line}`
    lines.push(`- **${f.severity}** \`${where}\` in \`${short(f.commit)}\` by ${f.author}${f.bySaransh ? ' (yours)' : ''}: ${f.summary}`)
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
  return [
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
  const forYou = discord.messages.filter((m) => m.mentionsSaransh || m.dm)
  const where = (m: DiscordMessage) => (m.dm ? `DM with ${m.channel}` : `#${m.channel}${m.thread ? ` › ${m.thread}` : ''}`)
  return [
    '## Mentions of you and DMs on Discord',
    '',
    ...(forYou.length
      ? forYou.map((m) => `- [${where(m)}](${m.link}) ${m.author}: ${firstLine(m.content)}`)
      : [`None of the ${discord.messages.length} messages read mention you, and none came in a DM.`]),
    '',
  ]
}

/** The docs branch's pages waiting for Saransh's review, and how this Run's Docs Step went, with the PRD pages it wrote. */
function docsLines(docs: DocsResult | null): string[] {
  const stopped = docs?.status === 'conflict' || docs?.status === 'check-failed' || docs?.status === 'rejected'
  if (!docs || (!docs.waiting && !stopped && !docs.prds.length)) return []
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
      if (docs.prds.length) {
        lines.push('This Run wrote PRD pages from the PRD inbox, and moved their files to done/ there:', '')
        lines.push(...docs.prds.map((p) => `- ${p.page}, from ${p.file}: ${p.summary}`), '')
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
    case 'rejected':
      lines.push(
        `${notCommitted} the Docs Agent added, deleted or replaced ${docs.files.join(', ')}, and it may only update pages that exist and add PRD pages with copies of PRD inbox files.`,
        '',
      )
      break
  }
  if (docs.waiting) lines.push(`Review it with \`git diff ${mainLine}...${docs.branch}\` in the wiki, and merge it into ${mainLine} when you accept it.`, '')
  return lines
}

function skippedLines(docs: DocsResult | null): string[] {
  if (!docs?.skipped.length) return []
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

function render(
  run: RunRecord,
  results: FetchResult[],
  reviews: Map<string, ReviewResult>,
  pm: PmResult | null,
  discord: DiscordRead | null,
  docs: DocsResult | null,
  proposals: MemoryProposal[],
): string {
  const lines = [`# Brief ${run.id}`, '']
  if (run.dryRun) lines.push('Dry run: every Agent ran on the fake Worker, so no review in this Brief is real, and none counts as done.', '')
  lines.push(...pmLines(pm, discord), ...mentionLines(discord))
  const repoLines = new Map(pm?.status === 'answered' ? pm.repoLines.map((r) => [r.repo, r.line]) : [])
  if (!results.length) lines.push('No Repo was fetched in this Run.', '')

  for (const team of teams) {
    const ofTeam = results.filter((r) => r.team === team)
    const changed = ofTeam.flatMap((r) => (r.status === 'new-commits' ? [r] : []))
    const baselines = ofTeam.flatMap((r) => (r.status === 'baseline' ? [r] : []))
    const unchanged = ofTeam.filter((r) => r.status === 'unchanged').map((r) => r.repo)
    if (!changed.length && !baselines.length && !unchanged.length) continue

    lines.push(`## ${team}`, '')
    for (const r of changed) {
      const count = r.commits.length === 1 ? '1 new commit' : `${r.commits.length} new commits`
      lines.push(`### ${r.repo}`, '')
      const line = repoLines.get(r.repo)
      if (line) lines.push(line, '')
      lines.push(`${count} on ${r.branch}:`, '')
      for (const c of r.commits) lines.push(`- \`${short(c.sha)}\` ${c.subject} (${c.author})`)
      lines.push('', ...reviewLines(reviews.get(r.repo)))
    }
    for (const r of baselines) {
      lines.push(`### ${r.repo}`, '', `Baseline recorded at \`${short(r.head)}\` on ${r.branch}. New commits are listed from the next Run.`, '')
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

await runAsStep(({ runId, runFolder, force }) => {
  const out = join(runFolder, 'brief.md')
  if (!force && existsSync(out)) {
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
  writeFileSync(out, render(readRun(runId), results, reviews, pm, discord, docs, pendingProposals()))
  console.log(`Wrote ${out}`)
})
