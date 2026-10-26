# Consolidated implementation, PRD and issue review — through issue 14 and review fixes

Reviewed **25 October 2026** against commit **`82ba67e`** (`review fixes and improvements`), with a clean implementation working tree. Incremental scope: **`cc71556..82ba67e`**, covering the changes after the committed issue 11 implementation, including issues 12–14. Earlier C01–C18 findings were rechecked. The new stocks PRD and issues 15–45 were reviewed for contract consistency; their implementation in other repositories was not audited.

This is the consolidated report now located at `docs/review-all-astra.md`; the former `docs/review-through-issue-03.md` is absent from this checkout. It retains the original finding and decision identifiers, including the supplied “The pipeline’s shape holds together…” review. Recommendations are proposals, not silently changed requirements.

**Assessment: 15 earlier findings fixed, 3 partially fixed, and 5 new findings — 8 open implementation/test findings.** The remaining earlier findings are C06, C08 and C12. New findings are C19–C23. Typechecking passes; the full suite is **200/201 passing**, with the remaining test failure confirmed separately. Only this report was changed.

## 1. Open implementation findings

### C12 — [P1] Run trusted wiki tools throughout the Agent call — partially fixed

**Evidence:** [finish:17](/Users/khannasaransh/Saransh/agents/agents/docs/tools/finish:17), [steps/docs.ts:208](/Users/khannasaransh/Saransh/agents/steps/docs.ts:208), [Claude Code allowlist](/Users/khannasaransh/Saransh/agents/src/workers/claude-code.ts:25).

The post-call guard now rejects changed tools, templates and instructions before the Step validates or commits them. This closes the original altered-checker publication reproduction. However, the Agent still has write access to the whole worktree and an allowlisted `finish` command that executes `_wiki/tools/*.mjs` from that worktree **during** its call, before the guard. `prd` similarly invokes the mutable `docx2md.mjs`. A direct Tool-boundary reproduction replaced `regions.mjs` with a harmless marker writer; `finish` executed it and created a file outside the temporary wiki. No live Worker permission enforcement was tested. Rejecting the final diff cannot undo an earlier execution.

A second scope gap remains: every existing content page passes `isPage`, even when absent from the selected pages and unrelated to the PRD. A stand-in changed an unrelated repo page and Docs committed it successfully, without listing it in the Agent's output.

**Acceptance:** use trusted, immutable tool code and dependencies for both Agent Tools and Step validation, and constrain edited pages to selected pages plus explicitly permitted PRD links/indexes. Test an attempted tool replacement before `finish`, and unrelated page edits.

### C06 — [P1] Verify PM coverage before acknowledging its backlog — partially fixed

**Evidence:** [steps/save-state.ts:78](/Users/khannasaransh/Saransh/agents/steps/save-state.ts:78), [src/pm-inputs.ts:82](/Users/khannasaransh/Saransh/agents/src/pm-inputs.ts:82).

Ordinary PM failure is now recovered: Save state retains that Run in the PM backlog, and a later PM receives its reviews, commits and messages. But acknowledgement tests only `status === 'answered'` and the recorded Run IDs, without checking the stored input fingerprint. If upstream work is retried after PM answered and Save state is run without recomputing PM, the stale answer clears unprocessed inputs. Reproduction: PM answered on a backlog Run; another message was added to that Run; Save state emptied the backlog; the next PM never received the new request. Brief's stale warning does not restore the backlog.

**Acceptance:** acknowledge only matching input versions. Preserve/requeue changed covered Runs and the current Run until a fresh PM answer covers them. Add the upstream-retry → Save-state → quiet-next-Run test.

### C21 — [P1] Remove complete TOML secret values during capture — new, issue 14

**Evidence:** [src/worker-config.ts:269](/Users/khannasaransh/Saransh/agents/src/worker-config.ts:269).

`captureText` removes one line when a key such as `password` contains a quoted value. A valid multiline TOML string loses only its opening assignment; its contents and closing delimiter are retained. The fallback scanner recognizes selected token formats, so an ordinary password is not caught. Capturing a temporary config with a synthetic multiline password wrote that password into the repo-shaped output and also made the TOML invalid. This contradicts issue 14's secret-exclusion requirement. No real secret was used or exposed in the reproduction.

**Acceptance:** parse TOML values or reject unsupported syntax before writing any captured files. Cover basic/literal multiline strings and validate the resulting config; no secret bytes should appear in captured files or error output.

### C19 — [P2] Match resumed inbox moves to the original input — new, review fix

**Evidence:** [steps/docs.ts:278](/Users/khannasaransh/Saransh/agents/steps/docs.ts:278), [src/prd-inbox.ts](/Users/khannasaransh/Saransh/agents/src/prd-inbox.ts).

Docs replays `moveOut(movesOf(earlier))` on every retry before checking `--force`. The recorded result identifies inputs only by filename. After an old file was processed, a different file arriving under the same name is therefore moved to done/skipped using the old decision. This also defeats restoring a skipped file and forcing the same Run. Reproduction: skip `notes.md`, place a new PRD at `notes.md`, then force Docs; it moved the new file into skipped without another Worker call.

**Acceptance:** record an input identity/content digest and explicit move completion. Resume only an unfinished move for that exact input. Test replacement files, deliberate restores, and forced retries after completed moves. The original commit-before-move recovery C14 is fixed; this is a distinct regression in its replay logic.

### C20 — [P2] Make Fetch use the destinations created by setup — new, issue 13

**Evidence:** [src/setup.ts:42](/Users/khannasaransh/Saransh/agents/src/setup.ts:42), [src/repos.ts:24](/Users/khannasaransh/Saransh/agents/src/repos.ts:24).

Setup clones to `<root>/<team>/<name>`, but persists no machine-local path mapping. `loadRepos` continues to use `repo.folder`, expanding only `~`. A custom root is ignored by subsequent Runs; even the default fresh-machine layout places data repos under `data/` while the committed inventory points to `backend/`. A temporary setup cloned successfully into the chosen root, but Fetch still attempted the old path and failed when it was absent. The setup checklist does not resolve this mismatch.

**Acceptance:** share machine-local path resolution between setup and the Pipeline while preserving existing clone overrides. Test setup followed by Fetch for a custom root and a data-team repo, without manually editing the inventory.

### C08 — [P2] Include all effective PM inputs in freshness checks — partially fixed

**Evidence:** [steps/pm.ts:40](/Users/khannasaransh/Saransh/agents/steps/pm.ts:40), [steps/pm.ts:62](/Users/khannasaransh/Saransh/agents/steps/pm.ts:62).

The new fingerprint correctly invalidates changed reviews, commits and Discord messages, and Brief warns about these mismatches. It excludes `memory` and `runHealth`, although both are supplied to PM, and tests only the old covered Run list rather than newly pending backlog Runs. Reproduction: PM answered, its Memory was manually edited with a new open item, then PM was rerun normally; it skipped the Worker. A repaired fetch failure with no new commits can likewise leave obsolete health To-dos without a freshness warning.

**Acceptance:** define a complete input identity, including health, the intended covered Runs and externally changed Memory. Account for Memory written by this very answer so an ordinary replay remains idempotent. Test manual edits, repaired health and newly queued backlog entries.

### C22 — [P2] Remove the unsupported page-order expectation from the Docs test — new, review fix

**Evidence:** [test/docs.test.ts:821](/Users/khannasaransh/Saransh/agents/test/docs.test.ts:821).

The PRD backlink test expects `[PRD page, existing page]` in both tool calls, but the implementation supplies `[existing page, PRD page]`. Both calls use the correct PRD pins and contain both pages. This fails `npm test` on the reviewed Mac and fails when run alone; it is not a discovered stamp/check failure. Compare the page sets while preserving required argument positions, or explicitly define and implement an ordering contract.

### C23 — [P3] Make the installed status line's date formatting work on macOS — new, issue 14

**Evidence:** [statusline.sh:73](/Users/khannasaransh/Saransh/agents/worker-config/claude-code/.claude/statusline.sh:73), [statusline.sh:91](/Users/khannasaransh/Saransh/agents/worker-config/claude-code/.claude/statusline.sh:91).

The captured script uses GNU `date -d` for reset timestamps. Setup installs it unchanged on macOS, where the system date command rejects that option; stderr is suppressed. A fixture with both reset timestamps displayed only `tmp | 5h:12% 7d:34%`, omitting both reset times and the countdown. Use portable formatting or branch by the available date implementation, and test both supported OS environments.

## 2. Fixed implementation findings

“Fixed” means the original reproduced defect is addressed by current code and the relevant passing checks, subject to the limits below. It does not imply every related design problem is closed.

| ID | Status | Current evidence |
| --- | --- | --- |
| C01 — Surviving children after runner death | **Fixed** | Process records and lock recovery stop surviving Steps/Workers before replacement Runs. Crash recovery tests pass. |
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

The separate issue-11 review's path-traversal cases in `prd`, mutable PRD pins, per-product index rejection, duplicate moves, missing frontmatter citation, discarded skipped-file outcomes, legacy Brief arrays and contradictory `finish` instructions also have specific fixes. PRD pins now live outside the writable worktree. Backlink stamping uses PRD pins; the new assertion about argument order still needs C22. Tool execution trust remains C12. Old `.doc` handling, unknown Codebases and unclassified inputs should remain explicit product decisions rather than being called supported automatically.

## 3. Cross-cutting design and recovery work

### D01 — Independent consumer progress — partly implemented

PM has a backlog and Docs has its own cursor. C06 still blocks correct acknowledgement after upstream retry. Define initialization/backfill when Docs is first configured or when upgrading from pre-backlog Runs: an unchanged Fetch currently initializes missing Docs state at the current head, and historical failed PM Runs are not automatically scanned. Also specify interruption recovery if ingestion/review progress persists but Save state never registers the downstream work.

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
| V05 — Schedule and installer | **Implemented; rollout pending** | Issue 12 is done. Schedule definitions use the machine’s local clock, and `agents schedule install` generates launchd entries. Timezone changes therefore change the corresponding IST time. Setup and schedule installation remain separate commands; decide whether a setup reminder is wanted. |
| V06 — Second opinion and cost signal | **Pending clarification** | Record the usual writing model and whether fallback may sacrifice model independence. Logs identify Worker/model/effort; structured provenance would improve auditing. Repos reviewed is a rough cost signal, not an attempt/token/billing count. |
| V07 — Step definition and I/O | **Partly resolved** | Sequential Review → Discord → PM order is explicit. The [glossary](/Users/khannasaransh/Saransh/agents/GLOSSARY.md:31) still defines a Step as one Agent call although Review contains several. The [PRD contract](/Users/khannasaransh/Saransh/agents/docs/prd/prd.md:161) excludes required repo, Memory, inbox and wiki access. Specify resource access and side effects per Step. |
| V08 — Wiki configuration and lifecycle | **Mostly implemented; decisions pending** | `WIKI_FOLDER`, local `main`, rolling `agents/docs`, checkout identity, Agent/Run trailers, isolation and conflicts are concrete. Specify whether squash/rebase merges are supported; ancestry handles ordinary merges. Define “large changes,” since every undocumented Repo with any commit is reported. Decide retention of rejected/failed work, currently removed with temporary worktrees. Real wiki compatibility remains unverified. |
| V09 — Discord access and provenance | **Implemented for the stated scope; recovery limits remain** | Public archived threads paginate, malformed URLs are ignored, and ordinary skipped-file restores recover provenance (C15/C16/C18 fixed). Private archives/forums remain a scope decision. Input identity and interruption recovery remain D02 and C19. |
| V10 — Repo seed metadata | **Closed as an implementation complaint** | The committed [Repo list](/Users/khannasaransh/Saransh/agents/repos.ts) already carries branch/folder metadata. Do not create a competing inventory from the abbreviated PRD. The prior review counted 29 Repos and recorded exceptions; the inventory is unchanged. Remote branch correctness was not audited. |
| V11 — Existing clones and fresh-machine paths | **Implementation defect confirmed: C20** | Setup now clones into root/Team/name, but Pipeline resolution still uses the old configured folder. Existing clones must remain supported while fresh-machine destinations become discoverable. |
| V12 — Review/retry/dry-run choices | **Mostly implemented; boundaries need clarity** | Severities, concurrency, worktree ownership, schema fallback and range-aware Review reuse exist. Saransh-first sorting is tested policy; severity-first would be a change. Dry run replaces Workers, but Fetch/Discord still read external systems and initial baselines can persist. Fake work does not advance Discord cursor, Memory or inbox moves. C08 covers the remaining PM freshness gaps. |
| V13 — Worker/fallback policy | **Implementation gap resolved; live verification pending** | Antigravity exists as a fallback. PM and Docs name Claude Code primary and Codex fallback configurations. Older statements that they do not exist are obsolete. Argument/stand-in tests do not establish effective live-CLI isolation; retain that gate and V06's model-independence decision. |
| V14 — Tools/skills dependency | **Dependency resolved; trust boundary pending** | Issue 10 now depends on issue 4. Docs declares its Tools and adapts the wiki skill explicitly. Real wiki compatibility remains unverified, and C12 still applies to Tools invoked during the Agent call. |
| V15 — Schedule readiness and refused starts | **Refusal behavior resolved; readiness pending** | Lock refusal skips the invocation and is durably recorded in scheduled-starts.log; it does not queue a replacement. Define operational readiness before enabling unattended Runs. No real schedule was installed in this review. |
| V16 — LaunchAgent environment and compatibility | **Mostly implemented; live checks pending** | Explicit PATH, absolute Node path, data directory, log directory, local time and no RunAtLoad are specified and tested as generated config. Issue 12 documents sleep/off behavior. Real launchd loading, credentials and Windows execution were not tested here. Setup version checks warn rather than enforce a compatible runtime. The installed status line has a Mac portability defect (C23). |
| V17 — Issue status and documentation | **Partly resolved** | Issues 6–14 are marked done; issues 1–5 still say ready-for-agent with unchecked criteria. Reconcile them with implementation evidence while retaining the live-CLI gaps and open defects. Issues 15–45 are new planned stocks work, not missing implementation of issues 1–14. |
| V18 — Preserve issue-specific requirements | **Retained** | Rate limits, cursors, deduplication, conflict handling, tool checks, backups, path rewriting and secret exclusion remain requirements. Setup and scheduling now exist, with C20/C21/C23 remaining. Interactive Worker config must not broaden Pipeline Agent permissions. |


### Additional retained daily-Pipeline decisions

- **PRD replacement:** define when a repeated basename is a revision versus a separate source. Wiki copies currently replace by Codebase/basename; input identity and deliberate restores also need C19/D02.
- **Generated edits:** specify allowed indexes/backlinks, draft status and validation; C12 still permits unrelated existing content pages.
- **Incomplete Run data:** specify cache invalidation for Docs and Discord when upstream inputs change. PM's remaining freshness defects are C08.
- **Unclassified input:** a successful Docs result may leave files absent from both `prds` and `skipped`. Decide whether that is a partial outcome and how Brief reports it; neither a successful exit nor a done checkbox guarantees every waiting file was classified.

## 5. New stocks PRD and issue decisions

These are unresolved contracts in planned work, not claims of bugs in unimplemented stocks code. References are to this repo's [stocks PRD](/Users/khannasaransh/Saransh/agents/docs/prd/stocks-pipeline.md) and its issues. Backtest figures, market-data correctness, tax assumptions and external repository implementations were not validated.

| ID | Status | Concrete gap and proposed acceptance |
| --- | --- | --- |
| S01 — Fresh events before selecting the Desk's names | **Pending ordering decision** | The PRD and issue 37 build dossiers and the event-dependent review list in Plan, then fetch Feeds. A holding whose event is first discovered by that fetch can be absent from today's Desk input. Fetch holdings events before selection, or explicitly rebuild/enrich the list and dossiers after Feeds. Test a previously uncached imminent event. |
| S02 — Demotions before effective order generation | **Pending ordering decision** | The PRD places Plan before Review, while issue 35 automatically demotes strategies in Review. Clarify whether today's orders must use the new Stage; if so, recompute/revalidate plans after demotion. Test a Saturday demotion affecting a buy already in the plan. |
| S03 — Replay, missing inputs and session identity | **Missing acceptance criteria** | Issues 32–34/42 need stable order identities across retries, duplicate Check protection, a policy for changed same-session plans, and suppression of output when Plan is missing/stale. Worker failure may fall back to a valid Rule plan, but that is not a rule for failed Plan itself. Define session/as-of data and how late Answers revalidate still-open order/promotion proposals. Test repeated/forced Steps, delayed Answers and overlapping broker-export files, not only identical file reimports. |
| S04 — Yearly rebalance parity | **Contract mismatch to resolve** | Issue 27 reweights in the first session of April; issue 45 proposes changes on the first Saturday and applies them only after an Answer. Those can produce different effective sessions despite the shared-engine parity requirement. Specify effective dates and approval delay in the backtest/live contract, with a parity test spanning April. |

The PRD explicitly lists further unconfirmed choices: the Answers download workflow, early broker-import sequencing, initial capital and broker samples, Windows sandbox behavior, runtime upgrade, feed access and web-search permissions. Keep these pending. The new Windows and stocks tickets intentionally extend the daily PRD's earlier scope; their mere absence from current implementation is not a finding.

## 6. Recommended follow-up order

1. Close C12's Tool execution boundary and C21's secret capture before relying on those commands with untrusted inputs or real config.
2. Fix PM acknowledgement/freshness (C06/C08) and PRD input identity (C19).
3. Connect setup destinations to Pipeline paths (C20), restore the test gate (C22), and fix status-line portability (C23).
4. Specify migration and interruption behavior (D01/D02) and resolve the retained policy decisions before unattended rollout.
5. Resolve S01–S04 before the corresponding stocks Steps are implemented, keeping them distinct from daily-Pipeline defects.

## 7. Verification and limits

- **`npm run typecheck`: passed.** **`npm test`: 200 passed, 1 failed, 201 total**, on macOS at `82ba67e`. The failure is C22. It also failed in isolation with `node --test --test-name-pattern='a page the Docs Agent links to a new PRD' test/docs.test.ts`.
- The initial sandboxed test run could not bind loopback sockets. A permitted rerun produced the results above; sandbox failures are not application defects.
- Seven additional isolated checks reproduced: mutable `finish` script execution, unrelated wiki page acceptance, same-name PRD replay, stale PM backlog acknowledgement, Memory-insensitive PM caching, setup/Fetch path disagreement, and multiline-secret capture. Fixtures used temporary repos/homes, synthetic config and stand-in Worker CLIs. The Mac status-line check separately confirmed missing reset details.
- Review-only reproduction script and output are in `/tmp/agents-review-oct25-repros.mts` and `/tmp/agents-review-oct25-repros.log`; the suite log is `/tmp/agents-review-oct25-tests-unrestricted.log`. These temporary files are not committed regression tests.
- No paid Worker call, company Discord access, production remote audit, actual org-wiki integration, real setup or schedule installation was performed. Tool-wrapper behavior was reproduced directly; effective live Worker permissions remain unverified. Windows behavior was assessed from source and layout tests, not a Windows execution.
- Wiki fixtures record tool calls and reject a marker; they do not establish actual stamp/regions/PRD-skill compatibility or generated-page accuracy. Current test evidence supports the scoped closures above, not blanket integration readiness.
- Only this consolidated report was edited in the repository. No implementation fix, ticket status change, commit, push or publication was made.
