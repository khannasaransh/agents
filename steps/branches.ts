// Branches: for the PM Agent's task status report, finds the work on each Repo's other branches since
// the latest sprint post: the commits on a branch that aren't on the production branch, made since
// the post. Work on a branch is work in progress before it is merged, so a task can show it before its
// commits reach production. It fetches every branch of each Repo into refs/agents/branches/ in the
// clone, where neither Saransh's own branches nor his remote-tracking refs are touched, and records
// what it found as branches.json in the Run folder. Bots' commits are left out.
// It is skipped without a sprint post in the Run. A Repo that fails to fetch is recorded, and the
// others are still read.
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { readJson, writeJson } from '../src/files.ts'
import { runGit } from '../src/git.ts'
import { loadRepos, type Repo } from '../src/repos.ts'
import type { SprintPost } from '../src/sprint.ts'
import { runAsStep, StepSkipped } from '../src/step.ts'

/** Where each Repo's branches are fetched to in its clone. */
const branchRefs = 'refs/agents/branches'
const timeoutMs = Number(process.env.AGENTS_FETCH_TIMEOUT_SECONDS ?? 300) * 1000
const fetchesAtOnce = 4
/** The most commits recorded per branch, newest first; `count` says how many there are. */
const commitsPerBranch = 20

export interface BranchWork {
  branch: string
  /** How many commits it has since the post that aren't on the production branch. */
  count: number
  /** Newest first, at most `commitsPerBranch`. */
  commits: { sha: string; author: string; date: string; subject: string }[]
}

/** What Branches writes, as branches.json in the Run folder. */
export interface BranchesRead {
  /** When the sprint post went up: the work since then is what counts. */
  since: string
  /** Each Repo with work on another branch since the post. */
  repos: { repo: string; team: Repo['team']; production: string; branches: BranchWork[] }[]
  failed: { repo: string; team: Repo['team']; error: string }[]
}

const isBot = (author: string) => /\[bot\]$/i.test(author)

async function workOn(repo: Repo, since: string): Promise<BranchWork[]> {
  await runGit(repo.folder, ['fetch', '--no-tags', '--no-recurse-submodules', '--no-write-fetch-head', '--prune', repo.remote, `+refs/heads/*:${branchRefs}/*`], { timeoutMs })
  const production = `${branchRefs}/${repo.branch}`
  // Only branches with a commit since the post can hold work since it.
  const refs = (await runGit(repo.folder, ['for-each-ref', '--format=%(refname)%09%(committerdate:iso-strict)', branchRefs]))
    .split('\n')
    .filter(Boolean)
    .map((line) => line.split('\t'))
    .filter(([ref, date]) => ref !== production && Date.parse(date) >= Date.parse(since))
    .map(([ref]) => ref)
  const work: BranchWork[] = []
  for (const ref of refs) {
    const log = await runGit(repo.folder, ['log', '--format=%H%x1f%an%x1f%aI%x1f%s', `--since=${since}`, ref, '--not', production])
    const commits = log
      .split('\n')
      .filter(Boolean)
      .map((line) => {
        const [sha, author, date, subject] = line.split('\x1f')
        return { sha, author, date, subject }
      })
      .filter((c) => !isBot(c.author))
    if (commits.length) work.push({ branch: ref.slice(branchRefs.length + 1), count: commits.length, commits: commits.slice(0, commitsPerBranch) })
  }
  return work
}

await runAsStep(async ({ runFolder, force }) => {
  const out = join(runFolder, 'branches.json')
  const sprintFile = join(runFolder, 'sprint.json')
  if (!existsSync(sprintFile)) throw new StepSkipped('No sprint post in this Run, so there are no tasks to judge')
  const since = new Date(Date.parse(readJson<SprintPost>(sprintFile).postedAt)).toISOString()
  if (!force && existsSync(out) && readJson<BranchesRead>(out).since === since) {
    console.log('Branches already read in this Run, skipping')
    return
  }
  const queue = await loadRepos()
  const read: BranchesRead = { since, repos: [], failed: [] }
  const runner = async () => {
    for (let repo = queue.shift(); repo; repo = queue.shift()) {
      try {
        const branches = await workOn(repo, since)
        if (branches.length) read.repos.push({ repo: repo.name, team: repo.team, production: repo.branch, branches })
        console.log(`${repo.name}: ${branches.length ? branches.map((b) => `${b.branch} (${b.count})`).join(', ') : 'no work on other branches'}`)
      } catch (error) {
        read.failed.push({ repo: repo.name, team: repo.team, error: error instanceof Error ? error.message : String(error) })
        console.error(`${repo.name}: failed to read its branches: ${read.failed.at(-1)!.error}`)
      }
    }
  }
  await Promise.all(Array.from({ length: fetchesAtOnce }, runner))
  read.repos.sort((a, b) => a.repo.localeCompare(b.repo))
  read.failed.sort((a, b) => a.repo.localeCompare(b.repo))
  writeJson(out, read)
  const total = read.repos.reduce((n, r) => n + r.branches.length, 0)
  console.log(`Found work since ${since} on ${total} branches in ${read.repos.length} Repos`)
  if (read.failed.length) throw new Error(`${read.failed.length} Repos failed to have their branches read: ${read.failed.map((f) => f.repo).join(', ')}`)
})
