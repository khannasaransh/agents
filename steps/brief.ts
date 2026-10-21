// Brief: renders the day's Brief as Markdown in the Run folder from what earlier Steps wrote there,
// grouped by Team, ending with the Run's health. It runs even when earlier Steps failed.
import { existsSync, readdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { readJson } from '../src/files.ts'
import { teams } from '../src/repos.ts'
import { readRun, stepsNotSucceeded, type RunRecord } from '../src/run.ts'
import { runAsStep } from '../src/step.ts'
import type { FetchResult } from './fetch.ts'

function readFetchResults(runFolder: string): FetchResult[] {
  const fetchDir = join(runFolder, 'fetch')
  if (!existsSync(fetchDir)) return []
  return readdirSync(fetchDir)
    .filter((file) => file.endsWith('.json'))
    .map((file) => readJson<FetchResult>(join(fetchDir, file)))
    .sort((a, b) => a.repo.localeCompare(b.repo))
}

const short = (sha: string) => sha.slice(0, 7)

function render(run: RunRecord, results: FetchResult[]): string {
  const lines = [`# Brief ${run.id}`, '']
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
      lines.push('')
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
  const failed = results.flatMap((r) => (r.status === 'failed' ? [r] : []))
  if (failed.length) {
    lines.push('', 'Repos that failed to fetch:', '')
    for (const r of failed) lines.push(`- ${r.repo} (${r.team}): ${r.error.split('\n')[0]}`)
  }
  return `${lines.join('\n')}\n`
}

await runAsStep(({ runId, runFolder, force }) => {
  const out = join(runFolder, 'brief.md')
  if (!force && existsSync(out)) {
    console.log('Brief already written in this Run, skipping')
    return
  }
  writeFileSync(out, render(readRun(runId), readFetchResults(runFolder)))
  console.log(`Wrote ${out}`)
})
