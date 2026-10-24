# Review: issue 11, PRD inbox

Reviewed 24 October 2026 against the uncommitted changes (staged, compared with `HEAD`).

The PRD-inbox changes pass the Docs, Brief, and Discord tests (68) and `tsc --noEmit`. The gate that decides what lands on the docs branch still trusts the worktree after the agent runs.

Standards: 1 hard violation, 3 judgement calls. Spec: 8 findings. Worst issue: the step executes and commits the wiki checker from a worktree whose existing files the new gate still lets the agent modify.

## Findings

**High — the step runs the wiki checker from the worktree, and the new gate allows that file to be edited.** `forbiddenEdits` rejects deletes and most new files. Every ordinary modification of an existing file is allowed, including `_wiki/tools/check.mjs`, `stamp.mjs`, and `regions.mjs`. The Docs Agent's write folder is the whole worktree, and this change starts feeding it untrusted inbox files from Discord. The step then launches those scripts from that worktree and commits with `git add --all`, with no second pass over what they changed.

```178:186:steps/docs.ts
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
```

`wikiTool` runs `node _wiki/tools/<tool>.mjs` with the worktree as cwd (line 190). `regions` and `stamp` exit codes are ignored; only `check` can stop the commit (lines 344–362). A patched checker that exits 0, or a patched stamp that rewrites pages when the step launches it, is published to `agents/docs`. Allow only the page, copy, index, and `_runs/prds/` paths the agent is supposed to touch, reject edits under `_wiki/`, and run the tools from a clean copy of those scripts.

**High — `prd` can write outside the wiki, and a PRD still counts as done.** `feature` is constrained to kebab-case. `codebase` and `staged` are not. `existsSync(join('_sources', codebase))` is true for `../..`, because that resolves to a directory that exists, and `copyFileSync` then writes `<that directory>/PRD/<filename>`. The Docs Agent's worker is Claude Code, and its Tools run outside the sandbox, so this is not limited by the Edit allowlist. `done` only checks that the page was edited and that `join(folder, '_sources', prd.codebase, 'PRD', prd.file)` has the inbox bytes. It never requires that copy to be a git edit under `_sources/<one segment>/PRD/`. The page can be committed, the inbox file moved to `done/`, and the copy left outside the repo.

```26:32:agents/docs/tools/prd
  if (!codebase || !feature) fail(usage)
  if (!existsSync(join('_sources', codebase))) fail(`the wiki has no _sources/${codebase}; its Codebases: ${readdirSync('_sources').join(', ')}`)
  if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(feature)) fail(`${feature} isn't a lowercase kebab-case name`)
  const copy = join('_sources', codebase, 'PRD', basename(staged))
  const replaced = existsSync(copy)
  mkdirSync(dirname(copy), { recursive: true })
  copyFileSync(staged, copy)
```

`prd convert` has the same hole for `staged`: it writes `.converted/` beside whatever `.docx` path it is given. Confine both arguments to the staging folder and a single `_sources` child, and require the copy path to be in the worktree diff before moving the inbox file.

**High — stamp and check trust a pins file the agent is allowed to rewrite.** The step writes `_runs/prds/pins.txt`, then the agent runs. `prdArea` allows any new file under `_runs/prds/`. After the agent returns, stamp and check use that same path (lines 351–355), and `git add --all` commits it, absolute clone paths included. The commit pins file stays in the Run folder, outside the worktree. Rewrite the PRD pins from the fetched repos after the agent returns, and keep that file out of the agent's write set.

**Medium — a per-product folder index is rejected.** `prdArea` allows `products/<product>/prds/<file>.md`, experiment pages, and only `products/shared/index.md`. `products/inpix/index.md` is an add outside that set, so the whole run is rejected and nothing is committed. The new test covers the shared index only. The same parent index for any other product needs to be allowed.

**Medium — the docs branch moves before the inbox update is recorded.** `update-ref` runs, then `moveOut`, then `docs.json` is written (lines 369–380). `done` requires the page to be in this worktree's edits. If the process stops after the ref moves, a re-run does not see a new edit and leaves the file in the inbox; `--force` does not put it back. A duplicate `prds` entry throws on the second `renameSync` in that same window, after the branch has already moved. Write the outcome, and move the files, in an order a re-run can finish. Dedupe `prds` and `skipped` before moving.

**Medium — sending a skipped Discord file back drops the message link.** `moveOut` rekeys `sources.json` from `Paywall.pdf` to `skipped/Paywall.pdf`. The next Run reads only the waiting file's name (`inboxSources[file]?.message`, line 303). The Brief tells Saransh to move the file back into the inbox for another try (`skippedLines` in `steps/brief.ts`). That retry commits the page with `discordMessage: null`. `citeSource` also returns without writing when the page has no frontmatter, and the file still moves to `done/`. Look up `skipped/<name>` and `done/<name>` when a waiting file has no entry, and treat a missing citation as not done.

**Medium — pages linked from a PRD are stamped with the commit pins.** Existing pages are status `M`, so they go through `updated` and are stamped and checked with `pinsFile`, which lists only repos that have new commits (lines 347–350). The instructions tell the agent to link those tech pages while tracing at `prdPinsFile`, which lists every repo fetched in the Run. A citation of a repo that did not change this Run is checked against the smaller pins file.

**Medium — `finish` cannot succeed for a PRD page during the agent turn.** `agents/docs/tools/finish` exits 0 only when check reports no errors. The instructions say the uncommitted `wiki@` source is an expected stamp error until the step commits the copy, which happens after the agent returns. The page-update rule still says to rerun `finish` until it exits 0. A PRD run can spend the new 200 turns and 3600 seconds on an error the agent cannot clear.

**Low — Brief crashes on a `docs.json` from before this change.** `docs.prds.length` (lines 99 and 111) throws when `prds` is absent. `skipped` is read with optional chaining. Re-running Brief on an existing Run folder hits the throw. Default both arrays to empty.

**Tests.** The suite stands in for the agent and writes the wiki files itself. Nothing runs `agents/docs/tools/prd`, rejects a modified checker, allows `products/<product>/index.md`, or covers a skipped file moved back into the inbox.

## Standards

**Hard.** `test/helpers.ts`, `test/docs.test.ts`. The wiki-tool stand-in now records `git rev-parse HEAD`. The test "a PRD's copy is committed before the wiki's tools run" asserts `runs[1].head` is the copy commit and that its parent is `main`. That checks the Step's internal order (commit the copies, then run stamp). The pins file on the branch is checked separately, and that part is fine.

Standard: `docs/prd.md`, Testing Decisions — a test "checks only the files the Step wrote and its exit code"; it "asserts on files, exit codes and git state that Saransh would notice" and "doesn't assert on how a Step is written inside"; "Tests never reach into a Step's internals." The stand-in boundary in that section is what the Worker CLI was called with and what its folder held.

**Judgement.** `steps/docs.ts`, `src/prd-inbox.ts`. Docs reads the PRD inbox (`waitingFiles`, `readInboxSources`) and writes `done/` and `skipped/` (`moveOut`). ADR 0001 and `docs/prd.md`, "The Step contract": a Step reads inputs only from the Run folder and state, and writes outputs only there. The data-area paragraph lists the inbox apart from state. Discord already writes the inbox; this is the first Step that takes it as an input. Whether the inbox counts as state is the call. The Docs bullets in that same section ask for this I/O.

`steps/docs.ts`. `moveOut` runs before `docs.json` is written, and the re-run skip looks only at that file (`updated`, `no-edits`, `nothing-to-update`). A crash in between leaves a re-run that does not skip and no longer sees those files. `--force` re-enters the Step and does not put the files back, so it does not redo the PRD work. Standard: same section — "safe to re-run: it skips work whose output already exists unless forced," and "`--force` redoes work whose output exists."

`test/docs.test.ts`. That test's exact `regions` / `stamp` / `check` argument list is the same kind of assertion the existing page-update test already makes on `toolRuns()`. Same Testing Decisions rule; a judgement call because that file already uses the wiki-tool stand-in as a boundary.

Glossary terms in the new code (PRD inbox, Codebase, Repo, Step, Agent, Tool) match `GLOSSARY.md`.

## Spec

### (a) Missing or partial

- **Not every inbox file is decided and written up.** A `.doc` is skipped unread (`prd` exits and the instructions say to skip it). A PRD whose Codebase has no `_sources/` folder is skipped and moved to `skipped/`. Spec: "For each file it decides whether it is a PRD and which Codebase it belongs to, copies it into that Codebase's PRD sources on the docs branch, and writes the PRD page with the wiki's PRD skill."
- **An unclassified file can be left behind on a successful Run.** Files absent from both `prds` and `skipped` stay in the inbox, the step still exits 0 (`updated` or `no-edits`), and a same-Run re-run skips because that status is "finished." Spec: "The Docs Agent takes every file in the PRD inbox each Run."
- **Non-PRDs are not set aside when the wiki write fails.** `handled` is assigned only for `updated` and `no-edits`. On `check-failed` or `rejected`, files the agent called non-PRDs stay in the inbox. Spec: "files that aren't PRDs to a skipped area, so the inbox shows only what's waiting."

### (b) Not asked for

- **The Brief tells Saransh to move a skipped file back** into the inbox. Spec: "The Brief lists the PRDs processed and the files skipped." No retry procedure.
- **`_runs/prds/pins.txt` is committed on the docs branch**, including local clone paths. Ticket 10 kept pins in the Run folder. The spec's wiki output is the PRD page and its copy.

### (c) Implemented but wrong

- **A PRD already committed is not moved on retry.** `update-ref` runs before `moveOut`. `done` requires the page to be in this worktree's edits. If the process stops after the branch moves, or `moveOut` throws before `docs.json` is written, a re-run sees no new edit and leaves the file in the inbox. Spec: "Processed files move to a done area … so the inbox shows only what's waiting."
- **Putting a skipped Discord file back drops the citation.** The entry is rekeyed to `skipped/<name>`, but the next Run reads `sources.json` only by the waiting file name, so `discordMessage` is null and the page is committed with no message link. Spec: "A PRD that came from Discord cites the Discord message link in its page's sources: the inbox's `sources.json` has it, by file name."
- **That citation is not required for `done`.** `citeSource` returns without writing when the page has no frontmatter, and the file still moves to `done/`. Same spec line.
