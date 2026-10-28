# Consolidated code, PRD and issue review — 26 October 2026

Reviewed **26 October 2026**, against **`4b4478b1f58718abd110cc157be1381388bdd995` plus the working-tree snapshot captured at 11:50:55 SGT**. Incremental scope: **`82ba67e` → that snapshot**. This includes Windows support, the agents-repo implementation associated with issues 17–25, Worker selection, weekly Runs, Discord attachment saving, HTML Briefs and the in-progress sprint reports. The checkout changed during the review, so validation uses a fixed temporary copy; later edits are outside this pass. The review also rechecks C01–C23 and the stocks PRD/issues through 47. Implementations in ash_new and ash_backend are not included; their issue completion notes are not independent verification.

This is the consolidated report now located at `docs/review-all-astra.md`; the former `docs/review-through-issue-03.md` is absent from this checkout. It retains the original finding and decision identifiers, including the supplied “The pipeline’s shape holds together…” review. Recommendations are proposals, not silently changed requirements.

**Assessment: 16 earlier findings closed within their stated scope; 18 open findings, including 3 partially fixed earlier findings and 11 new findings (C24–C34).** C22 is now fixed. C06, C08, C12, C19–C21 and C23 remain open. Typechecking passes. The fixed-snapshot suite reports **300 passed, 2 failed, 3 skipped (305 total)**; one failure passes in isolation, while the schedule-fixture failure is repeatable (C34). Only this report was edited by this review.

## 1. Open implementation findings

### C12 — [P1] Run trusted wiki tools throughout the Agent call — partially fixed

**Evidence:** [finish:17](/Users/khannasaransh/Saransh/agents/agents/docs/tools/finish:17), [steps/docs.ts:211](/Users/khannasaransh/Saransh/agents/steps/docs.ts:211), [Claude Code allowlist](/Users/khannasaransh/Saransh/agents/src/workers/claude-code.ts:33).

The post-call guard now rejects changed tools, templates and instructions before the Step validates or commits them. This closes the original altered-checker publication reproduction. However, the Agent still has write access to the whole worktree and an allowlisted `finish` command that executes `_wiki/tools/*.mjs` from that worktree **during** its call, before the guard. `prd` similarly invokes the mutable `docx2md.mjs`. A direct Tool-boundary reproduction replaced `regions.mjs` with a harmless marker writer; `finish` executed it and created a file outside the temporary wiki. No live Worker permission enforcement was tested. Rejecting the final diff cannot undo an earlier execution.

A second scope gap remains: every existing content page passes `isPage`, even when absent from the selected pages and unrelated to the PRD. A stand-in changed an unrelated repo page and Docs committed it successfully, without listing it in the Agent's output.

**Acceptance:** use trusted, immutable tool code and dependencies for both Agent Tools and Step validation, and constrain edited pages to selected pages plus explicitly permitted PRD links/indexes. Test an attempted tool replacement before `finish`, and unrelated page edits.

### C06 — [P1] Verify PM coverage before acknowledging its backlog — partially fixed

**Evidence:** [steps/save-state.ts:88](/Users/khannasaransh/Saransh/agents/steps/save-state.ts:88), [src/pm-inputs.ts:82](/Users/khannasaransh/Saransh/agents/src/pm-inputs.ts:82).

Ordinary PM failure is now recovered: Save state retains that Run in the PM backlog, and a later PM receives its reviews, commits and messages. But acknowledgement tests only `status === 'answered'` and the recorded Run IDs, without checking the stored input fingerprint. If upstream work is retried after PM answered and Save state is run without recomputing PM, the stale answer clears unprocessed inputs. Reproduction: PM answered on a backlog Run; another message was added to that Run; Save state emptied the backlog; the next PM never received the new request. Brief's stale warning does not restore the backlog.

**Acceptance:** acknowledge only matching input versions. Preserve/requeue changed covered Runs and the current Run until a fresh PM answer covers them. Add the upstream-retry → Save-state → quiet-next-Run test.

### C21 — [P1] Remove complete TOML secret values during capture — still open, issue 14

**Evidence:** [src/worker-config.ts:269](/Users/khannasaransh/Saransh/agents/src/worker-config.ts:269).

`captureText` removes one line when a key such as `password` contains a quoted value. A valid multiline TOML string loses only its opening assignment; its contents and closing delimiter are retained. The fallback scanner recognizes selected token formats, so an ordinary password is not caught. Capturing a temporary config with a synthetic multiline password wrote that password into the repo-shaped output and also made the TOML invalid. This contradicts issue 14's secret-exclusion requirement. No real secret was used or exposed in the reproduction.

**Acceptance:** parse TOML values or reject unsupported syntax before writing any captured files. Cover basic/literal multiline strings and validate the resulting config; no secret bytes should appear in captured files or error output.

### C24 — [P1] Exclude descendants of a reused Windows PID — new

**Evidence:** [src/process-tree.ts:40](/Users/khannasaransh/Saransh/agents/src/process-tree.ts:40).

`processTree` rejects a root whose creation time is outside the recorded start window, but still visits children using the old lower bound. If that PID has been reused, children of the replacement process pass the test and are returned to `killAll` during cleanup. A synthetic PowerShell listing with a replacement root and its later child returned the unrelated child as a kill target. The original record can remain locked by an older orphan while the root PID is reused; the lock does not make the replacement root's descendants safe to kill. No real process was killed in the reproduction.

**Acceptance:** Bound descendant ownership by the observed PID generation, or maintain reliable process-tree ownership. Test both surviving original children and newer children of a replacement root; the latter must never be returned.

### C25 — [P1] Clean up Windows children even after the output pipes close — new

**Evidence:** [src/process.ts:103](/Users/khannasaransh/Saransh/agents/src/process.ts:103).

The Windows exit handler only calls `endTree()` when `close` has not fired after 200 ms. A child started with ignored/redirected stdio and without the inherited record descriptor lets its parent close immediately, so cleanup removes the record without inspecting or stopping that child. It can continue changing files after the Step and overlap the next Run. A controlled event/Process API fixture exercised this Windows branch: exit → close → delayed callback removed the record and never called tree cleanup. Existing child-survival tests retain output/record descriptors, which misses this path. This reopens C01's guarantee for Windows, while its original macOS fix remains valid.

**Acceptance:** Establish and stop the owned Windows descendants independently of open output pipes, before releasing tracking. Add a native Windows test with redirected stdio and no inherited record handle.

### C19 — [P2] Match resumed inbox moves to the original input — still open, review fix

**Evidence:** [steps/docs.ts:283](/Users/khannasaransh/Saransh/agents/steps/docs.ts:283), [src/prd-inbox.ts](/Users/khannasaransh/Saransh/agents/src/prd-inbox.ts).

Docs replays `moveOut(movesOf(earlier))` on every retry before checking `--force`. The recorded result identifies inputs only by filename. After an old file was processed, a different file arriving under the same name is therefore moved to done/skipped using the old decision. This also defeats restoring a skipped file and forcing the same Run. Reproduction: skip `notes.md`, place a new PRD at `notes.md`, then force Docs; it moved the new file into skipped without another Worker call.

**Acceptance:** record an input identity/content digest and explicit move completion. Resume only an unfinished move for that exact input. Test replacement files, deliberate restores, and forced retries after completed moves. The original commit-before-move recovery C14 is fixed; this is a distinct regression in its replay logic.

### C20 — [P2] Make Fetch use the destinations created by setup — still open, issue 13

**Evidence:** [src/setup.ts:42](/Users/khannasaransh/Saransh/agents/src/setup.ts:42), [src/repos.ts:24](/Users/khannasaransh/Saransh/agents/src/repos.ts:24).

Setup clones to `<root>/<team>/<name>`, but persists no machine-local path mapping. `loadRepos` continues to use `repo.folder`, expanding only `~`. A custom root is ignored by subsequent Runs; even the default fresh-machine layout places data repos under `data/` while the committed inventory points to `backend/`. A temporary setup cloned successfully into the chosen root, but Fetch still attempted the old path and failed when it was absent. The setup checklist does not resolve this mismatch.

**Acceptance:** share machine-local path resolution between setup and the Pipeline while preserving existing clone overrides. Test setup followed by Fetch for a custom root and a data-team repo, without manually editing the inventory.

### C08 — [P2] Include all effective PM inputs in freshness checks — partially fixed

**Evidence:** [steps/pm.ts:98](/Users/khannasaransh/Saransh/agents/steps/pm.ts:98), [steps/pm.ts:123](/Users/khannasaransh/Saransh/agents/steps/pm.ts:123).

The new fingerprint correctly invalidates changed reviews, commits and Discord messages, and Brief warns about these mismatches. It excludes `memory` and `runHealth`, although both are supplied to PM, and tests only the old covered Run list rather than newly pending backlog Runs. Reproduction: PM answered, its Memory was manually edited with a new open item, then PM was rerun normally; it skipped the Worker. A repaired fetch failure with no new commits can likewise leave obsolete health To-dos without a freshness warning. The new `sprint` and `previousTaskStatus` inputs are also excluded: changing only `sprint.json` after PM answered reproduced the same silent reuse.

**Acceptance:** define a complete input identity, including health, sprint data/history, the intended covered Runs and externally changed Memory. Account for Memory written by this very answer so an ordinary replay remains idempotent. Test manual edits, repaired health and newly queued backlog entries.

### C26 — [P2] Resume the status read after a successful Lake refresh — new

**Evidence:** [steps/stocks/lake.ts:60](/Users/khannasaransh/Saransh/agents/steps/stocks/lake.ts:60).

Lake writes `refreshed: true` before `pd status`. If the status read fails, the next ordinary retry returns immediately from this cache check, marks the Step successful, and leaves `lake/status.json` absent. Reproduction: refresh succeeds, status fails, status becomes available, retry succeeds without any new `pd` call. The Brief still has an unknown gate, and schedule warnings were never produced.

**Acceptance:** Track refresh completion separately from status/To-do completion. Resume the missing read without repeating a successful refresh, and only report success when required outputs are complete.

### C27 — [P2] Persist the first weekly range when its review fails — new

**Evidence:** [steps/save-state.ts:124](/Users/khannasaransh/Saransh/agents/steps/save-state.ts:124).

The first weekly Fetch derives a starting commit from the current seven-day window, but Save state stores nothing when that review fails. At the next weekly Run there is still no cursor, so Fetch computes a newer window and skips the failed week's commits. A temporary repo reproduced this: the failed eight-day-old commit became the next Run's lower bound, and only the new two-day-old commit was reviewed. This contradicts the log's promise that the next Run reviews the failure again.

**Acceptance:** Persist the initial lower bound independently of successful review advancement, or recover the earliest unreviewed range from recorded Runs. Test a first-week failure followed by the following week's Fetch.

### C28 — [P2] Treat a timed-out refresh as failed regardless of its exit code — new

**Evidence:** [steps/stocks/lake.ts:82](/Users/khannasaransh/Saransh/agents/steps/stocks/lake.ts:82).

Refresh success checks only `exitCode === 0`, despite recording `timedOut`. On macOS a command can handle SIGTERM and exit zero during the grace period. A stand-in did this after a 0.3-second timeout: Lake recorded `timedOut: true`, marked itself refreshed, skipped the retry and succeeded. A command interrupted before completing must not be cached as a completed refresh.

**Acceptance:** Require both a zero exit and `!timedOut`, and cover graceful zero-exit termination in the retry test.

### C29 — [P2] Reserve the attachment manifest filename — new

**Evidence:** [steps/discord.ts:221](/Users/khannasaransh/Saransh/agents/steps/discord.ts:221).

Saving every attachment introduces JSON files into `data/other`. When its first attachment is named `sources.json`, `freeName` finds that name unused; the download is written there and immediately overwritten by `writeInboxSources`. The manifest then records that attachment as downloaded, so subsequent Runs skip it. Calling the actual save function with a temporary folder and mocked CDN response confirmed the content loss.

**Acceptance:** Reserve metadata names, including the manifest's temporary filename, before allocating a download path. Test the first attachment named `sources.json` and keep its bytes under a different name.

### C30 — [P2] Pass the Run’s Worker selection to the Health Agent — new

**Evidence:** [steps/stocks/health.ts:117](/Users/khannasaransh/Saransh/agents/steps/stocks/health.ts:117).

Review, PM and Docs pass `run.worker` into `callAgent`; Health passes only `dryRun`. A stocks Run recorded with `worker: 'codex'` therefore still starts Health on Claude Code. The stand-in reproduction confirmed one Claude call and no Codex call. This violates the CLI's promise that `--worker` chooses the first Worker for every Agent and can use the provider the user was trying to avoid.

**Acceptance:** Forward the persisted Worker selection for Health, retain the normal fallback contract, and cover the stocks Pipeline as well as daily PM in override tests.

### C31 — [P2] Invalidate Health’s cached status when the Lake changes — new

**Evidence:** [steps/stocks/health.ts:95](/Users/khannasaransh/Saransh/agents/steps/stocks/health.ts:95).

Health removes only `health.json` when a refreshed Lake is healthy, leaving `health/status.json` from an earlier proposal attempt. The Stocks Brief unconditionally prefers that old status for Corrections and Quarantines. A reproduction diagnosed flagged data, then supplied a clean refreshed Lake and reran Health/Brief: Health skipped, but the Brief still offered approval for Correction 7 even though the current status had no pending items. Old status can also hide newly pending items when a later diagnosis proposes no corrections or its status read fails.

**Acceptance:** Tie `health/status.json` to the Lake/diagnosis version and invalidate it before replacement work or a healthy skip. Prefer only a verified newer status when rendering pending Answers.

### C32 — [P2] Page back far enough to find the current sprint post — new

**Evidence:** [steps/discord.ts:282](/Users/khannasaransh/Saransh/agents/steps/discord.ts:282).

`readSprintPost` fetches exactly the latest 100 channel messages and never follows `before`. After 100 ordinary messages follow the sprint task list, `latestPost` returns null and a new Run silently loses the whole task-status report, although that sprint is still current. A multi-message task list crossing the page boundary is also truncated. This is distinct from C15: archived-thread enumeration paginates, but the new sprint-post lookup does not.

**Acceptance:** Search paginated history until the current post and its full message group are found, or use a persisted/configured post identity. Cover more than 100 subsequent messages and a post split across pages.

### C33 — [P2] Exclude dry-run task reports from real sprint history — new

**Evidence:** [steps/pm.ts:69](/Users/khannasaransh/Saransh/agents/steps/pm.ts:69).

`previousReport` selects the latest earlier answered `pm.json` for a post without checking that Run's `dryRun` flag. The fake Worker's empty `taskStatus` becomes a report of `no-signal` for every task. In a real → dry-run → real reproduction, the real PM received that fake `no-signal` report instead of the earlier real `done` state and production evidence. Instructions explicitly tell the Agent to carry previous status forward, so a dry run changes effective input to later real work.

**Acceptance:** Skip dry-run reports when selecting real history, and preserve the last real report across intervening dry Runs. Test the real → dry-run → real sequence.

### C34 — [P2] Make the scheduled-start test independent of an installed ash_new checkout — new

**Evidence:** [test/schedule.test.ts:254](/Users/khannasaransh/Saransh/agents/test/schedule.test.ts:254).

This test supplies `status.healthy.json`, which contains five flags and therefore invokes Health, but prepares no ash_new directory or `ASH_NEW_FOLDER`. In the fixed temporary checkout the scheduled dry Run correctly ends partial because Health cannot find ash_new; the test expects exit zero and fails repeatedly. Passing can depend on an unrelated sibling checkout existing on the developer's machine. The failure is a missing fixture, not evidence that `--env` failed.

**Acceptance:** Use the clean status fixture if this test is about environment propagation, or prepare a temporary ash_new directory as the other stocks tests do. It must pass from a checkout without ash_new installed.

### C23 — [P3] Make the installed status line's date formatting work on macOS — still open, issue 14

**Evidence:** [statusline.sh:73](/Users/khannasaransh/Saransh/agents/worker-config/claude-code/.claude/statusline.sh:73), [statusline.sh:91](/Users/khannasaransh/Saransh/agents/worker-config/claude-code/.claude/statusline.sh:91).

The captured script uses GNU `date -d` for reset timestamps. Setup installs it unchanged on macOS, where the system date command rejects that option; stderr is suppressed. A fixture with both reset timestamps displayed only `tmp | 5h:12% 7d:34%`, omitting both reset times and the countdown. Use portable formatting or branch by the available date implementation, and test both supported OS environments.

## 2. Fixed implementation findings

“Fixed” means the original reproduced defect is addressed by current code and the relevant passing checks, subject to the limits below. It does not imply every related design problem is closed.

| ID | Status | Current evidence |
| --- | --- | --- |
| C01 — Surviving children after runner death | **Original macOS defect fixed; Windows gap open as C25** | Process records and lock recovery cover the original macOS crash cases. The new Windows implementation does not cover children that close inherited output/record handles. C24 is a separate Windows PID-identity defect. |
| C02 — Non-atomic stale-lock takeover | **Fixed** | OS file locking replaces stale-file unlink/recreate ownership; simultaneous takeover coverage passes. |
| C03 — Codex implicitly writable working directory | **Fixed in command construction** | Read-only is extended only by declared write roots in `src/workers/codex.ts`. Argument tests pass; live enforcement remains unverified. |
| C04 — Brief before Save state | **Fixed** | `pipelines/daily.ts` puts Brief last, including Save state health in its output. |
| C05 — Old review against new fetched commits | **Fixed** | Brief filters review results by matching repo and commit range. |
| C07 — Older proposals overwrite newer Memory | **Fixed for versioned results** | Review and PM record `memoryRead`; Save state queues a proposal if its base differs. A newer queued Run cannot be replaced by an older one. Legacy proposals lacking a base still bypass this protection; see D02. |
| C09 — Decisions ignore corrected proposal content | **Fixed for versioned decisions** | `src/memory.ts` stores and compares `proposed`; identical replay is settled, a corrected proposal is not. Legacy decisions without `proposed` retain the old compatibility behavior. |
| C10 — Approval deletes a replacement proposal | **Fixed** | Memory accept/reject takes the Run lock; `decideProposal` removes only the exact proposal text it read. |
| C11 — Failed Docs work lost after Review succeeds | **Fixed for recorded Docs attempts** | Independent `lastDocumented` ranges survive failure and feed later Docs work even when Fetch says unchanged. New consumer initialization/backfill remains D01. |
| C13 — Ignored regions/stamp failures | **Fixed** | Both the Step and `finish` stop on nonzero preparation-tool exits. Failure-path checks pass. |
| C14 — Commit-before-inbox-move retry stuck | **Fixed for the original interrupted input** | Docs persists its outcome before updating the branch, checks that the commit landed, and resumes moves without requiring another page edit. The new same-name replay regression is C19. |
| C15 — Only first archived-thread page | **Fixed** | Discord follows `has_more` with `before` until the time boundary; pagination test passes. |
| C16 — Malformed message URL aborts ingestion | **Fixed** | URL parsing can return null and the malformed candidate is ignored; mixed malformed/valid-link test passes. |
| C17 — Worker failure hides existing docs branch | **Fixed for updateWiki failures** | The catch writes `status: failed` and available waiting state; Brief renders it. Early configuration errors before the catch are outside this guarantee. |
| C18 — Ordinary skipped-file restore loses provenance | **Fixed for an unchanged restored filename** | `reclaimMovedBack` rekeys the old manifest entry before inputs are built. Next-Run restore/citation coverage passes; same-Run forced replay remains C19. |

| C22 — Docs page-order test failure | **Fixed** | `changesIn` now sorts paths deterministically (`steps/docs.ts:170`). The PRD backlink/stamping test passes in the snapshot suite. |

The separate issue-11 review's path-traversal cases in `prd`, mutable PRD pins, per-product index rejection, duplicate moves, missing frontmatter citation, discarded skipped-file outcomes, legacy Brief arrays and contradictory `finish` instructions also have specific fixes. PRD pins now live outside the writable worktree. Backlink stamping uses PRD pins, and deterministic sorting closes C22. Tool execution trust remains C12. Old `.doc` handling, unknown Codebases and unclassified inputs should remain explicit product decisions rather than being called supported automatically.

## 3. Cross-cutting design and recovery work

### D01 — Independent consumer progress — partly implemented

PM has a backlog and Docs has its own cursor. Weekly has separate repo, Discord and PM-backlog state, but its first failed range is not retained (C27). C06 still blocks correct acknowledgement after upstream retry. Define initialization/backfill when Docs is first configured or when upgrading from pre-backlog Runs: an unchanged Fetch currently initializes missing Docs state at the current head, and historical failed PM Runs are not automatically scanned. Also specify interruption recovery if ingestion/review progress persists but Save state never registers the downstream work.

### D02 — Replay-safe Memory and PRD transactions — partly implemented

C07/C09/C10/C14/C18 close their ordinary paths. Retain the remaining boundaries: Memory write before decision write; inbox rename before manifest persistence; and legacy proposals/results without versions. The manifest now saves **after each move**, rather than after the whole batch, but a crash between a rename and that write can still separate identity from provenance. C19 demonstrates why filenames alone are insufficient. Use stable identities and a recoverable outcome record, and exercise these boundaries with fault injection. Decide how old results are migrated rather than treating missing metadata as verified freshness.

### D03 — Writable Worker fallback semantics — pending decision

The fallback still inherits the primary's partially edited worktree and original prompt. The earlier reproduction committed inherited edits even when the fallback reported no pages. Choose deliberate continuation with explicit inherited-change disclosure and reconciliation, or a clean restart. This is a policy/integration decision; preserving partial work is not inherently incorrect.

## 4. Original supplied-review claims and pending decisions

All V01–V18 identifiers are retained. Resolved means the earlier ambiguity has an implementation or documented choice; it does not imply live integration verification.

| ID | Current status | Resolution or remaining decision |
| --- | --- | --- |
| V01 — Skipped Steps | **Resolved** | Exit 78 records optional skips; they do not make a Run partial but remain visible in health. PRD, ADR and implementation agree, and the user story requires partial status for failed Steps. |
| V02 — “Never merge” | **Resolved** | Issue 10 and `.env.example` now distinguish main → docs integration from the prohibited docs → main merge and pushing. |
| V03 — To-do rules and ownership | **Partly decided; policy pending** | PM owns download-link To-dos; issue 9 explicitly says they are absent after PM failure. That choice is documented; C06 addresses recovery. Define identity, completion, dismissal and carry-forward. PRD Further Notes requires settled rules before PM ships, while issue 7 leaves them open. Decide how wiki drafts reach PM, which runs before Docs and receives no docs-state input. |
| V04 — Baseline ownership | **Closed: proposed change unnecessary** | Fetch records baseline output and Save state persists it. Later ranges advance after successful real reviews. Keep this separation and clarify older ticket wording rather than moving persistence into Fetch. |
| V05 — Schedule and installer | **Implemented; rollout pending** | Issue 12 is done. Schedule definitions use the machine’s local clock, and `agents schedule install` generates launchd entries on Mac and Task Scheduler entries on Windows. Timezone changes therefore change the corresponding IST time. Setup and schedule installation remain separate commands; decide whether a setup reminder is wanted. |
| V06 — Second opinion and cost signal | **Pending clarification** | Record the usual writing model and whether fallback may sacrifice model independence. Logs identify Worker/model/effort; structured provenance would improve auditing. Repos reviewed is a rough cost signal, not an attempt/token/billing count. |
| V07 — Step definition and I/O | **Partly resolved** | Sequential Review → Discord → PM order is explicit. The [glossary](/Users/khannasaransh/Saransh/agents/GLOSSARY.md:31) still defines a Step as one Agent call although Review contains several. The [PRD contract](/Users/khannasaransh/Saransh/agents/docs/prd/prd.md:161) excludes required repo, Memory, inbox and wiki access. Specify resource access and side effects per Step. |
| V08 — Wiki configuration and lifecycle | **Mostly implemented; decisions pending** | `WIKI_FOLDER`, local `main`, rolling `agents/docs`, checkout identity, Agent/Run trailers, isolation and conflicts are concrete. Specify whether squash/rebase merges are supported; ancestry handles ordinary merges. Define “large changes,” since every undocumented Repo with any commit is reported. Decide retention of rejected/failed work, currently removed with temporary worktrees. Real wiki compatibility remains unverified. |
| V09 — Discord access and provenance | **Implemented for the stated scope; recovery limits remain** | Public archived threads paginate, malformed URLs are ignored, and ordinary skipped-file restores recover provenance (C15/C16/C18 fixed). Private archives/forums remain a scope decision. Input identity and interruption recovery remain D02 and C19. |
| V10 — Repo seed metadata | **Closed as an implementation complaint** | The committed [Repo list](/Users/khannasaransh/Saransh/agents/repos.ts) already carries branch/folder metadata. Do not create a competing inventory from the abbreviated PRD. The prior review counted 29 Repos and recorded exceptions; the inventory is unchanged. Remote branch correctness was not audited. |
| V11 — Existing clones and fresh-machine paths | **Implementation defect confirmed: C20** | Setup now clones into root/Team/name, but Pipeline resolution still uses the old configured folder. Existing clones must remain supported while fresh-machine destinations become discoverable. |
| V12 — Review/retry/dry-run choices | **Mostly implemented; boundaries need clarity** | Severities, concurrency, worktree ownership, schema fallback and range-aware Review reuse exist. Saransh-first sorting is tested policy; severity-first would be a change. Dry run replaces Workers, but Fetch/Discord still read external systems and initial baselines can persist. Fake work does not advance Discord cursor, Memory or inbox moves. C08 covers the remaining PM freshness gaps; fake sprint reports still leak into real task history (C33). |
| V13 — Worker/fallback policy | **Implementation gap resolved; live verification pending** | Antigravity exists as a fallback. PM and Docs name Claude Code primary and Codex fallback configurations. Older statements that they do not exist are obsolete. Argument/stand-in tests do not establish effective live-CLI isolation; retain that gate and V06's model-independence decision. |
| V14 — Tools/skills dependency | **Dependency resolved; trust boundary pending** | Issue 10 now depends on issue 4. Docs declares its Tools and adapts the wiki skill explicitly. Real wiki compatibility remains unverified, and C12 still applies to Tools invoked during the Agent call. |
| V15 — Schedule readiness and refused starts | **Refusal behavior resolved; readiness pending** | Lock refusal skips the invocation and is durably recorded in scheduled-starts.log; it does not queue a replacement. Define operational readiness before enabling unattended Runs. No real schedule was installed in this review. |
| V16 — LaunchAgent environment and compatibility | **Mostly implemented; live checks pending** | Explicit PATH, absolute Node path, data directory, log directory, local time and no RunAtLoad are specified and tested as generated config. Issue 12 documents sleep/off behavior. Real launchd loading, credentials and Windows execution were not tested here. Node 26 is now required and enforced at CLI startup. Issue 18 records a prior scratch Task Scheduler registration, which this review did not repeat. Windows cleanup has C24/C25. The installed status line has a Mac portability defect (C23). |
| V17 — Issue status and documentation | **Partly resolved** | Issues 6–14 are marked done; issues 1–5 still say ready-for-agent with unchecked criteria. Reconcile them with implementation evidence while retaining the live-CLI gaps and open defects. Issues 17–25 now contain completion notes, while issue 16 still has its Mac check unchecked. The agents-side Steps were reviewed; ash_new/ash_backend changes were not. Later issues through 47 remain planned, so their absent implementation is not automatically a defect. |
| V18 — Preserve issue-specific requirements | **Retained** | Rate limits, cursors, deduplication, conflict handling, tool checks, backups, path rewriting and secret exclusion remain requirements. Setup and scheduling now exist, with C20/C21/C23 remaining. Interactive Worker config must not broaden Pipeline Agent permissions. |


### Additional retained daily-Pipeline decisions

- **PRD replacement:** define when a repeated basename is a revision versus a separate source. Wiki copies currently replace by Codebase/basename; input identity and deliberate restores also need C19/D02.
- **Generated edits:** specify allowed indexes/backlinks, draft status and validation; C12 still permits unrelated existing content pages.
- **Incomplete Run data:** specify cache invalidation for Docs and Discord when upstream inputs change. PM's remaining freshness defects are C08.
- **Unclassified input:** a successful Docs result may leave files absent from both `prds` and `skipped`. Decide whether that is a partial outcome and how Brief reports it; neither a successful exit nor a done checkbox guarantees every waiting file was classified.

## 5. Stocks PRD and issue decisions

These are contract decisions for remaining work, separate from the implemented-Step defects above. ADRs 0003/0004 explicitly permit Portfolio Manager changes within a Playbook and establish a rules-only paper baseline; those are intentional policy changes. References are to this repo's [stocks PRD](/Users/khannasaransh/Saransh/agents/docs/prd/stocks-pipeline.md) and its issues. Backtest figures, market-data correctness, tax assumptions and external repository implementations were not validated.

| ID | Status | Concrete gap and proposed acceptance |
| --- | --- | --- |
| S01 — Fresh events before selecting the Desk's names | **Pending ordering decision** | The PRD and issue 37 build dossiers and the event-dependent review list in Plan, then fetch Feeds. A holding whose event is first discovered by that fetch can be absent from today's Desk input. Fetch holdings events before selection, or explicitly rebuild/enrich the list and dossiers after Feeds. Test a previously uncached imminent event. |
| S02 — Demotions before effective order generation | **Pending ordering decision** | The PRD places Plan before Review, while issue 35 automatically demotes strategies in Review. Clarify whether today's orders must use the new Stage; if so, recompute/revalidate plans after demotion. Test a Saturday demotion affecting a buy already in the plan. |
| S03 — Replay, missing inputs and session identity | **Partly resolved in the specification; implementation pending** | The PRD now blocks Check when Plan failed, checks Book/Mandate/Playbook versions, supersedes a prior same-session list without duplicate orders, and issue 42 prevents late Answers reviving expired orders. Issues 23/24 describe broker deduplication, but its implementation lives outside this review. Retain concrete retry/forced-Step and supersession tests, especially orders already placed or partially filled, overlapping exports and delayed promotion Answers. |
| S04 — Yearly rebalance parity | **Contract mismatch to resolve** | Issue 27 reweights in the first session of April; issue 45 proposes changes on the first Saturday and applies them only after an Answer. Those can produce different effective sessions despite the shared-engine parity requirement. Specify effective dates and approval delay in the backtest/live contract, with a parity test spanning April. |

The Answers download workflow and broker-import ordering now have implementation and issue notes. Runtime upgrade is implemented. The remaining explicit choices include Book capital, Market-condition thresholds, exposure levels, Playbook ranges, the paper-versus-rules-only comparison bar, the Sash app's future, broker samples/charges and cash-availability assumptions, feed access and web-search permissions. Windows sandbox enforcement remains a live-integration limit here. Issue 47 deliberately adds a one-Book shadow milestone; it is not a missed deliverable from issues 1–14.

## 6. Recommended follow-up order

1. Fix Windows process ownership/cleanup (C24/C25), wiki Tool execution trust (C12) and secret capture (C21).
2. Fix acknowledgement and input freshness (C06/C08), PRD identity (C19), weekly initialization (C27), and dry-run report isolation (C33).
3. Fix Lake retry/timeout handling (C26/C28), Health status freshness and Worker selection (C30/C31), and attachment filename collisions (C29).
4. Fix setup paths (C20), sprint-history pagination (C32), the schedule test fixture (C34) and Mac status-line formatting (C23).
5. Settle D01–D03 and the remaining S01–S04 contracts before the corresponding unattended behavior ships.

## 7. Verification and limits

- **Fixed scope:** snapshot at **26 October 2026, 11:50:55 SGT**, HEAD **`4b4478b`**, plus then-current uncommitted files. The snapshot is `/tmp/agents-review-oct26-snapshot-wn8ik3j3`; its per-file SHA-256 manifest is `/tmp/agents-review-oct26-snapshot.json`. Line references above refer to that snapshot and may shift as concurrent edits continue.
- **Node v26.12.1 on macOS. `npm run typecheck`: passed. `npm test`: 300 passed, 2 failed, 3 skipped (305 total).** The Codex timeout/fallback test passed when rerun alone; it remains an observed suite instability rather than a confirmed new production defect. The scheduled-start test fails alone too (C34). The three skips are one native Windows argument-parsing test and two ash_new schema/contract tests unavailable in the snapshot. This is not a fully green test gate.
- An earlier moving-checkout run passed 240 tests with 3 skips, but later changes expanded the suite; that result is superseded by the fixed-snapshot result. The first sandboxed run could not bind loopback sockets. Permitted runs supplied local socket access; those sandbox failures are not application bugs.
- Seven earlier reproductions still pass: mutable `finish` execution, unrelated wiki edits, same-name PRD replay, stale backlog acknowledgement, Memory-insensitive PM caching, setup/Fetch path mismatch and multiline-secret capture. C23's GNU `date -d` calls remain unchanged; the previous Mac reproduction remains applicable. C22's test now passes.
- New temporary checks reproduce the Lake status retry, zero-exit timeout, first-week review loss, attachment-manifest collision, ignored Health Worker override, stale Health pending items, dry-run sprint-history contamination and sprint-insensitive PM caching. Synthetic process listings reproduce the PID-reuse selection bug; mocked process events reproduce the Windows cleanup omission. These checks do not establish native Windows process or permission behavior. C32 is demonstrated by the single-page lookup's control flow; C34 by the failing test and its recorded Health error.
- Logs: `/tmp/agents-review-oct26-snapshot-tests.log`, `/tmp/agents-review-oct26-targeted-tests.log`, `/tmp/agents-review-oct26-snapshot-old-repros.log`, `/tmp/agents-review-oct26-snapshot-repros.log`, `/tmp/agents-review-oct26-extra-repros.log`. Reproduction scripts use the same basenames with `.mts` where applicable. They are review evidence, not committed regression coverage.
- No paid Worker call, company Discord access, real setup/schedule registration, production Lake/broker mutation or actual org-wiki integration was performed. Fixtures use temporary repos/homes, synthetic config and stand-in CLIs. External financial research, backtest results, tax assumptions and external-repository completion claims were not audited.
- Only `docs/review-all-astra.md` was edited by this review. Concurrent implementation edits and commits were preserved; no implementation fix, staging, commit, push or publication was performed by this review.
