// Brief: renders the day's Brief as Markdown in the Run folder from what earlier Steps wrote there:
// the PM Agent's To-dos and Discord highlights, then by Team each Repo's line from the PM Agent, its
// new commits and review, then the Memory changes waiting for Saransh and the Run's health with the
// number of Repos reviewed. It runs even when earlier Steps failed, and says when the PM output is
// missing.
import { existsSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { readJson, readJsonFiles } from '../src/files.ts'
import { pendingProposals, type MemoryProposal } from '../src/memory.ts'
import { teams } from '../src/repos.ts'
import { readRun, stepsNotSucceeded, type RunRecord } from '../src/run.ts'
import { runAsStep } from '../src/step.ts'
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

function pmLines(pm: PmResult | null): string[] {
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
    // Until there is a Discord Step, the PM Agent is never given Discord messages.
    ...listed(pm.highlights, 'No Discord messages were read in this Run.'),
    '',
  ]
}

function render(run: RunRecord, results: FetchResult[], reviews: Map<string, ReviewResult>, pm: PmResult | null, proposals: MemoryProposal[]): string {
  const lines = [`# Brief ${run.id}`, '']
  if (run.dryRun) lines.push('Dry run: every Agent ran on the fake Worker, so no review in this Brief is real, and none counts as done.', '')
  lines.push(...pmLines(pm))
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

  lines.push(...proposalLines(proposals))
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
  writeFileSync(out, render(readRun(runId), results, reviews, pm, pendingProposals()))
  console.log(`Wrote ${out}`)
})
