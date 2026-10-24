// Docs: runs the Docs Agent on the org wiki, in its own worktree, to update the existing pages whose
// sources cite files that the Run's new commits changed, and to turn each file in the PRD inbox into
// a PRD page with the wiki's PRD skill. Its work goes on one rolling docs branch, committed under
// Saransh's git identity with trailers naming the Agent and the Run. It never pushes or merges, and
// never touches Saransh's own checkout of the wiki. Once its work is committed, it moves the inbox
// files it handled into the inbox's done/, or skipped/ for those that aren't PRDs.
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { loadAgent } from '../src/agent.ts'
import { wikiFolder } from '../src/env.ts'
import { readJson, readJsonFiles, writeJson, writeText } from '../src/files.ts'
import { runGit, withWorktree } from '../src/git.ts'
import { prdInboxDir } from '../src/paths.ts'
import { moveOut, readInboxSources, waitingFiles } from '../src/prd-inbox.ts'
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

/** A file waiting in the PRD inbox, as the Docs Agent is given it. */
interface WaitingPrd {
  file: string
  /** Where the Step staged it, in the folder the Agent runs in. */
  staged: string
  /** The Discord message it was posted in, or null when Saransh dropped it in by hand. */
  discordMessage: string | null
}

/** A file from the PRD inbox that the Docs Agent turned into a PRD page, beside its copy in `_sources/<codebase>/PRD/`. */
export interface ProcessedPrd {
  file: string
  codebase: string
  page: string
  summary: string
}

/** A file from the PRD inbox that the Docs Agent didn't turn into a PRD page, such as one that isn't a PRD. */
export interface SkippedFile {
  file: string
  reason: string
}

/** The Docs Agent's answer, as its output schema shapes it. */
interface DocsAnswer {
  pages: { page: string; summary: string }[]
  prds: ProcessedPrd[]
  skipped: SkippedFile[]
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

/** The files a Run moved out of the PRD inbox: into done/ once their PRD pages were committed, and into skipped/. */
interface Handled {
  prds: ProcessedPrd[]
  skipped: SkippedFile[]
}

/**
 * What Docs writes, as docs.json in the Run folder: how this Run went, the files it moved out of the
 * PRD inbox, what waits on the branch after it (null once merged), and the Repos with new commits
 * the wiki has never documented.
 */
export type DocsResult = DocsOutcome & Handled & { waiting: DocsWaiting | null; undocumented: UndocumentedRepo[] }

type DocsOutcome =
  | { status: 'updated'; branch: string; commit: string; pages: DocsAnswer['pages'] }
  /** No page cites a file the new commits changed and the PRD inbox is empty, so the Agent wasn't called and the branch didn't move. */
  | { status: 'nothing-to-update'; branch: string }
  /** The Agent changed no page, so the branch didn't move. */
  | { status: 'no-edits'; branch: string }
  /** Merging the main line into the branch conflicts in these files, so the Step stopped with the branch as it was. */
  | { status: 'conflict'; branch: string; files: string[] }
  /** The wiki's check still reports errors after the Agent's edits, so nothing was committed. */
  | { status: 'check-failed'; branch: string; check: string }
  /** The Agent added, deleted or replaced these files, when it may only change pages that exist and add PRD pages with copies of PRD inbox files, so nothing was committed. */
  | { status: 'rejected'; branch: string; files: string[] }

const codeSource = /^([\w.-]+)@([^@\s]+)@([0-9a-f]{7,40}):(\S+)$/
/** A PRD copy in the wiki, which the PRD page cites: `_sources/<codebase>/PRD/<file>`. */
const prdCopy = /^_sources\/([^/]+)\/PRD\/([^/]+)$/
const prdPagePath = /^products\/[^/]+\/prds\/[^/]+\.md$/
/** Where the Agent may add files while turning PRDs into pages: PRD and Experiment pages with their folder indexes, and the PRD skill's work files. */
const prdArea = /^(products\/[^/]+\/(prds|experiments)\/[^/]+\.md|products\/shared\/index\.md|_runs\/prds\/.+)$/
/** Where the Step stages the PRD inbox's files in the Agent's worktree. It removes them before committing. */
const stagingFolder = '_runs/prds/inbox'
/** Where the PRD skill keeps a batch's pins, in the worktree: every Repo fetched in the Run, at its pin. */
const prdPinsFile = '_runs/prds/pins.txt'

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

/** Adds `source` to a page's `sources`, with a note on what it is, unless the page lists it already. */
function citeSource(file: string, source: string, note: string) {
  const text = readFileSync(file, 'utf8')
  const frontmatter = /^---\n([\s\S]*?)\n---/.exec(text)
  if (!frontmatter || sourcesOf(text).includes(source)) return
  const lines = frontmatter[1].split('\n')
  const at = lines.findIndex((line) => /^sources:\s*(\[\])?\s*$/.test(line))
  const item = `  - ${source}  # ${note}`
  if (at < 0) lines.push('sources:', item)
  else {
    let end = at + 1
    while (end < lines.length && /^\s+-\s/.test(lines[end])) end++
    lines.splice(at, end - at, 'sources:', ...lines.slice(at + 1, end), item)
  }
  writeFileSync(file, `---\n${lines.join('\n')}\n---${text.slice(frontmatter[0].length)}`)
}

const sameBytes = (a: string, b: string) => existsSync(a) && existsSync(b) && readFileSync(a).equals(readFileSync(b))

/**
 * The files the Agent changed that it may not: anything it deleted, anything it added outside the
 * PRD pages and their work files, and any PRD copy that isn't a file waiting in the PRD inbox, byte
 * for byte, in a Codebase the wiki has. With nothing waiting in the inbox, it may add nothing.
 */
async function forbiddenEdits(folder: string, edits: { status: string; path: string }[], inbox: string[]): Promise<string[]> {
  const codebases = (await runGit(folder, ['ls-tree', '-d', '--name-only', '-z', 'HEAD', '_sources/'])).split('\0').map((path) => path.replace(/^_sources\//, ''))
  const forbidden = edits.filter(({ status, path }) => {
    if (status === 'D') return true
    const [, codebase, file] = prdCopy.exec(path) ?? []
    if (file) return !(inbox.includes(file) && codebases.includes(codebase) && sameBytes(join(folder, path), join(prdInboxDir(), file)))
    return status !== 'M' && !(inbox.length && prdArea.test(path))
  })
  return forbidden.map((edit) => edit.path)
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
  const fetched = readJsonFiles<FetchResult>(join(runFolder, 'fetch')).flatMap((r) => (r.status === 'failed' ? [] : [r]))
  const changed = fetched.flatMap((r) => (r.status === 'new-commits' ? [r] : []))
  const changedFiles = new Map<string, string[]>()
  for (const r of changed) {
    const repo = repos.get(r.repo)
    if (!repo) continue
    changedFiles.set(r.repo, (await runGit(repo.folder, ['diff', '--name-only', '-z', r.previous!, r.head])).split('\0').filter(Boolean))
  }
  const inbox = waitingFiles()
  const inboxSources = readInboxSources()

  const name = (await runGit(wiki, ['config', 'user.name'])).trim()
  const email = (await runGit(wiki, ['config', 'user.email'])).trim()
  const asSaransh = { env: { GIT_AUTHOR_NAME: name, GIT_AUTHOR_EMAIL: email, GIT_COMMITTER_NAME: name, GIT_COMMITTER_EMAIL: email } }
  const trailers = (agent: string) => ['--trailer', `Agent: ${agent}`, '--trailer', `Run: ${runId}`]
  const commit = (folder: string, subject: string) => runGit(folder, ['-c', 'core.hooksPath=/dev/null', 'commit', '-q', '-m', subject, ...trailers(agent.name)], asSaransh)
  const main = await branchTip(wiki, mainLine)
  if (!main) throw new Error(`The wiki at ${wiki} has no ${mainLine} branch`)
  const checkedOut = await checkoutOf(wiki, docsBranch)
  if (checkedOut) throw new Error(`${docsBranch} is checked out in ${checkedOut}, so moving it would change that checkout. Switch it to another branch, then re-run the docs Step.`)
  const tip = await branchTip(wiki, docsBranch)
  // Once its tip is on the main line, Saransh has merged everything on it.
  const merged = tip !== null && (await isAncestor(wiki, tip, main))
  const base = tip && !merged ? tip : main

  let handled: Handled = { prds: [], skipped: [] }
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
      await commit(folder, `Merge ${mainLine} into ${docsBranch}`)
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
    if (!pages.length && !inbox.length) {
      console.log('No wiki page cites a file the new commits changed, and the PRD inbox is empty')
      return { status: 'nothing-to-update', branch: docsBranch }
    }
    const pinned = changed.flatMap((r) => {
      const repo = repos.get(r.repo)
      return repo ? [{ repo: r.repo, branch: r.branch, clone: repo.folder, from: r.previous, to: r.head }] : []
    })
    // The wiki's tools read code at the commits a pins file names: each changed Repo at its new head.
    const pinsFile = join(runFolder, 'docs', 'pins.txt')
    writeText(pinsFile, pinned.map((p) => `${p.repo} ${p.branch} ${p.clone} ${p.to}\n`).join(''))
    // The PRD skill traces a PRD in any Repo it touches, so every Repo fetched in the Run is pinned at its head.
    const prds: WaitingPrd[] = inbox.map((file) => ({ file, staged: `${stagingFolder}/${file}`, discordMessage: inboxSources[file]?.message ?? null }))
    if (prds.length) {
      mkdirSync(join(folder, stagingFolder), { recursive: true })
      for (const prd of prds) copyFileSync(join(prdInboxDir(), prd.file), join(folder, prd.staged))
      const prdPins = fetched.flatMap((r) => (repos.has(r.repo) ? [`${r.repo} ${r.branch} ${repos.get(r.repo)!.folder} ${r.head}\n`] : []))
      writeText(join(folder, prdPinsFile), prdPins.join(''))
    }
    const inputs = { pages, repos: pinned, pinsFile, prds, prdPinsFile: prds.length ? prdPinsFile : null }
    const answer = (await callAgent(agent, inputs, { cwd: folder, dryRun })) as DocsAnswer
    rmSync(join(folder, stagingFolder), { recursive: true, force: true })

    const edits = await changesIn(folder)
    // It updates pages that exist, and adds only PRD pages, so it can never document a Repo for the first time.
    const forbidden = await forbiddenEdits(folder, edits, inbox)
    if (forbidden.length) return { status: 'rejected', branch: docsBranch, files: forbidden }
    const edited = new Set(edits.map((c) => c.path))
    // A PRD counts as done only once its page and its copy are both in the worktree.
    const done = answer.prds.filter((prd) => {
      const found =
        inbox.includes(prd.file) && prdPagePath.test(prd.page) && edited.has(prd.page) && sameBytes(join(folder, '_sources', prd.codebase, 'PRD', prd.file), join(prdInboxDir(), prd.file))
      if (!found) console.log(`The Docs Agent says it turned ${prd.file} into ${prd.page}, but they aren't both in its edits, so ${prd.file} stays in the PRD inbox`)
      return found
    })
    const skipped = answer.skipped.filter((s) => inbox.includes(s.file) && !done.some((prd) => prd.file === s.file))
    for (const prd of done) {
      const message = inboxSources[prd.file]?.message
      if (message) citeSource(join(folder, prd.page), message, 'the Discord message this copy came from')
    }
    const touched = edits.map((c) => c.path).filter(isPage)
    if (!touched.length) {
      console.log(`The Docs Agent changed no page, so ${docsBranch} stays where it was`)
      handled = { prds: [], skipped }
      return { status: 'no-edits', branch: docsBranch }
    }
    // The wiki's stamp sets a `wiki@` source's commit from the commit that added the copy, so the copies go first.
    const copies = edits.map((c) => c.path).filter((path) => prdCopy.test(path))
    if (copies.length) {
      await runGit(folder, ['add', '--', ...copies])
      await commit(folder, 'Add PRD copies from the PRD inbox')
    }
    for (const page of touched) markDraft(join(folder, page))
    await wikiTool(folder, 'regions', [])
    // Only the pages the Agent read the code for get new stamps; a page regions changed keeps its own.
    // The pages it wrote from PRDs read the code at the PRD pins, and the pages it updated at the Run's.
    const written = new Set([...edits.filter((c) => c.status !== 'M').map((c) => c.path), ...done.map((prd) => prd.page)])
    const prdPages = touched.filter((page) => written.has(page))
    const updated = touched.filter((page) => !written.has(page))
    if (updated.length) await wikiTool(folder, 'stamp', [pinsFile, ...updated])
    if (prdPages.length) await wikiTool(folder, 'stamp', [prdPinsFile, ...prdPages])
    const changedPages = (await changesIn(folder)).map((c) => c.path).filter((page) => isPage(page) && !written.has(page))
    const checks: [string[], string][] = [
      [changedPages, pinsFile],
      [prdPages, prdPinsFile],
    ]
    const failed: string[] = []
    for (const [checked, pins] of checks.filter(([checked]) => checked.length)) {
      const check = await wikiTool(folder, 'check', [...checked, '--pins', pins])
      if (check.code !== 0) failed.push((check.stdout + check.stderr).trim())
    }
    if (failed.length) return { status: 'check-failed', branch: docsBranch, check: failed.join('\n') }

    await runGit(folder, ['add', '--all'])
    const fromCommits = 'Update wiki pages from new commits'
    await commit(folder, done.length ? (answer.pages.length ? `${fromCommits}, and add PRD pages from the PRD inbox` : 'Add PRD pages from the PRD inbox') : fromCommits)
    const head = (await runGit(folder, ['rev-parse', 'HEAD'])).trim()
    // Moved only from where it was found, so nothing that moved it meanwhile is lost.
    await runGit(wiki, ['update-ref', `refs/heads/${docsBranch}`, head, tip ?? '0'.repeat(40)])
    handled = { prds: done, skipped }
    return { status: 'updated', branch: docsBranch, commit: head, pages: answer.pages }
  })
  // A dry run's answer came from the fake Worker, so it moves nothing out of the inbox.
  if (dryRun) handled = { prds: [], skipped: [] }
  moveOut([...handled.prds.map((prd) => ({ file: prd.file, area: 'done' as const })), ...handled.skipped.map((s) => ({ file: s.file, area: 'skipped' as const }))])
  // A Repo is documented once it has its own folder of pages on the main line.
  const documented = new Set((await runGit(wiki, ['ls-tree', '-d', '--name-only', '-z', main, 'repos/'])).split('\0').map((path) => path.replace(/^repos\//, '')))
  const undocumented = changed.filter((r) => !documented.has(r.repo)).map((r) => ({ repo: r.repo, team: r.team, commits: r.commits.length }))
  const result: DocsResult = { ...outcome, ...handled, waiting: await waitingOn(wiki, main), undocumented }
  writeJson(out, result)
  if (result.status === 'conflict') {
    throw new Error(`Merging ${mainLine} into ${docsBranch} conflicts in ${result.files.join(', ')}, so the wiki was left as it was. Merge it by hand, then re-run the docs Step.`)
  }
  if (result.status === 'check-failed') throw new Error(`The wiki's check still reports errors, so the Docs Agent's edits weren't committed:\n${result.check}`)
  if (result.status === 'rejected') {
    throw new Error(
      `The Docs Agent added, deleted or replaced ${result.files.join(', ')}, when it may only update pages that exist and add PRD pages with copies of PRD inbox files, so its edits weren't committed`,
    )
  }
})
