# Consolidated implementation, PRD and issue review — through issue 11

Updated **24 October 2026** against commit `81bb3e0` plus the staged issue 11 implementation. The incremental review covers changes since `6ab170c`, with earlier findings checked against the current implementation. This document retains its original filename so existing links keep working.

This is the consolidated record of the original implementation review, the supplied “The pipeline’s shape holds together…” review, the issue 7 review, and the review through issue 11. Recommendations are proposals, not changes to product requirements.

**Assessment:** C01–C05 are fixed in the implementation. The five issue 7 findings, numbered C06–C10 below, remain pending. Eight new defects are confirmed through issues 8–11, C11–C18: **13 open implementation findings in total**. Resolved design questions are marked accordingly; pending decisions are retained. The review changes this document only, not application code, the PRD, issue checkboxes or staged implementation files.

## 1. Open implementation findings

### C06 — [P1] Preserve PM inputs until PM has processed them — pending from issue 7

**Evidence:** [steps/save-state.ts:61](/Users/khannasaransh/Saransh/agents/steps/save-state.ts:61), [steps/pm.ts:39](/Users/khannasaransh/Saransh/agents/steps/pm.ts:39), [steps/discord.ts:252](/Users/khannasaransh/Saransh/agents/steps/discord.ts:252).

When Review succeeds but PM and its fallback fail, Save state still advances the review cursor. The next PM call reads only that Run's reviews and commits plus previously saved Memory. The issue 7 reproduction lost a high-severity finding from subsequent PM inputs: reviews, commits and Memory were all empty. These paths remain unchanged.

Discord now has the same consumer gap: ingestion advances its cursor before PM succeeds, while PM reads only the current Run's messages. Requests and download links from a failed PM Run need manual replay to reach PM again. Historical Run files remain available; the loss is from automatic processing, not deletion.

**Fix and acceptance:** maintain a durable PM backlog or independent acknowledgement for reviews and messages. Fail PM after successful Review/Discord, then run again with no new inputs; PM must still receive the unprocessed items.

### C07 — [P1] Prevent older PM proposals from replacing newer Memory — pending from issue 7

**Evidence:** [steps/save-state.ts:74](/Users/khannasaransh/Saransh/agents/steps/save-state.ts:74), [src/memory.ts:51](/Users/khannasaransh/Saransh/agents/src/memory.ts:51).

PM proposals have no base-Memory version or freshness check. Saving a newer Run and then an older, previously unsaved Run replaces newer notes with the older proposal. The earlier reproduction changed “Newer open item” back to “Older open item.” A manual edit made after the Agent read Memory is likewise unprotected. Review-mode queue replacement also lacks a version/order check. The relevant code is unchanged.

**Fix and acceptance:** record the Memory version supplied to the call and detect intervening changes before application or queue replacement. Test out-of-order saves and manual edits between proposal creation and application.

### C11 — [P1] Retry unsuccessful Docs work independently of Review — new, issue 10

**Evidence:** [steps/docs.ts:240](/Users/khannasaransh/Saransh/agents/steps/docs.ts:240), [steps/docs.ts:284](/Users/khannasaransh/Saransh/agents/steps/docs.ts:284), [steps/save-state.ts:61](/Users/khannasaransh/Saransh/agents/steps/save-state.ts:61).

Docs derives its code-update workload from Fetch's `new-commits` results, whose baseline is the last successful review. If Review succeeds and Docs fails, Save state advances that baseline anyway. A reproduction failed Docs, saved state, and ran again: Fetch returned `unchanged`, Docs returned `nothing-to-update`, and the stale wiki page was never retried. Changes missed while Docs is unconfigured have the same problem when it is enabled later.

**Fix and acceptance:** give Docs independently acknowledged ranges or a durable work queue, including an initial-baseline policy. Test failed Docs work followed by a quiet Run and eventual successful documentation.

### C12 — [P1] Restrict modifications before running wiki tools — new, issues 10–11

**Evidence:** [steps/docs.ts:178](/Users/khannasaransh/Saransh/agents/steps/docs.ts:178), [steps/docs.ts:184](/Users/khannasaransh/Saransh/agents/steps/docs.ts:184), [steps/docs.ts:344](/Users/khannasaransh/Saransh/agents/steps/docs.ts:344).

`forbiddenEdits` accepts every ordinary modification (`M`), including unrelated pages, instructions and `_wiki/tools/*.mjs`. The Step executes wiki tools from that edited worktree and commits all changes. A stand-in Agent changed a page to contain `BROKEN` and replaced `check.mjs` with a script reporting zero errors; Docs succeeded and committed both. The Agent can therefore change the gate intended to validate its work. The Step launches those scripts outside the Worker permission configuration.

**Fix and acceptance:** explicitly allow relevant page/source/index/work-file edits and protect tooling and instructions. Execute trusted tool versions, including through the Agent's `finish` Tool. Reject modified checkers or unrelated files before execution or publication to the docs branch.

### C08 — [P2] Invalidate PM output when its inputs change — pending from issue 7

**Evidence:** [steps/pm.ts:30](/Users/khannasaransh/Saransh/agents/steps/pm.ts:30), [steps/brief.ts:219](/Users/khannasaransh/Saransh/agents/steps/brief.ts:219).

A successful `pm.json` is reused without identifying its inputs, and Brief accepts it unconditionally. The earlier reproduction forced Fetch to include another commit, reran PM normally, and forced Brief: the new commit appeared beside the old PM summary and To-dos. Discord is now another independently changing input. The cache check remains unchanged.

**Fix and acceptance:** fingerprint PM inputs, invalidate mismatched output, and disclose stale/missing analysis in Brief. Test upstream Fetch, Review and Discord retries without corresponding PM recomputation.

### C09 — [P2] Track Memory decisions per proposal version — pending from issue 7

**Evidence:** [src/memory.ts:60](/Users/khannasaransh/Saransh/agents/src/memory.ts:60), [steps/save-state.ts:76](/Users/khannasaransh/Saransh/agents/steps/save-state.ts:76).

Decisions are identified only by Run, Agent and Memory filename. After the first PM proposal is applied, forcing PM to produce corrected Memory and forcing Save state still leaves the first version installed: the replacement is considered already settled. The earlier reproduction retained “First version” despite a “Corrected version” proposal. The implementation is unchanged.

**Fix and acceptance:** associate each decision with proposal identity/content. Forced replacements need new decisions; replay of the identical proposal must remain idempotent.

### C10 — [P2] Serialize Memory approvals with proposal writes — pending from issue 7

**Evidence:** [src/cli.ts:44](/Users/khannasaransh/Saransh/agents/src/cli.ts:44), [src/memory.ts:70](/Users/khannasaransh/Saransh/agents/src/memory.ts:70).

`agents memory accept/reject` bypasses the Run lock. If Save state replaces a pending proposal between the approval's read and deletion, approval settles the old proposal and deletes the new one. A controlled two-process interleaving applied the older proposal and left no pending proposal. These call paths remain unchanged.

**Fix and acceptance:** serialize the whole decision with queue writes and verify identity before removal. In a concurrent approval/new-proposal test, the new proposal must survive unless it was itself decided.

### C13 — [P2] Stop when regions or stamp fails — new, issues 10–11

**Evidence:** [steps/docs.ts:344](/Users/khannasaransh/Saransh/agents/steps/docs.ts:344), [steps/docs.ts:350](/Users/khannasaransh/Saransh/agents/steps/docs.ts:350), [agents/docs/tools/finish:18](/Users/khannasaransh/Saransh/agents/agents/docs/tools/finish:18).

Docs awaits `regions` and `stamp` but ignores their exit codes. Only `check` determines whether the branch advances. The `finish` Tool behaves the same way. With both preparation tools exiting 1 and the checker exiting 0, Docs reported `updated` and committed the page. Failed generation or stamping need not produce a checker error.

**Fix and acceptance:** require success from every required tool and stop at the first failure. Test failing regions and failing stamp independently while the checker would otherwise succeed.

### C14 — [P2] Recover PRD acknowledgement after the wiki commit succeeds — new, issue 11

**Evidence:** [steps/docs.ts:320](/Users/khannasaransh/Saransh/agents/steps/docs.ts:320), [steps/docs.ts:369](/Users/khannasaransh/Saransh/agents/steps/docs.ts:369), [steps/docs.ts:375](/Users/khannasaransh/Saransh/agents/steps/docs.ts:375).

The branch advances before inbox files move and before `docs.json` records completion. On retry, a PRD is acknowledged only if its page appears in the current worktree's edits. A reproduction induced an inbox-move failure after commit, removed the obstruction and retried the same successful Agent output. The page and copy were already committed, so the retry returned `no-edits` and left the PRD waiting. A crash at the same boundary has the same gap.

**Fix and acceptance:** persist stable input-to-commit acknowledgement and resume incomplete moves without requiring another edit. Test interruption after branch update but before the first move, including identical-content replays.

### C15 — [P2] Paginate archived threads before advancing the read cursor — new, issue 8

**Evidence:** [steps/discord.ts:215](/Users/khannasaransh/Saransh/agents/steps/discord.ts:215).

`threadsOf` fetches one archive page with `limit=100`, ignores `has_more`, and permits the global cursor to advance. Additional eligible threads' messages and attachments are then omitted from normal later reads. A fixture with 101 eligible threads made one archive request, never queried the last thread's message, and still advanced state.

Discord documents descending archive timestamps and pagination through `before` and `has_more`. [Official archived-thread API](https://docs.discord.com/developers/resources/channel#list-public-archived-threads).

**Fix and acceptance:** continue until no threads remain or archive timestamps pass the lower bound. Test two archive pages with an actionable message and attachment on the second page.

### C16 — [P2] Ignore malformed links instead of failing ingestion — new, issue 9

**Evidence:** [steps/discord.ts:35](/Users/khannasaransh/Saransh/agents/steps/discord.ts:35).

The regex extracts URL-like text from arbitrary messages and passes it to `new URL` without handling parse failures. A message containing `https://%` reproduced an `Invalid URL` failure for the entire Step. The cursor stayed unchanged, so automatic retries encounter the same message and fail again, blocking later messages across watched channels.

**Fix and acceptance:** ignore an unparseable link candidate while preserving the message. Test malformed text beside valid document links and require successful ingestion and cursor advancement.

### C17 — [P2] Report existing docs work when the Agent fails — new, issue 10

**Evidence:** [steps/docs.ts:311](/Users/khannasaransh/Saransh/agents/steps/docs.ts:311), [steps/docs.ts:379](/Users/khannasaransh/Saransh/agents/steps/docs.ts:379), [steps/brief.ts:99](/Users/khannasaransh/Saransh/agents/steps/brief.ts:99).

Quota, timeout, schema and other thrown failures escape before Docs writes its result or records existing branch work. Brief omits the docs section even when earlier Runs left pages waiting. A reproduction had two pending commits, a failed subsequent Docs call and no docs branch section in Brief. Handled conflict/check failures have structured results; general failures need equivalent treatment.

**Fix and acceptance:** record a failed result with available branch/waiting state before propagating failure. A failed forced retry must supersede prior success. Verify that pending drafts remain visible when both Workers fail.

### C18 — [P2] Preserve provenance when retrying a skipped PRD — new, issue 11

**Evidence:** [steps/docs.ts:303](/Users/khannasaransh/Saransh/agents/steps/docs.ts:303), [src/prd-inbox.ts:58](/Users/khannasaransh/Saransh/agents/src/prd-inbox.ts:58), [steps/brief.ts:134](/Users/khannasaransh/Saransh/agents/steps/brief.ts:134).

Brief tells Saransh to move a skipped file back into the inbox to retry it, but provenance stays keyed as `skipped/<name>`. Docs looks up only the top-level filename, giving the Agent `discordMessage: null`. Following that documented restore procedure produced a successful Docs call and a committed page without its Discord source link; the manifest still pointed to the obsolete skipped path.

**Fix and acceptance:** provide a restore operation or reconcile restored files by stable identity/checksum, updating the manifest. Test skipped → waiting → done and require the original source link in the PRD page.

## 2. Fixed implementation findings

These findings are retained as closed records, with the limits of verification stated explicitly.

| ID | Status | Current evidence |
| --- | --- | --- |
| C01 — Surviving children after runner death | **Fixed** | Recovery tracks and stops surviving Steps/Workers before admitting a replacement Run. Parent-only crash coverage passes in [test/lock.test.ts:76](/Users/khannasaransh/Saransh/agents/test/lock.test.ts:76). See [src/processes.ts](/Users/khannasaransh/Saransh/agents/src/processes.ts) and [src/lock.ts](/Users/khannasaransh/Saransh/agents/src/lock.ts). |
| C02 — Non-atomic stale-lock takeover | **Fixed** | An OS file lock replaces stale-file unlink/recreate ownership. Simultaneous takeover coverage passes in [test/lock.test.ts:100](/Users/khannasaransh/Saransh/agents/test/lock.test.ts:100). |
| C03 — Codex implicitly writable working directory | **Fixed in command construction** | [src/workers/codex.ts:57](/Users/khannasaransh/Saransh/agents/src/workers/codex.ts:57) extends read-only and explicitly grants declared write roots. Argument tests pass; effective live-CLI enforcement remains unverified. |
| C04 — Brief generated before Save state | **Fixed** | [pipelines/daily.ts](/Users/khannasaransh/Saransh/agents/pipelines/daily.ts) puts Brief last. Tests verify successful health and a Save state failure reflected in Brief. |
| C05 — Old review displayed against new fetched commits | **Fixed for review results** | [steps/brief.ts:215](/Users/khannasaransh/Saransh/agents/steps/brief.ts:215) checks repository and range before displaying reviews. Stale-review tests pass. PM freshness remains C08. |

## 3. Cross-cutting design and recovery work

### D01 — Independent consumer progress — pending; now demonstrated

The original warning is now represented by C06 and C11. Preserve ingestion/review cursors but add downstream acknowledgement. Specify recovery of older failed Runs, baselines for newly introduced consumers, and overlapping ranges. Review success, Discord ingestion, PM processing and Docs completion are separate milestones.

### D02 — Replay-safe Memory and PRD transactions — partially implemented, pending

Memory decisions and PRD provenance are recorded, and the successful PRD path validates and commits before moving inputs. These improvements do not close C07, C09, C10 or C14.

Also cover [src/prd-inbox.ts:56](/Users/khannasaransh/Saransh/agents/src/prd-inbox.ts:56): files move individually, but all manifest rekeys are written only after the loop. Interruption can leave moved files under old manifest keys. Reconcile incomplete moves before a new same-named attachment reuses a key. Prefer stable identities, checksums and committed outcomes to filenames or current working-tree differences alone.

Acceptance should exercise failures between Memory write and decision write, wiki commit and inbox move, individual moves, and manifest persistence. Recovery must preserve intervening manual Memory edits. C18 separately covers the documented skipped-file restore path.

### D03 — Writable Worker fallback semantics — pending decision

The fallback receives the same worktree after the primary has edited it and failed, with the original prompt and no explicit account of inherited edits. A reproduction made the primary write a partial edit and fail, then the fallback return empty arrays without writing anything. Docs committed the inherited edit and reported an empty `pages` list.

Choose clean restart or deliberate continuation. Continuation can be useful, but should disclose inherited changes and require reconciliation before success. This is a policy/integration gap, not an assumption that preserving partial work is inherently incorrect. See [src/worker.ts:61](/Users/khannasaransh/Saransh/agents/src/worker.ts:61) and [steps/docs.ts:311](/Users/khannasaransh/Saransh/agents/steps/docs.ts:311).

## 4. Original supplied-review claims and pending decisions

All V01–V18 identifiers are retained. Resolved means the earlier ambiguity has an implementation or documented choice; it does not imply live integration verification.

| ID | Current status | Resolution or remaining decision |
| --- | --- | --- |
| V01 — Skipped Steps | **Resolved** | Exit 78 records optional skips; they do not make a Run partial but remain visible in health. PRD, ADR and implementation agree, and the user story requires partial status for failed Steps. |
| V02 — “Never merge” | **Pending wording** | Main → docs integration is implemented; docs → main and pushing remain prohibited. [Issue 10](/Users/khannasaransh/Saransh/agents/docs/issues/10-docs-agent-wiki-updates-from-commits.md) and `.env.example` still say “never merges” without direction. Clarify it. Conflict rollback tests pass. |
| V03 — To-do rules and ownership | **Partly decided; policy pending** | PM owns download-link To-dos; issue 9 explicitly says they are absent after PM failure. That choice is documented; C06 addresses recovery. Define identity, completion, dismissal and carry-forward. PRD Further Notes requires settled rules before PM ships, while issue 7 leaves them open. Decide how wiki drafts reach PM, which runs before Docs and receives no docs-state input. |
| V04 — Baseline ownership | **Closed: proposed change unnecessary** | Fetch records baseline output and Save state persists it. Later ranges advance after successful real reviews. Keep this separation and clarify older ticket wording rather than moving persistence into Fetch. |
| V05 — Schedule and installer | **Pending, issues 12–14** | Weekdays at 05:30 Singapore / 03:00 IST is already specified. Define timezone-change behavior and connect setup to the shared schedule installer. The stated conversion is not a defect. |
| V06 — Second opinion and cost signal | **Pending clarification** | Record the usual writing model and whether fallback may sacrifice model independence. Logs identify Worker/model/effort; structured provenance would improve auditing. Repos reviewed is a rough cost signal, not an attempt/token/billing count. |
| V07 — Step definition and I/O | **Partly resolved** | Sequential Review → Discord → PM order is explicit. The [glossary](/Users/khannasaransh/Saransh/agents/GLOSSARY.md:31) still defines a Step as one Agent call although Review contains several. The [PRD contract](/Users/khannasaransh/Saransh/agents/docs/prd.md:161) excludes required repo, Memory, inbox and wiki access. Specify resource access and side effects per Step. |
| V08 — Wiki configuration and lifecycle | **Mostly implemented; decisions pending** | `WIKI_FOLDER`, local `main`, rolling `agents/docs`, checkout identity, Agent/Run trailers, isolation and conflicts are concrete. Specify whether squash/rebase merges are supported; ancestry handles ordinary merges. Define “large changes,” since every undocumented Repo with any commit is reported. Decide retention of rejected/failed work, currently removed with temporary worktrees. Real wiki compatibility remains unverified. |
| V09 — Discord access and provenance | **Mostly implemented; coverage/recovery pending** | Env keys, bot prerequisites, mentions by ID, rate limits, message pagination, attachment formats/IDs and manifests exist. Successful done/skipped moves retain deduplication. C15/C16/C18 and D02 remain. PRD explicitly limits archived discovery to public threads; decide whether private archives, forums or directly configured thread IDs require support before claiming broader coverage. |
| V10 — Repo seed metadata | **Closed as an implementation complaint** | The committed [Repo list](/Users/khannasaransh/Saransh/agents/repos.ts) already carries branch/folder metadata. Do not create a competing inventory from the abbreviated PRD. The prior review counted 29 Repos and recorded exceptions; the inventory is unchanged. Remote branch correctness was not audited. |
| V11 — Existing clones and fresh-machine paths | **Pending, issue 13** | Reuse configured clones here, including data-team repos under `backend/`; use selected root/Team layout on new machines. Define local path resolution for a fresh Mac's pipeline. Setup is not implemented; this remains a design risk. |
| V12 — Review/retry/dry-run choices | **Mostly implemented; boundaries need clarity** | Severities, concurrency, worktree ownership, schema fallback and range-aware Review reuse exist. Saransh-first sorting is tested policy; severity-first would be a change. Dry run replaces Workers, but Fetch/Discord still read external systems and initial baselines can persist. Fake work does not advance Discord cursor, Memory or inbox moves. C08 covers stale downstream output. |
| V13 — Worker/fallback policy | **Implementation gap resolved; live verification pending** | Antigravity exists as a fallback. PM and Docs name Claude Code primary and Codex fallback configurations. Older statements that they do not exist are obsolete. Argument/stand-in tests do not establish effective live-CLI isolation; retain that gate and V06's model-independence decision. |
| V14 — Tools/skills dependency | **Mostly implemented; ticket dependency pending** | Docs declares `code`, `finish` and `prd`, with explicit wiki-skill instructions and unattended adaptations in issue 11. Issue 10 still lists only issue 3 as a dependency; add issue 4 or document that dependency. Validate actual skill/tool contracts. C12 covers protection of those tools. |
| V15 — Schedule readiness and refused starts | **Pending, issue 12** | Separate scheduler implementation from enabling unattended Runs. Define readiness criteria and durable logging for refused starts without Run folders. Decide whether lock refusal skips or queues an invocation; preserving review inputs alone does not ensure a morning Brief. |
| V16 — LaunchAgent environment and compatibility | **Pending, issues 12–14** | Specify session/login, sleep/power-off behavior, credentials, explicit PATH, executable installation and supported runtime/CLI versions. Node >=25 is declared. Replace dated latest-version prose with maintained compatibility requirements. Validate operating assumptions during implementation; no launchd test was performed here. |
| V17 — Issue status and documentation | **Partly resolved** | Issues 6–11 are marked done; issues 1–5 remain `ready-for-agent` with unchecked criteria. Reconcile against evidence, retaining live-CLI gaps and confirmed defects. Run suffixes, standalone-Step locking, timeouts and abandoned-run handling already exist; C01/C02 are fixed. |
| V18 — Preserve issue-specific requirements | **Retained** | Keep rate limits, ingestion cursors, deduplication, conflict recovery, tool checks, config backups, path rewriting and secret exclusion. Setup/scheduling remain future work. Interactive Worker configuration must not implicitly grant pipeline Agents MCP capabilities; runtime permissions are separate. |

### Additional decisions exposed by issue 11

- **PRD identity/replacement:** `prd add` replaces a wiki copy with the same basename in the same Codebase. Define when this is a revision and when unrelated attachments need distinct names. Inbox history alone does not resolve wiki-source collisions. See [prd Tool:31](/Users/khannasaransh/Saransh/agents/agents/docs/tools/prd:31).
- **Changed restored inputs:** C18 covers proven provenance loss during restore. Additionally specify how an input edited before restoration under the same name is versioned; equal names do not establish equal contents.
- **Generated edits:** specify which indexes/backlinks may change outside selected pages, and their draft status, source pins and validation. Permitting any modified file is insufficient; see C12.
- **Incomplete Run data:** define invalidation of cached Docs/Discord results after upstream changes and replacement of prior success after failed forced retries. PM has confirmed instance C08; new Steps also use existence/status-based caching.

## 5. Recommended follow-up order

| Order | Work | Completion evidence |
| --- | --- | --- |
| 1 | Wiki scope and trusted validation (C12, C13) | Altered tools/unrelated files are rejected; failed required tools block branch advancement. |
| 2 | Consumer progress (C06, C11, D01) | Quiet Runs recover failed PM/Docs work without manually replaying old Runs. |
| 3 | Memory versioning and serialization (C07, C09, C10, D02) | Out-of-order saves, forced replacements, manual edits and concurrent decisions are safe. |
| 4 | PRD recovery/provenance (C14, C18, D02) | Commit/move/manifest interruption and skipped-file restores preserve logical input identity and source link. |
| 5 | Discord coverage and malformed input (C15, C16) | Multiple archive pages and malformed links neither lose nor block messages. |
| 6 | Output freshness and failure reporting (C08, C17) | Brief exposes stale/missing analysis and existing docs work after failure. |
| 7 | Remaining D/V decisions before unattended rollout | PRD, glossary, issues, real wiki and Worker capabilities agree; scheduler/setup requirements are testable. |

## 6. Verification and limits

- **Typechecking passed; the complete test suite passed 145/145 tests** during the review through issue 11, including staged changes. The first sandboxed run could not bind loopback servers; a permitted rerun passed. Those environment failures were not application regressions.
- Additional reproductions used temporary repos, wiki/inbox folders and Worker/API stand-ins: lost Docs retry (C11), altered checker accepted (C12), ignored preparation-tool failures (C13), commit-before-move replay (C14), omitted archive page (C15), malformed URL failure (C16), missing branch report (C17), and provenance lost on restore (C18). D03's fallback behavior was reproduced separately.
- C06–C10 retain their prior reproductions and were rechecked against current call paths. Memory, Save state and the Memory CLI decision path have not been fixed since issue 7. PM's Discord integration does not fix its progress/cache behavior.
- Current source and regression tests support C01–C05 closure. C03's command construction is fixed; live permission enforcement remains unverified.
- Discord archive pagination was checked against official documentation cited at C15. Local HTTP fixtures replaced Discord; no company account/channel or external attachment was read.
- No paid Worker call, actual org-wiki integration, remote production-branch audit, schedule installation or setup was performed. Wiki fixture tools record invocation, and the checker rejects a fixture marker; these do not prove actual stamp/regions/PRD-skill compatibility or semantic correctness of generated pages.
- Restoring this report does not constitute another code/test run. Only this document was changed; staged implementation files were preserved, with no fixes, ticket status changes, commits, pushes or publication.
