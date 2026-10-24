// Docs: runs the Docs Agent on the org wiki, in its own worktree, to update the existing pages whose
// sources cite files that the Run's new commits changed. Its work goes on one rolling docs branch,
// committed under Saransh's git identity with trailers naming the Agent and the Run. It never pushes
// or merges, and never touches Saransh's own checkout of the wiki.
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { loadAgent } from '../src/agent.ts'
import { wikiFolder } from '../src/env.ts'
import { readJson, readJsonFiles, writeJson, writeText } from '../src/files.ts'
import { runGit, withWorktree } from '../src/git.ts'
import { runProcess, type ProcessResult } from '../src/process.ts'
import { loadRepos } from '../src/repos.ts'
import { readRun } from '../src/run.ts'
import { runAsStep, StepSkipped } from '../src/step.ts'
import { callAgent } from '../src/worker.ts'
import { docsBranch, mainLine } from '../agents/docs/config.ts'
import type { FetchResult } from './fetch.ts'

/** A source a page cites that new commits changed, with the files in it they changed. */
interface ChangedSource {
  repo: string
  source: string
  files: string[]
}

interface PageToUpdate {
  page: string
  changed: ChangedSource[]
}

/** The Docs Agent's answer, as its output schema shapes it. */
interface DocsAnswer {
  pages: { page: string; summary: string }[]
}

/** What waits on the docs branch for Saransh's review: its commits not on the main line, and the pages they change. */
export interface DocsWaiting {
  commits: number
  pages: string[]
}

/** A Repo with new commits in the Run that has no pages of its own in the wiki, which the Docs Agent never writes. */
export interface UndocumentedRepo {
  repo: string
  team: FetchResult['team']
  commits: number
}

/**
 * What Docs writes, as docs.json in the Run folder: how this Run went, what waits on the branch
 * after it (null once merged), and the Repos with new commits the wiki has never documented.
 */
export type DocsResult = DocsOutcome & { waiting: DocsWaiting | null; undocumented: UndocumentedRepo[] }

type DocsOutcome =
  | { status: 'updated'; branch: string; commit: string; pages: DocsAnswer['pages'] }
  /** No page cites a file the new commits changed, so the Agent wasn't called and the branch didn't move. */
  | { status: 'nothing-to-update'; branch: string }
  /** The Agent changed no page, so the branch didn't move. */
  | { status: 'no-edits'; branch: string }
  /** Merging the main line into the branch conflicts in these files, so the Step stopped with the branch as it was. */
  | { status: 'conflict'; branch: string; files: string[] }
  /** The wiki's check still reports errors after the Agent's edits, so nothing was committed. */
  | { status: 'check-failed'; branch: string; check: string }
  /** The Agent added or deleted these files, when it may only change pages that exist, so nothing was committed. */
  | { status: 'rejected'; branch: string; files: string[] }

const codeSource = /^([\w.-]+)@([^@\s]+)@([0-9a-f]{7,40}):(\S+)$/

/** The `sources` a page's frontmatter lists. */
function sourcesOf(text: string): string[] {
  const frontmatter = /^---\n([\s\S]*?)\n---/.exec(text)?.[1] ?? ''
  const sources: string[] = []
  let inSources = false
  for (const line of frontmatter.split('\n')) {
    const item = /^\s+-\s+(.*?)(\s+#\s.*)?$/.exec(line)
    if (item && inSources) sources.push(item[1].trim())
    else if (/^[\w-]+:/.test(line)) inSources = line.startsWith('sources:')
  }
  return sources
}

/** Whether a file in the wiki is a content page: Markdown outside dot and `_` folders, except the root's own files. */
function isPage(file: string): boolean {
  const rootFiles = new Set(['AGENTS.md', 'CONTEXT.md', 'CLAUDE.md', 'README.md'])
  return file.endsWith('.md') && !file.split('/').some((part) => part.startsWith('.') || part.startsWith('_')) && !rootFiles.has(file)
}

async function contentPages(folder: string): Promise<string[]> {
  return (await runGit(folder, ['ls-files', '-z', '--', '*.md'])).split('\0').filter((file) => file && isPage(file))
}

/** What changed in a worktree since its last commit, by path: M modified, A added, D deleted, ?? untracked. */
async function changesIn(folder: string): Promise<{ status: string; path: string }[]> {
  const entries = (await runGit(folder, ['status', '--porcelain=v1', '-z', '--no-renames', '--untracked-files=all'])).split('\0').filter(Boolean)
  return entries.map((entry) => ({ status: entry.slice(0, 2).trim(), path: entry.slice(3) }))
}

/** Sets a page's frontmatter to `review: draft`, since only Saransh accepts a page. */
function markDraft(file: string) {
  const text = readFileSync(file, 'utf8')
  const frontmatter = /^---\n([\s\S]*?)\n---/.exec(text)
  if (!frontmatter) return
  const fields = frontmatter[1]
  const drafted = /^review:.*$/m.test(fields) ? fields.replace(/^review:.*$/m, 'review: draft') : `${fields}\nreview: draft`
  if (drafted !== fields) writeFileSync(file, `---\n${drafted}\n---${text.slice(frontmatter[0].length)}`)
}

/** Runs one of the wiki's own tools from the root of `folder`, as its AGENTS.md says to. */
async function wikiTool(folder: string, tool: string, args: string[]): Promise<ProcessResult> {
  const ended = await runProcess(process.execPath, [join('_wiki', 'tools', `${tool}.mjs`), ...args], { cwd: folder, timeoutMs: 10 * 60_000 })
  if (ended.timedOut) throw new Error(`The wiki's ${tool} tool timed out`)
  console.log(`${tool}: ${(ended.stdout + ended.stderr).trim()}`)
  return ended
}

/** The commit a branch of the wiki is at, or null when it has no such branch. */
async function branchTip(wiki: string, branch: string): Promise<string | null> {
  const found = await runGit(wiki, ['for-each-ref', '--format=%(objectname)', `refs/heads/${branch}`])
  return found.trim() || null
}

/** The folder of the wiki checkout that has `branch` checked out, or null when none has. */
async function checkoutOf(wiki: string, branch: string): Promise<string | null> {
  const worktrees = (await runGit(wiki, ['worktree', 'list', '--porcelain'])).split('\n\n')
  const holding = worktrees.find((entry) => entry.split('\n').includes(`branch refs/heads/${branch}`))
  return holding?.split('\n')[0].replace(/^worktree /, '') ?? null
}

/** What waits on the docs branch for Saransh's review, or null when it has nothing he hasn't merged. */
async function waitingOn(wiki: string, main: string): Promise<DocsWaiting | null> {
  const tip = await branchTip(wiki, docsBranch)
  if (!tip || (await isAncestor(wiki, tip, main))) return null
  const commits = Number((await runGit(wiki, ['rev-list', '--count', `${main}..${tip}`])).trim())
  const pages = (await runGit(wiki, ['diff', '--name-only', '-z', `${main}...${tip}`])).split('\0').filter((file) => file && isPage(file))
  return { commits, pages }
}

async function isAncestor(wiki: string, commit: string, of: string): Promise<boolean> {
  return runGit(wiki, ['merge-base', '--is-ancestor', commit, of]).then(
    () => true,
    () => false,
  )
}

/** How a Run ends when the Docs Step finished its work, so a re-run has nothing left to do. */
const finished: DocsResult['status'][] = ['updated', 'no-edits', 'nothing-to-update']

await runAsStep(async ({ runId, runFolder, force }) => {
  const out = join(runFolder, 'docs.json')
  if (!force && existsSync(out) && finished.includes(readJson<DocsResult>(out).status)) {
    console.log('Docs already finished in this Run, skipping')
    return
  }
  const wiki = wikiFolder()
  if (!wiki) throw new StepSkipped('No WIKI_FOLDER in the env file, so there is no wiki to update')
  const { dryRun = false } = readRun(runId)
  const agent = await loadAgent('docs')
  const repos = new Map((await loadRepos()).map((repo) => [repo.name, repo]))
  const changed = readJsonFiles<FetchResult>(join(runFolder, 'fetch')).flatMap((r) => (r.status === 'new-commits' ? [r] : []))
  const changedFiles = new Map<string, string[]>()
  for (const fetched of changed) {
    const repo = repos.get(fetched.repo)
    if (!repo) continue
    changedFiles.set(fetched.repo, (await runGit(repo.folder, ['diff', '--name-only', '-z', fetched.previous!, fetched.head])).split('\0').filter(Boolean))
  }

  const name = (await runGit(wiki, ['config', 'user.name'])).trim()
  const email = (await runGit(wiki, ['config', 'user.email'])).trim()
  const asSaransh = { env: { GIT_AUTHOR_NAME: name, GIT_AUTHOR_EMAIL: email, GIT_COMMITTER_NAME: name, GIT_COMMITTER_EMAIL: email } }
  const trailers = (agent: string) => ['--trailer', `Agent: ${agent}`, '--trailer', `Run: ${runId}`]
  const main = await branchTip(wiki, mainLine)
  if (!main) throw new Error(`The wiki at ${wiki} has no ${mainLine} branch`)
  const checkedOut = await checkoutOf(wiki, docsBranch)
  if (checkedOut) throw new Error(`${docsBranch} is checked out in ${checkedOut}, so moving it would change that checkout. Switch it to another branch, then re-run the docs Step.`)
  const tip = await branchTip(wiki, docsBranch)
  // Once its tip is on the main line, Saransh has merged everything on it.
  const merged = tip !== null && (await isAncestor(wiki, tip, main))
  const base = tip && !merged ? tip : main

  const outcome = await withWorktree(wiki, base, async (folder): Promise<DocsOutcome> => {
    if (base === tip && !(await isAncestor(wiki, main, tip))) {
      try {
        await runGit(folder, ['-c', 'core.hooksPath=/dev/null', 'merge', '-q', '--no-ff', '--no-commit', main])
      } catch (error) {
        const files = (await runGit(folder, ['diff', '--name-only', '-z', '--diff-filter=U'])).split('\0').filter(Boolean)
        if (!files.length) throw error
        await runGit(folder, ['merge', '--abort'])
        return { status: 'conflict', branch: docsBranch, files }
      }
      await runGit(folder, ['-c', 'core.hooksPath=/dev/null', 'commit', '-q', '-m', `Merge ${mainLine} into ${docsBranch}`, ...trailers(agent.name)], asSaransh)
      console.log(`Merged ${mainLine} into ${docsBranch}`)
    }
    const pages: PageToUpdate[] = []
    for (const page of await contentPages(folder)) {
      const sources = sourcesOf(readFileSync(join(folder, page), 'utf8'))
      const cited = sources.flatMap((source): ChangedSource[] => {
        const [, repo, branch, , path] = codeSource.exec(source) ?? []
        const fetched = changed.find((r) => r.repo === repo && r.branch === branch)
        const under = (file: string) => file === path || file.startsWith(path.endsWith('/') ? path : `${path}/`)
        const files = fetched ? (changedFiles.get(repo) ?? []).filter(under) : []
        return files.length ? [{ repo, source, files }] : []
      })
      if (cited.length) pages.push({ page, changed: cited })
    }
    if (!pages.length) {
      console.log('No wiki page cites a file the new commits changed')
      return { status: 'nothing-to-update', branch: docsBranch }
    }
    const pinned = changed.flatMap((r) => {
      const repo = repos.get(r.repo)
      return repo ? [{ repo: r.repo, branch: r.branch, clone: repo.folder, from: r.previous, to: r.head }] : []
    })
    // The wiki's tools read code at the commits a pins file names: each changed Repo at its new head.
    const pinsFile = join(runFolder, 'docs', 'pins.txt')
    writeText(pinsFile, pinned.map((p) => `${p.repo} ${p.branch} ${p.clone} ${p.to}\n`).join(''))
    const answer = (await callAgent(agent, { pages, repos: pinned, pinsFile }, { cwd: folder, dryRun })) as DocsAnswer

    const edits = await changesIn(folder)
    // It updates pages that exist, so it can never document a Repo for the first time.
    const addedOrDeleted = edits.filter((c) => c.status !== 'M').map((c) => c.path)
    if (addedOrDeleted.length) return { status: 'rejected', branch: docsBranch, files: addedOrDeleted }
    const touched = edits.map((c) => c.path).filter(isPage)
    if (!touched.length) {
      console.log(`The Docs Agent changed no page, so ${docsBranch} stays where it was`)
      return { status: 'no-edits', branch: docsBranch }
    }
    for (const page of touched) markDraft(join(folder, page))
    await wikiTool(folder, 'regions', [])
    // Only the pages the Agent read the code for get new stamps; a page regions changed keeps its own.
    await wikiTool(folder, 'stamp', [pinsFile, ...touched])
    const changedPages = (await changesIn(folder)).map((c) => c.path).filter(isPage)
    const check = await wikiTool(folder, 'check', [...changedPages, '--pins', pinsFile])
    if (check.code !== 0) return { status: 'check-failed', branch: docsBranch, check: (check.stdout + check.stderr).trim() }

    await runGit(folder, ['add', '--all'])
    await runGit(folder, ['-c', 'core.hooksPath=/dev/null', 'commit', '-q', '-m', 'Update wiki pages from new commits', ...trailers(agent.name)], asSaransh)
    const commit = (await runGit(folder, ['rev-parse', 'HEAD'])).trim()
    // Moved only from where it was found, so nothing that moved it meanwhile is lost.
    await runGit(wiki, ['update-ref', `refs/heads/${docsBranch}`, commit, tip ?? '0'.repeat(40)])
    return { status: 'updated', branch: docsBranch, commit, pages: answer.pages }
  })
  // A Repo is documented once it has its own folder of pages on the main line.
  const documented = new Set((await runGit(wiki, ['ls-tree', '-d', '--name-only', '-z', main, 'repos/'])).split('\0').map((path) => path.replace(/^repos\//, '')))
  const undocumented = changed.filter((r) => !documented.has(r.repo)).map((r) => ({ repo: r.repo, team: r.team, commits: r.commits.length }))
  const result: DocsResult = { ...outcome, waiting: await waitingOn(wiki, main), undocumented }
  writeJson(out, result)
  if (result.status === 'conflict') {
    throw new Error(`Merging ${mainLine} into ${docsBranch} conflicts in ${result.files.join(', ')}, so the wiki was left as it was. Merge it by hand, then re-run the docs Step.`)
  }
  if (result.status === 'check-failed') throw new Error(`The wiki's check still reports errors, so the Docs Agent's edits weren't committed:\n${result.check}`)
  if (result.status === 'rejected') {
    throw new Error(`The Docs Agent added or deleted ${result.files.join(', ')}, when it may only update pages that exist, so its edits weren't committed`)
  }
})
