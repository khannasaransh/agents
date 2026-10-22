// Review: runs the Reviewer Agent once per Repo with new commits, a few at a time, and records
// what it found as review/<name>.json in the Run folder. Each review reads a temporary clean
// worktree of the production branch at the new head, never Saransh's working copy. A failed review
// is recorded and the other Repos are still reviewed.
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { loadAgent } from '../src/agent.ts'
import { saranshEmails } from '../src/env.ts'
import { readJson, readJsonFiles, writeJson } from '../src/files.ts'
import { withWorktree } from '../src/git.ts'
import { loadRepos } from '../src/repos.ts'
import { readRun } from '../src/run.ts'
import { runAsStep } from '../src/step.ts'
import { callAgent } from '../src/worker.ts'
import type { Severity } from '../agents/reviewer/config.ts'
import type { Commit, FetchResult } from './fetch.ts'

export interface Finding {
  severity: Severity
  file: string
  line: number | null
  commit: string
  author: string
  summary: string
  /** The commit it is on was written by Saransh. */
  bySaransh: boolean
}

/** The Reviewer's answer, as its output schema shapes it. */
interface ReviewerAnswer {
  summary: string
  findings: Omit<Finding, 'bySaransh'>[]
}

interface ReviewedRange {
  repo: string
  team: FetchResult['team']
  branch: string
  from: string
  to: string
}

/** What Review writes for each Repo with new commits, as review/<name>.json in the Run folder. */
export type ReviewResult =
  | (ReviewedRange & { status: 'reviewed'; summary: string; findings: Finding[] })
  | (ReviewedRange & { status: 'failed'; error: string })

const reviewsAtOnce = 3

await runAsStep(async ({ runId, runFolder, force }) => {
  const { dryRun = false } = readRun(runId)
  const reviewer = await loadAgent('reviewer')
  const repos = new Map((await loadRepos()).map((repo) => [repo.name, repo]))
  const changed = readJsonFiles<FetchResult>(join(runFolder, 'fetch')).flatMap((r) => (r.status === 'new-commits' ? [r] : []))
  const emails = saranshEmails()
  if (!emails.length) console.log("No SARANSH_GIT_EMAILS in the env file, so no finding is marked as Saransh's")
  // Git, not the Reviewer, says who wrote a commit in the range.
  const markAuthor = (finding: ReviewerAnswer['findings'][number], commits: Commit[]): Finding => {
    const commit = findCommit(commits, finding.commit)
    return { ...finding, author: commit?.author ?? finding.author, bySaransh: !!commit && emails.includes(commit.email.toLowerCase()) }
  }
  const failed: string[] = []

  await forEachAtMost(changed, reviewsAtOnce, async (fetched) => {
    const range: ReviewedRange = { repo: fetched.repo, team: fetched.team, branch: fetched.branch, from: fetched.previous!, to: fetched.head }
    const out = join(runFolder, 'review', `${range.repo}.json`)
    const done = existsSync(out) ? readJson<ReviewResult>(out) : null
    if (!force && done?.status === 'reviewed' && done.from === range.from && done.to === range.to) {
      console.log(`${range.repo}: already reviewed in this Run, skipping`)
      return
    }
    let result: ReviewResult
    try {
      const repo = repos.get(fetched.repo)
      if (!repo) throw new Error(`${fetched.repo} is no longer in the Repo list`)
      const inputs = { repo: range.repo, branch: range.branch, from: range.from, to: range.to, commits: fetched.commits }
      const log = (line: string) => console.log(`${range.repo}: ${line}`)
      const answer = (await withWorktree(repo.folder, range.to, (cwd) => callAgent(reviewer, inputs, { cwd, dryRun, log }))) as ReviewerAnswer
      result = { ...range, status: 'reviewed', summary: answer.summary, findings: answer.findings.map((f) => markAuthor(f, fetched.commits)) }
      console.log(`${range.repo}: reviewed, ${result.findings.length} findings`)
    } catch (error) {
      result = { ...range, status: 'failed', error: error instanceof Error ? error.message : String(error) }
      failed.push(range.repo)
      console.error(`${range.repo}: review failed: ${result.error}`)
    }
    writeJson(out, result)
  })

  if (failed.length) throw new Error(`${failed.length} of ${changed.length} reviews failed: ${failed.join(', ')}`)
})

/** The commit `sha` names, which may be a short sha of at least 7 characters. */
function findCommit(commits: Commit[], sha: string): Commit | undefined {
  return sha.length >= 7 ? commits.find((c) => c.sha.startsWith(sha.toLowerCase())) : undefined
}

/** Runs `each` on every item, with at most `limit` running at once. */
async function forEachAtMost<T>(items: T[], limit: number, each: (item: T) => Promise<void>): Promise<void> {
  const queue = [...items]
  const runner = async () => {
    for (let item = queue.shift(); item !== undefined; item = queue.shift()) await each(item)
  }
  await Promise.all(Array.from({ length: Math.min(limit, queue.length) }, runner))
}
