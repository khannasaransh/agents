// Fetch: brings each Repo's production branch up to date from the remote in the Repo list, into
// the clone's origin/<branch>, and records per Repo the last reviewed commit, the new head and the
// commits between them. It never pulls, checks out or touches a working tree, so Saransh's
// uncommitted changes and branches stay as they are.
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { readJson, writeJson } from '../src/files.ts'
import { runGit } from '../src/git.ts'
import { loadRepos, type Repo } from '../src/repos.ts'
import { readRepoState, writeRepoState } from '../src/state.ts'
import { runAsStep } from '../src/step.ts'

export interface Commit {
  sha: string
  author: string
  email: string
  date: string
  subject: string
}

interface FetchedRepo {
  repo: string
  team: Repo['team']
  branch: string
  previous: string | null
}

/** What Fetch writes for each Repo, as fetch/<name>.json in the Run folder. */
export type FetchResult =
  | (FetchedRepo & {
      /** baseline: the Repo's first Run, whose head becomes the starting point. */
      status: 'baseline' | 'unchanged' | 'new-commits'
      head: string
      /** Newest first. */
      commits: Commit[]
    })
  | (FetchedRepo & { status: 'failed'; error: string })

const timeoutMs = Number(process.env.AGENTS_FETCH_TIMEOUT_SECONDS ?? 300) * 1000

async function fetchRepo(repo: Repo, fetched: FetchedRepo): Promise<Exclude<FetchResult, { status: 'failed' }>> {
  const trackingRef = `refs/remotes/origin/${repo.branch}`
  await runGit(
    repo.folder,
    ['fetch', '--no-tags', '--no-recurse-submodules', '--no-write-fetch-head', repo.remote, `+refs/heads/${repo.branch}:${trackingRef}`],
    { timeoutMs },
  )
  const head = (await runGit(repo.folder, ['rev-parse', '--verify', `${trackingRef}^{commit}`])).trim()
  if (fetched.previous === null) return { ...fetched, status: 'baseline', head, commits: [] }
  if (fetched.previous === head) return { ...fetched, status: 'unchanged', head, commits: [] }

  const log = await runGit(repo.folder, ['log', '--format=%H%x1f%an%x1f%ae%x1f%aI%x1f%s', `${fetched.previous}..${head}`])
  const commits = log
    .split('\n')
    .filter(Boolean)
    .map((line) => {
      const [sha, author, email, date, subject] = line.split('\x1f')
      return { sha, author, email, date, subject }
    })
  return { ...fetched, status: 'new-commits', head, commits }
}

await runAsStep(async ({ runFolder, force }) => {
  const repos = await loadRepos()
  const state = readRepoState()
  const failed: string[] = []

  for (const repo of repos) {
    const out = join(runFolder, 'fetch', `${repo.name}.json`)
    if (!force && existsSync(out) && readJson<FetchResult>(out).status !== 'failed') {
      console.log(`${repo.name}: already fetched in this Run, skipping`)
      continue
    }
    const fetched = { repo: repo.name, team: repo.team, branch: repo.branch, previous: state[repo.name]?.lastReviewed ?? null }
    let result: FetchResult
    try {
      const ok = await fetchRepo(repo, fetched)
      if (ok.status === 'baseline') {
        state[repo.name] = { lastReviewed: ok.head }
        writeRepoState(state)
      }
      console.log(`${repo.name}: ${ok.status}${ok.commits.length ? ` (${ok.commits.length})` : ''}`)
      result = ok
    } catch (error) {
      result = { ...fetched, status: 'failed', error: error instanceof Error ? error.message : String(error) }
      failed.push(repo.name)
      console.error(`${repo.name}: failed: ${result.error}`)
    }
    writeJson(out, result)
  }

  if (failed.length) throw new Error(`${failed.length} of ${repos.length} Repos failed to fetch: ${failed.join(', ')}`)
})
