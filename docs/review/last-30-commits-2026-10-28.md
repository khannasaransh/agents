# Review of the last 30 commits

Reviewed on 28 October 2026, pinned to the starting HEAD `1ef24f0a4dc29172460b0df3ee4c63effac63f7f`. The shared checkout advanced to `3242cdc` during the review; the original 30-commit scope is retained. A focused comparison found that the reported defective logic remains in the newer revision, but its additional features were not fully reviewed. Links point to the current workspace locations. The review reproduction script was included in those intervening commits by another workspace operation and has been preserved.

The exact range is `53c95ac7a6e8d1ab5fb9cbae172e234410eff7b4..1ef24f0a4dc29172460b0df3ee4c63effac63f7f`: 30 commits, including the merge. `HEAD~30` would include 31 commits because it follows first parents. The net review command is `git diff 53c95ac...1ef24f0`.

Ten actionable bugs were identified in the current implementation, all assessed as P2 (normal-priority correctness fixes). Historical defects already fixed in the range are excluded. This is a bounded review, not a guarantee that no other defects exist. No implementation changes were made.

## Confirmed correctness findings

### B1 — Lake retries can succeed without recovering the missing status

Location: [steps/stocks/lake.ts:60](D:/Saransh/agents/steps/stocks/lake.ts:60), with the earlier checkpoint at line 86.

When `pd daily` succeeds but the following `pd status` fails, `lake.json` already says `refreshed: true`. A normal retry returns immediately on that flag, never retries the status read, and changes the Step to succeeded while `lake/status.json` remains absent. The Brief consequently cannot assess the Data gate.

An isolated CLI reproduction returned first exit **1**, retry exit **0**, and `statusExists: false`. The only calls were `clear-refresh`, `daily`, and the first failed `status`.

Fix: treat refreshing and reading status as separate checkpoints. A completed refresh can be reused while the missing status and To-dos are recovered.

### B2 — Health ignores the Run's worker override

Location: [steps/stocks/health.ts:117](D:/Saransh/agents/steps/stocks/health.ts:117).

The CLI promises that `--worker` chooses the first Worker for every Agent. Review, PM and Docs forward `run.worker`; Health passes only `{ cwd, dryRun }`. A stocks Run requesting Codex still starts Health on Claude Code.

An isolated Run with `worker: 'codex'` completed with **one Claude call and zero Codex calls**. Fix: forward the Run's worker to `callAgent`, preserving the configured fallback behavior.

### B3 — An old Health status overrides a newer Lake's approval items

Locations: [steps/stocks/health.ts:95](D:/Saransh/agents/steps/stocks/health.ts:95), [steps/stocks/brief.ts:456](D:/Saransh/agents/steps/stocks/brief.ts:456).

Health writes `health/status.json` after proposing Corrections. When Lake is refreshed again and Health subsequently skips, it removes only `health.json`. The Brief unconditionally prefers the remaining Health status for Corrections and Quarantines. Even a forced Brief regeneration can therefore show settled items and omit newly waiting ones.

Reproduction: seed the earlier Health status, replace Lake status with a clean status containing zero Corrections, run Health, then generate the Brief. The stale Correction is still rendered.

Fix: invalidate the supplementary status when the Lake input changes, or attach a generation/fingerprint and use it only while it belongs to the current Lake snapshot. Apply the same invalidation when a replacement diagnosis or proposal fails.

### B4 — Failed proposal recording hides a valid diagnosis and the actual error

Location: [steps/stocks/brief.ts:60](D:/Saransh/agents/steps/stocks/brief.ts:60).

When the Agent diagnoses successfully but `pd corrections propose` fails, Health correctly saves `status: 'diagnosed'` with `proposals.status: 'failed'` and fails the Step. The Brief checks the failed Step before rendering that result, says the Agent failed before recording a diagnosis, and hides both the diagnosis and proposal error.

Reproduction with that recorded state: diagnosis visible **false**, proposal error visible **false**, incorrect no-diagnosis message **true**. The existing proposal-rendering test misses this because it leaves the Step marked succeeded.

Fix: distinguish an Agent failure from a proposal-recording failure, while still rejecting a diagnosis left over from a different attempt. Issue 19 requires: “The Brief shows the diagnosis and the proposed fix under the Data gate's verdict.”

### B5 — Worker config paths containing spaces break across operating systems

Location: [src/worker-config.ts:302](D:/Saransh/agents/src/worker-config.ts:302); the render pattern at line 34 has the same boundary assumption.

The capture regex stops converting separators at whitespace inside a directory name. An isolated capture/render reproduction gives:

```text
Original:  C:\Users\old\My Projects\repo
Captured:  {{home}}/My Projects\repo
On macOS:  /Users/new/My Projects\repo
```

The remaining backslash is a literal filename character on macOS, so project paths, hooks or MCP arguments can refer to the wrong location. Issue 14 requires machine-specific paths to be rewritten.

Fix: normalize complete parsed string values in JSON and use string-aware handling for TOML and shell configuration. Add cases with spaces and punctuation in path components.

### B6 — Failed Windows process inventory is treated as proof that processes ended

Locations: [src/process-tree.ts:11](D:/Saransh/agents/src/process-tree.ts:11), [src/processes.ts:134](D:/Saransh/agents/src/processes.ts:134).

`listProcesses()` parses stdout without checking subprocess errors, stderr, or whether enumeration succeeded. When CIM access is denied, it returns an empty list. `exists(record)` consequently reports false, and recovery tries to delete a record whose process may still hold its exclusive lock. Cleanup then fails with EPERM instead of reporting that process discovery is unavailable. Other callers can also miss live descendants.

Observed here: PowerShell printed **Get-CimInstance: Access denied**. Calling `processTree()` for the current Node process returned `[]` while `process.kill(pid, 0)` confirmed it was alive. PowerShell can report this as a nonterminating error, so checking exit status alone is insufficient.

Fix: make CIM errors terminating, check the subprocess result, bound its execution time, and propagate an enumeration failure distinctly from a successful empty result. Preserve process records when liveness is unknown.

This is confirmed under the current restricted Windows environment; it does not establish that process discovery fails on an unrestricted desktop.

## Spec

The specification review used local issue files and PRDs. These four findings are separate from the six correctness findings above.

### B7 — Windows CRLF pages silently miss documentation updates

Location: [steps/docs.ts:143](D:/Saransh/agents/steps/docs.ts:143).

Issue 10 requires: “It updates only existing pages whose sources cite files changed by new commits.” The frontmatter parser recognizes LF delimiters only. With wiki `core.autocrlf=true`, changing a cited source produces `nothing-to-update`, zero Worker calls, and successful completion. Save state can then advance the documentation cursor beyond the omitted changes.

Confirmed through an isolated wiki/CLI reproduction. Normalize line endings in all three frontmatter helpers, or explicitly support CRLF delimiters.

### B8 — Replaying Docs consumes a replacement inbox file without processing it

Location: [steps/docs.ts:283](D:/Saransh/agents/steps/docs.ts:283).

Issue 11 requires: “The Docs Agent takes every file in the PRD inbox each Run.” Recovery repeats historical filename moves before considering `--force`, without verifying that the current file is the one previously handled.

Confirmed reproduction: process and skip `Spec.md`, drop new content under the same name, then force-rerun Docs. The new file moves to `skipped/Spec (2).md` without another Worker call. This silently removes pending work.

Fix: persist completed moves and verify content identity before replaying an interrupted move. A different file under an old name must remain eligible for processing.

### B9 — Code pins break when clone paths contain spaces

Locations: [agents/docs/tools/code:21](D:/Saransh/agents/agents/docs/tools/code:21), [steps/docs.ts:390](D:/Saransh/agents/steps/docs.ts:390).

Issue 10 requires “reading code only at pinned commits.” Docs emits whitespace-delimited pin records with unquoted clone paths, and the code Tool splits each line on whitespace. A clone named `space name` makes Git receive the truncated directory `.../clones/space`, shifting the rest of the path into the commit field.

An isolated Tool reproduction exited **128**. This affects ordinary Windows user and repository directories containing spaces. Use a structured pins format or compatible escaping and parsing across all producers and consumers.

### B10 — PM reruns reuse an answer after Run health changes

Location: [steps/pm.ts:136](D:/Saransh/agents/steps/pm.ts:136), with freshness checking in [src/pm-inputs.ts:82](D:/Saransh/agents/src/pm-inputs.ts:82).

Issue 07 requires “the Run's health so far” as input. PM receives `runHealth`, but the saved fingerprint covers only reviews, commits and Discord messages. Health changes alone do not invalidate an answer.

Confirmed reproduction: PM answers on a failed fetch; fetch recovers to a successful baseline; rerunning PM leaves the old failure To-do intact. The Worker call count remains one, and the Brief treats the answer as fresh.

Fix: include material Run health in answer freshness checks. Keep the PM's own subsequent bookkeeping out of the identity to avoid perpetual invalidation.

Spec axis: **4 findings, all P2**. The inbox replay is the most direct risk of silently dropping unprocessed work.

## Standards

No confirmed hard standards violations were found. One heuristic improvement was identified:

- **Possible Duplicated Code / Repeated Switches:** [src/state.ts:58](D:/Saransh/agents/src/state.ts:58) through the weekly state functions duplicates daily repository, Discord and PM-backlog readers/writers. Callers separately select daily or weekly variants. A small pipeline-scoped state accessor would preserve isolation while reducing scattered edits for later pipelines. This is a judgment call, not a rule violation.

Standards axis: **0 hard violations, 1 heuristic finding**; duplicated state access is its only finding.

## Optimizations and improvements

These are suggestions, not measured performance regressions. Address correctness before refactoring.

1. **Reuse a Windows process inventory per cleanup pass.** [src/processes.ts:107](D:/Saransh/agents/src/processes.ts:107) checks records and later stops them through separate inventories. Each inventory launches PowerShell, and each tree walk repeatedly scans the list. Share a snapshot, index children by parent PID, and use a visited set. Bound enumeration time as part of B6.
2. **Stream long-running command logs and retain bounded diagnostic tails.** [src/process.ts:78](D:/Saransh/agents/src/process.ts:78) accumulates all stdout/stderr in memory; Lake and MarketSmith print it only after the command returns. Their jobs can run for hours. Stream log output to the Step log while retaining the complete JSON stdout only for commands that require it. This also makes progress visible during a stalled fetch.
3. **Cache attachment lookup state during Discord ingestion.** [steps/discord.ts:236](D:/Saransh/agents/steps/discord.ts:236) rereads/parses the sources map and scans IDs for each attachment. Keep a map and ID set per destination for the current invocation while preserving durable updates.
4. **Deduplicate overlapping PM backlog evidence.** [src/pm-inputs.ts:60](D:/Saransh/agents/src/pm-inputs.ts:60) concatenates inputs from Runs. Overlapping ranges and repeated messages cost tokens and can present repeated evidence. Deduplicate messages by ID and reviews/ranges by identity without dropping distinct review results.
5. **Make setup repair executable permissions even when content matches.** [src/worker-config.ts:73](D:/Saransh/agents/src/worker-config.ts:73) returns before the later `chmodSync`. An identical `.sh` file missing its executable bit remains unchanged. This is supported by code inspection; Unix permission behavior was not executed on this Windows machine.
6. **Target missing state-transition tests.** Existing tests cover many happy paths. Add regression coverage for successful refresh followed by failed status, proposal failure with the actual failed Step status, stale supplementary status, health-only PM changes, replacement inbox filenames, CRLF and paths with spaces. The focused reproductions above demonstrate why these transitions matter.

## Validation and limits

- `npm run typecheck`: **passed**.
- `npm test`: **299 tests: 295 passed, 4 failed, 0 skipped**; approximately 218 seconds. This run preceded the final comparison with the newer shared-checkout revision and is not a full-suite validation of its additional changes.
- All four failures reproduced in focused reruns:
  - [test/lock.test.ts:75](D:/Saransh/agents/test/lock.test.ts:75): an abandoned Run did not permit the expected replacement Run.
  - [test/lock.test.ts:113](D:/Saransh/agents/test/lock.test.ts:113): simultaneous recovery produced EPERM deleting a process lock.
  - [test/review.test.ts:309](D:/Saransh/agents/test/review.test.ts:309): Codex timeout/fallback returned failure instead of success.
  - [test/review.test.ts:546](D:/Saransh/agents/test/review.test.ts:546): Antigravity timeout cleanup reported EPERM removing its worktree.
- CIM access is denied in this execution environment. That verifies B6 and limits conclusions about normal Windows process cleanup. It is not sufficient evidence that all four failures have exactly the same cause; rerun these cases with ordinary desktop process permissions after fixing diagnostics.
- Targeted CLI/Tool reproductions verified B1–B4 and B7–B10; capture/render verified B5; a live self-process query verified B6.
- Recent commits describing strategy audits, gold/cash instruments, Book backtests and Candidate tests largely update this repository's documentation and contract fixtures. Their implementations live in `ash_new` and were not audited as part of these 30 commits. Passing contract-fixture validation does not verify their algorithms.
- macOS runtime behavior and real external Worker/service integration were not exercised. The test suite uses stand-ins.
- No issue-tracker configuration exists at `docs/agents/issue-tracker.md`; local issue specs were used. For the review skill's live tracker integration, its setup instruction is `/setup-matt-pocock-skills`.

Review totals: **10 confirmed bugs; Spec 4 P2 findings; Standards 0 hard violations and 1 heuristic finding; 6 optimization/testability/robustness suggestions.**
