// Brief: renders the day's Brief as Markdown in the Run folder from what earlier Steps wrote there,
// grouped by Team: each Repo's new commits and review, then the Run's health. It runs even when
// earlier Steps failed.
import { existsSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { readJsonFiles } from '../src/files.ts'
import { teams } from '../src/repos.ts'
import { readRun, stepsNotSucceeded, type RunRecord } from '../src/run.ts'
import { runAsStep } from '../src/step.ts'
import type { FetchResult } from './fetch.ts'
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

function render(run: RunRecord, results: FetchResult[], reviews: Map<string, ReviewResult>): string {
  const lines = [`# Brief ${run.id}`, '']
  if (run.dryRun) lines.push('Dry run: every Agent ran on the fake Worker, so no review in this Brief is real, and none counts as done.', '')
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
      lines.push(`### ${r.repo}`, '', `${count} on ${r.branch}:`, '')
      for (const c of r.commits) lines.push(`- \`${short(c.sha)}\` ${c.subject} (${c.author})`)
      lines.push('', ...reviewLines(reviews.get(r.repo)))
    }
    for (const r of baselines) {
      lines.push(`### ${r.repo}`, '', `Baseline recorded at \`${short(r.head)}\` on ${r.branch}. New commits are listed from the next Run.`, '')
    }
    if (unchanged.length) lines.push(`Unchanged: ${unchanged.join(', ')}`, '')
  }

  lines.push('## Run health', '', `Run ${run.id} of the ${run.pipeline} Pipeline.`, '')
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
  writeFileSync(out, render(readRun(runId), results, reviews))
  console.log(`Wrote ${out}`)
})
