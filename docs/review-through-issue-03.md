# Consolidated implementation, PRD and issue review

Reviewed on 22 October 2026 against commit `98bd544` (implementation through issue 03).

This document reconciles the code review in this chat with the supplied “The pipeline’s shape holds together…” review. It records confirmed defects, validates the supplied claims, and identifies decisions needed before later issues are implemented. Recommendations below are proposals; they do not silently change the PRD’s requirements.

**Assessment:** five implementation defects remain valid. Most of the supplied review identifies useful specification gaps, but several claims describe an older implementation or turn a reasonable preference into a requirement. In particular, do not move baseline persistence back into Fetch, treat the existing review settings as undefined, or assume the current code calls Antigravity.

## 1. Confirmed implementation defects

### C01 — [P1] Keep the lock while surviving child processes are active

**Evidence:** [src/lock.ts:20](/Users/khannasaransh/Saransh/agents/src/lock.ts:20), [src/pipeline.ts:70](/Users/khannasaransh/Saransh/agents/src/pipeline.ts:70), [src/process.ts:30](/Users/khannasaransh/Saransh/agents/src/process.ts:30).

The lock tracks only the runner PID. Killing that process leaves its Step and Worker able to continue, while a new run considers the lock stale and starts. A reproduction killed only the runner during a stand-in Worker call: the replacement run completed while the old Worker was alive, and the old review subsequently wrote its output.

**Action:** make process ownership and recovery cover the whole active run. Before admitting a replacement run, establish that prior Steps and Workers have stopped. Signal handling alone is insufficient for an uncatchable runner crash.

**Regression:** kill only the runner during Review and verify that a replacement cannot overlap surviving work or allow late writes from an abandoned run.

### C02 — [P2] Make stale-lock takeover atomic

**Evidence:** [src/lock.ts:19](/Users/khannasaransh/Saransh/agents/src/lock.ts:19).

Two processes can both read the stale PID. After the first removes the old lock and creates a new one, the second can delete that new lock and acquire its own. A controlled interleaving reproduced both processes acquiring the lock while alive. Exclusive creation protects normal acquisition, but not the preceding stale-lock removal.

**Action:** serialize stale-lock recovery and ensure a process cannot remove or release another owner’s lock.

**Regression:** start two contenders against a stale lock and require exactly one owner throughout takeover and release.

### C03 — [P2] Restrict Codex to the declared write folders

**Evidence:** [src/workers/codex.ts:33](/Users/khannasaransh/Saransh/agents/src/workers/codex.ts:33), [test/workers.test.ts](/Users/khannasaransh/Saransh/agents/test/workers.test.ts).

`workspace-write` permits writes to `cwd` as well as the directories passed with `--add-dir`. The Worker assumes, but does not enforce, that its working directory is one of the permitted write locations. The writer test supplies a parent working directory while declaring only its `wiki` subfolder and another directory writable. That configuration grants broader access than declared.

**Action:** reject an incompatible working directory or construct a sandbox whose effective writable roots match the declaration. This affects the generic write-capable Worker path; the default Reviewer remains configured read-only.

**Regression:** a writer restricted to a subfolder must not receive write access to siblings in its parent directory.

### C04 — [P2] Finalize Brief health after Save state

**Evidence:** [steps/brief.ts:66](/Users/khannasaransh/Saransh/agents/steps/brief.ts:66), [pipelines/daily.ts](/Users/khannasaransh/Saransh/agents/pipelines/daily.ts).

Brief runs before Save state and permanently records it as pending. This was reproduced on a successful daily run. A later Save state failure is also absent from the Brief.

**Action:** finalize or refresh the health section after Save state, preserving the requirement that a Brief is still produced when earlier work fails. Reconcile this ordering in the PRD as well.

**Regression:** check the final Brief for both successful and failed Save state outcomes, rather than checking only `run.json`.

### C05 — [P2] Match the review range before displaying cached findings

**Evidence:** [steps/brief.ts:57](/Users/khannasaransh/Saransh/agents/steps/brief.ts:57).

Brief joins reviews to Fetch results by repository name alone. After `fetch --force` and then `brief --force`, an old review appears beside newly fetched commits. A reproduction displayed a review of the first commit and “No findings” under a two-commit list.

**Action:** require the review’s `from` and `to` to match the fetched range. Explicitly report an absent or stale review. Define how an upstream retry affects downstream completion status so an old successful Step does not imply its new inputs were processed.

**Regression:** extend a fetched range without rerunning Review; the regenerated Brief must not present the old result as covering the new range.

## 2. Additional design gaps retained from the code review

### D01 — [P1] Give downstream consumers independent progress tracking

**Evidence:** [PRD:170](/Users/khannasaransh/Saransh/agents/docs/prd.md:170), [PRD:204](/Users/khannasaransh/Saransh/agents/docs/prd.md:204), [issue 10](/Users/khannasaransh/Saransh/agents/docs/issues/10-docs-agent-wiki-updates-from-commits.md).

Fetch derives changes from the last reviewed commit, and Save state advances that cursor when Review succeeds. If Docs fails on the same run, the next run can report no new commits, leaving the wiki update outside its workload. Successful Discord ingestion followed by a PM failure creates a similar risk for messages not yet turned into durable open items.

**Required design:** independent consumer cursors or a durable backlog with acknowledgement per consumer. Retries must recover unprocessed work across runs without requiring a manual replay of the old run. Define initial baselines for consumers introduced after reviews have already been running.

**Acceptance:** Review succeeds and Docs fails; a later run with no new commits still retries the wiki update. Likewise, PM receives previously ingested messages after a failed PM run.

### D02 — [P2] Specify replay-safe Memory and PRD processing

**Evidence:** [issue 06](/Users/khannasaransh/Saransh/agents/docs/issues/06-agent-memory.md), [issue 11](/Users/khannasaransh/Saransh/agents/docs/issues/11-docs-agent-prd-inbox.md).

The tickets describe successful writes but do not define recovery between side effects. Replaying Save state must not apply a Memory proposal twice or overwrite a newer manual edit. A crash between committing a PRD page and moving its inbox file must not duplicate the page or lose the input.

**Proposed acceptance:** associate proposals and processed inputs with stable IDs; detect changed Memory before applying an old proposal; acknowledge a PRD only after the required checks and commit succeed; test crashes and retries at these boundaries. These are future acceptance gaps, not defects in an already implemented Memory or Docs Step.

## 3. Validation of the supplied review

### V01 — Skipped Steps: valid gap; proposed outcome is not yet agreed

The runner supports only success and failure from a Step’s exit. The PRD says any skipped Step makes a run partial, while issue 08 says unconfigured Discord is skipped and the run is otherwise unaffected. The ambiguity is real. However, the pasted proposal that an unconfigured skip leaves the run succeeded does **not** follow story 10, which explicitly includes skipped Steps in partial runs.

Define expected optional skips separately from failures and unfinished required work, decide their aggregate status, and specify how a Step reports them. A structured result file or a documented exit-code mapping are possible; an exit-code protocol is not intrinsically incapable of representing skip. “Skip a Repo after a failed fetch” is a per-Repo operation, not necessarily a skipped Step.

Sources: [PRD Step contract](/Users/khannasaransh/Saransh/agents/docs/prd.md:157), [issue 08:10](/Users/khannasaransh/Saransh/agents/docs/issues/08-discord-step.md:10), [src/pipeline.ts:78](/Users/khannasaransh/Saransh/agents/src/pipeline.ts:78).

### V02 — “Never merge”: valid contradiction

Issue 10 both requires merging main into the docs branch and prohibits merging. State the direction explicitly: updating the docs branch from main is allowed; merging the docs branch into main and pushing are prohibited. On conflict, abort the integration and restore the pre-attempt branch state.

Source: [issue 10:10](/Users/khannasaransh/Saransh/agents/docs/issues/10-docs-agent-wiki-updates-from-commits.md:10).

### V03 — To-do rules: valid contradiction; PM-only ownership is a proposal

The PRD requires settling To-do rules before PM ships; issue 07 permits leaving them open. Define stable identity, creation, carry-forward, completion and dismissal. Issue 09 explicitly permits download links to appear in the Brief without depending on PM, so making PM the only producer is a design change, not an existing requirement. A deterministic download-link To-do can coexist with PM-generated items if ownership and deduplication are explicit. Also define how same-run wiki drafts reach To-dos: the current planned PM Step precedes Docs.

Sources: [PRD:308](/Users/khannasaransh/Saransh/agents/docs/prd.md:308), [issue 07:10](/Users/khannasaransh/Saransh/agents/docs/issues/07-pm-agent-and-the-full-brief.md:10), [issue 09](/Users/khannasaransh/Saransh/agents/docs/issues/09-prds-from-discord.md).

### V04 — Baseline ownership: outdated; reject the proposed implementation change

Fetch now records a baseline result in the Run folder. Save state explicitly persists that baseline and advances later ranges only after a successful real review. Existing tests cover this distinction, including a dry run recording a first baseline without counting a fake review as completed. Sharing the field is not currently dropping baselines.

Keep the current ownership and clarify issue 02’s wording: persist initial baselines; advance subsequent review ranges only after successful real reviews. Do not move persistence back into Fetch based on the pasted review.

Sources: [steps/save-state.ts:21](/Users/khannasaransh/Saransh/agents/steps/save-state.ts:21), [test/save-state.test.ts](/Users/khannasaransh/Saransh/agents/test/save-state.test.ts).

### V05 — Schedule time and installer: partly valid

The time is already explicit in the PRD’s Schedule section and issue 12: weekdays at 05:30 Singapore local time, equivalent to 03:00 IST. The opening’s shorter description is not a contradictory schedule. Specify what happens if the Mac’s timezone changes rather than treating the current conversion as incorrect.

The setup integration gap is valid: story 74 requests installation during setup, while issues 12–14 do not connect setup to the schedule installer. Specify that setup invokes the shared installation implementation on macOS, with standalone `agents schedule install` still available.

Sources: [PRD:124](/Users/khannasaransh/Saransh/agents/docs/prd.md:124), [PRD:254](/Users/khannasaransh/Saransh/agents/docs/prd.md:254), [issue 12](/Users/khannasaransh/Saransh/agents/docs/issues/12-schedule.md).

### V06 — Second opinion and cost reporting: valid clarification, not a proven model violation

The usual writing model is not recorded, so compliance with story 27 cannot be established. A different CLI is not necessarily a different model. Record the intended model distinction and decide whether availability may override it on fallback.

Worker/model/effort and fallback attempts already appear in logs; they are absent from the structured review result and Brief. Adding them there would make the distinction auditable. A repository review count is deliberately a rough cost signal; it is not an accurate count of Worker attempts, tokens or charges. Label it accordingly, and optionally add attempt and fallback counts.

Sources: [agents/reviewer/config.ts](/Users/khannasaransh/Saransh/agents/agents/reviewer/config.ts), [src/worker.ts](/Users/khannasaransh/Saransh/agents/src/worker.ts), [steps/review.ts](/Users/khannasaransh/Saransh/agents/steps/review.ts).

### V07 — Step definition and I/O contract: valid inconsistency

Review is one Step containing several Agent calls, conflicting with the glossary’s single-call wording. “Writes only to the Run folder” also excludes required state, git metadata, Memory, inbox and wiki operations. Fixed pipeline order can include a defined parallel phase, but the Review/Discord join before PM should be explicit.

Define a Step as one independently invocable command with persisted inputs/results, allowed external resources and side effects, and an outcome. List permissions per Step rather than granting every Step all shared locations. Reconcile the PRD, glossary and ADR together.

Sources: [GLOSSARY.md](/Users/khannasaransh/Saransh/agents/GLOSSARY.md), [ADR 0001](/Users/khannasaransh/Saransh/agents/docs/adr/0001-script-pipeline-with-step-contract.md), [PRD:160](/Users/khannasaransh/Saransh/agents/docs/prd.md:160).

### V08 — Wiki inputs and branch lifecycle: valid readiness gaps

Issue 10 lacks a concrete wiki configuration contract: checkout or remote, main branch, rolling branch, Agent instructions/skill/tool locations, commit identity resolution and trailer keys. Resolve these before implementing integration with the actual wiki. Git identity may be inherited, but its source and missing-value behavior should be stated.

Define how an integrated branch is detected after merge commits, squash merges or rebases; ancestry alone does not establish all of those cases. Define “large changes,” the behavior when checks cannot pass within the call limit, and where failed draft work remains for inspection. Timeout/turn limits already exist in the Worker layer; the missing part is the Docs transaction’s outcome and recovery. Actual wiki compatibility was not verified in this review.

Sources: [issue 10](/Users/khannasaransh/Saransh/agents/docs/issues/10-docs-agent-wiki-updates-from-commits.md), [PRD:186](/Users/khannasaransh/Saransh/agents/docs/prd.md:186).

### V09 — Discord access and durable provenance: valid, with narrower wording

For general channel ingestion, Message Content access is a real prerequisite even when using REST. Without it, content and attachment fields can be empty; exceptions exist, including messages mentioning the **bot**, so “Discord will come back empty” is too absolute. Mentioning Saransh is not that exception. Document access prerequisites and use the structured mention user IDs for the requested flag. [Discord’s official intent documentation](https://docs.discord.com/developers/events/gateway#message-content-intent).

Specify channel IDs, pagination, accessible archived/private thread coverage, missing-permission behavior, attachment formats, stable attachment IDs, and persistent source-message metadata. The provenance requirement already exists in issues 09 and 11; its durable storage contract is missing. A sidecar or manifest is suitable but not mandatory. Deduplication should survive moving an input to done/skipped, not just check the current inbox. The env path is already implemented as repository `.env`, overridable through `AGENTS_ENV_FILE`; reuse that convention.

Sources: [issue 08](/Users/khannasaransh/Saransh/agents/docs/issues/08-discord-step.md), [issue 09](/Users/khannasaransh/Saransh/agents/docs/issues/09-prds-from-discord.md), [src/env.ts:6](/Users/khannasaransh/Saransh/agents/src/env.ts:6).

### V10 — Repo seed metadata: counts are valid; reconstruction is unnecessary

The committed list contains 29 Repos: 16 on `main`, three on `development`, seven on `master`, and three on `ind-production`. All three data-team Repos use `backend/` folders on this Mac, and `inpix_flutter` has an SSH remote. These facts were checked programmatically against the current list; remote production branches were not independently audited.

The PRD already says to seed from local clones, rather than derive every branch from the abbreviated Team list. Now that issue 01 exists, identify the committed Repo list as the authoritative inventory and preserve its metadata during setup. Do not duplicate it into a competing list in the PRD.

Source: [repos.ts](/Users/khannasaransh/Saransh/agents/repos.ts).

### V11 — Duplicate data clones during setup: valid design risk, not an existing bug

Setup has not been implemented. A future implementation checking only `<root>/<team>/<name>` could duplicate the existing data-team clones under `backend/`. The PRD explicitly preserves current Mac folders and uses Team folders on new machines, so setup must distinguish those cases.

Use a machine-specific path resolution strategy: honor configured existing clones on this Mac, use the selected root and Team layout on a fresh machine, and ensure the pipeline resolves the resulting locations on a fresh Mac. The pasted claim that the pipeline runs only on “this Mac” is too narrow: the PRD supports macOS pipeline execution and setup on a new Mac. Preserve shared inventory while allowing local path overrides.

Sources: [PRD:243](/Users/khannasaransh/Saransh/agents/docs/prd.md:243), [issue 13](/Users/khannasaransh/Saransh/agents/docs/issues/13-machine-setup-repos-by-team.md), [src/repos.ts](/Users/khannasaransh/Saransh/agents/src/repos.ts).

### V12 — Review, retries and dry runs: mostly implemented; document the actual choices

The following are already present: four severities (`critical`, `high`, `medium`, `low`), concurrency of three reviews, Step-owned worktree creation/removal, fallback on schema-invalid real Worker answers, retry of failed units, and reuse of successful reviews only for the same range. The whole-pipeline dry-run test also already exists.

The current Brief sorts Saransh’s findings first, then severity. Tests explicitly assert that order. The pasted severity-first alternative is a policy proposal, not a demonstrated bug; make the chosen ordering unambiguous before changing it.

`--dry-run` replaces Workers, not all side effects. Fetch still fetches, temporary worktrees are used, and initial baselines can be persisted. Discord is not implemented yet; the present PRD does not promise that a future dry run will be offline. Document this boundary, the existing test/environment overrides, and how success/failure—not mere file existence—determines reusable work. C05 remains a separate downstream stale-output defect.

Sources: [agents/reviewer/config.ts:5](/Users/khannasaransh/Saransh/agents/agents/reviewer/config.ts:5), [steps/review.ts:47](/Users/khannasaransh/Saransh/agents/steps/review.ts:47), [steps/brief.ts:18](/Users/khannasaransh/Saransh/agents/steps/brief.ts:18), [test/run.test.ts](/Users/khannasaransh/Saransh/agents/test/run.test.ts), [test/helpers.ts](/Users/khannasaransh/Saransh/agents/test/helpers.ts).

### V13 — Antigravity and unnamed fallbacks: valid planning concern; current exposure is overstated

There is no Antigravity Worker implementation in the registry. The Reviewer uses Codex with Claude Code fallback; it does not presently fall back to Antigravity. PM and Docs configs do not exist yet, while shared config validation already requires a fallback. Their future tickets should name the intended Worker/model/effort choices.

The PRD reports historical Antigravity allowlist and process-lifecycle bugs. Their status in current releases was not independently verified. Require capability tests and effective isolation for any Worker before enabling it for a restricted Agent; a fallback designation does not itself enforce permissions. Deferring issue 05 until there is a consumer is reasonable scope management, not a correctness fix required by current code.

Sources: [issue 05](/Users/khannasaransh/Saransh/agents/docs/issues/05-antigravity-worker-as-fallback.md), [src/worker.ts](/Users/khannasaransh/Saransh/agents/src/worker.ts), [src/agent.ts:55](/Users/khannasaransh/Saransh/agents/src/agent.ts:55).

### V14 — Tools and skills dependency: valid

Issue 10 should depend on issue 04 because its wiki tools and skills require that capability. Issue 11 already depends on 10, so it gains the dependency transitively; an additional direct edge is optional. Define the trusted wiki skill/tool source and delivery mechanism as well as Agent-owned resources. Merely being present in the wiki is not a complete delivery contract.

Sources: [issue 04](/Users/khannasaransh/Saransh/agents/docs/issues/04-tools-and-skills-for-agents.md), [issue 10:5](/Users/khannasaransh/Saransh/agents/docs/issues/10-docs-agent-wiki-updates-from-commits.md:5), [issue 11:5](/Users/khannasaransh/Saransh/agents/docs/issues/11-docs-agent-prd-inbox.md:5).

### V15 — Schedule dependency and refused starts: partly valid

The PRD puts scheduled operation last, but issue 12 only depends on the skeleton. Building and testing a scheduler early is not inherently wrong. Distinguish implementation dependencies from the readiness gate for enabling unattended operation; choose which completed Steps and fixes that gate requires.

The CLI already prints an error when the lock refuses a start. The missing requirement is durable scheduler-level capture when no Run folder is created. Configure stdout/stderr or a dedicated scheduling log and state whether lock refusal merely skips that invocation or queues a later attempt. Review cursors preserve unreviewed commits, but that alone does not guarantee a Brief that morning.

Sources: [issue 12](/Users/khannasaransh/Saransh/agents/docs/issues/12-schedule.md), [src/cli.ts](/Users/khannasaransh/Saransh/agents/src/cli.ts), [PRD:322](/Users/khannasaransh/Saransh/agents/docs/prd.md:322).

### V16 — LaunchAgent environment and version checks: valid additions

A user LaunchAgent executes while that user is logged in. Sleep recovery and power-off recovery differ: a missed calendar trigger runs on wake from sleep, whereas a trigger missed while powered off waits for the next scheduled time. State these operating limits and validate credential availability in the intended unattended session. [Apple’s user-agent documentation](https://developer.apple.com/library/archive/documentation/MacOSX/Conceptual/BPSystemStartup/Chapters/CreatingLaunchdJobs.html), [Apple’s scheduling documentation](https://developer.apple.com/library/archive/documentation/MacOSX/Conceptual/BPSystemStartup/Chapters/ScheduledJobs.html).

The Node requirement already exists in `package.json` as `>=25`; setup must check it, not merely command presence. Define how the `agents` entry point becomes executable/discoverable—linking its bin or using explicit executable/script paths are both valid—and provide the Worker/git environment. Replace dated “current version” prose with maintained compatibility requirements, including Claude Code. Do not confuse a supported minimum with a claim to know the latest release.

Sources: [package.json](/Users/khannasaransh/Saransh/agents/package.json), [issue 12](/Users/khannasaransh/Saransh/agents/docs/issues/12-schedule.md), [issue 13:12](/Users/khannasaransh/Saransh/agents/docs/issues/13-machine-setup-repos-by-team.md:12), [PRD:317](/Users/khannasaransh/Saransh/agents/docs/prd.md:317).

### V17 — Issue status and documenting implemented behavior: valid, with qualifications

Issues 01–03 all remain `ready-for-agent` with unchecked criteria despite their implementation commits. Reconcile status against evidence, retaining unresolved defects and the unverified live-Codex criterion. Do not automatically mark issue 01 complete solely because code exists.

Document the existing suffix for multiple runs in one minute, shared lock for standalone Step execution, per-Repo Fetch timeout and failure aggregation, and abandoned-run status. The Run naming contract says the name **starts** with date/time, so the suffix already conforms. Stale-lock recovery exists but has C01/C02 defects; do not describe it as fully safe. The claim that Fetch updates only one ref is too strong: its explicit destination is the production tracking ref, but fetching also writes git objects and metadata.

Sources: [src/run.ts](/Users/khannasaransh/Saransh/agents/src/run.ts), [src/pipeline.ts](/Users/khannasaransh/Saransh/agents/src/pipeline.ts), [steps/fetch.ts](/Users/khannasaransh/Saransh/agents/steps/fetch.ts), [issue 03:15](/Users/khannasaransh/Saransh/agents/docs/issues/03-real-workers-codex-and-claude-code.md:15).

### V18 — Preserve the issue-specific requirements: valid

Retain rate-limit handling and successful-ingestion cursors in issue 08; attachment deduplication in 09; conflict recovery in 10; tool/version checks in 13; and backups, path rewriting and secret exclusion in 14. These are already acceptance criteria, not new missing features. Clarify that installing interactive Worker MCP configuration does not grant pipeline Agents MCP Tools in v1. D01 adds consumer acknowledgement without discarding the ingestion cursor.

Sources: [issues 08–14](/Users/khannasaransh/Saransh/agents/docs/issues), [PRD:302](/Users/khannasaransh/Saransh/agents/docs/prd.md:302).

## 4. Recommended follow-up order

| Order | Work | References | Completion evidence |
| --- | --- | --- | --- |
| 1 | Fix active-run ownership and stale-lock takeover | C01, C02; issues 01/03 | Parent-only crash and simultaneous takeover tests pass without overlap. |
| 2 | Correct Worker write scope and Brief validity | C03–C05; issues 02/03 | Restricted writer, final health and changed-range Brief checks pass. |
| 3 | Reconcile the shared contracts | V01–V07, V12, V17 | PRD, ADR, glossary and issues agree on outcomes, baseline ownership, retries, ordering and side effects. |
| 4 | Specify durable processing and wiki integration | D01, D02, V08, V14; issues 06/07/10/11 | Consumer progress, replay semantics, wiki config and skill/tool dependencies are explicit. |
| 5 | Complete Discord and inbox contracts | V03, V09, V18; issues 08/09/11 | Access setup, coverage, stable IDs, durable provenance and To-do ownership are testable. |
| 6 | Complete setup and unattended-operation requirements | V05, V10/V11, V15/V16; issues 12–14 | Existing-clone reuse, fresh-Mac path resolution, executable/runtime checks and scheduler logs are specified. |
| 7 | Choose Worker/model fallback policy and optional scope | V06, V13; issues 05/07/10 | Defaults and degraded second-opinion behavior are documented; unsafe capabilities cannot be enabled silently. |

## 5. Verification and limits

- The earlier code review in this chat ran the suite against this same commit: **52/52 tests passed**, and **`npm run typecheck` passed**. Five tests initially failed because the sandbox prohibited their loopback listeners; the rerun with loopback access passed all tests.
- C01, C02, C04 and C05 were reproduced using temporary fixtures. C02 used controlled interleaving to exercise the stale-lock race. C03 was confirmed from the command construction, installed CLI help and the writer test fixture; it was not a live model-driven write test.
- During consolidation, the current files and unchanged commit were checked again, and the Repo branch distribution was counted programmatically. Discord and launchd claims were checked against the official sources linked above. The unchanged test suite was not rerun merely for this document.
- No paid live Worker call, actual wiki integration, Discord account setup, remote production-branch audit or current Antigravity capability test was performed. Issue 03’s live-Codex acceptance criterion remains unverified by this review.
- This consolidation creates this report only. It does not implement fixes, revise the PRD or issue criteria, mark tickets complete, install a schedule or publish anything.
