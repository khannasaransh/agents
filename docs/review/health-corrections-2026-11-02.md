# Health and newer corrections, 2 November 2026

Saransh approved all 14 newer Corrections in the Brief of Run `2026-11-01-1901` and requested Codex CLI for Health and validation of the freshly replaced MarketSmith cookie.

## Approvals

The normal Answers Step applied all 14 approvals successfully: IDs 1–5 and 141–149. Its source file is archived under that Run's `answers/` directory; `answers.json` records every outcome. No quarantine dismissal was included. The Lake Step is being rerun to apply these corrections to refreshed data.

## Codex CLI

Health now uses `codex` with `gpt-6-astra`, high reasoning, matching the installed CLI's account-supported model. The previous `gpt-6.1-sol` model was rejected by the ChatGPT-authenticated CLI. Claude Code remains the fallback; the separately configured Cursor adversary is unchanged.

The adapter previously forced the unelevated Windows sandbox, which cannot enforce denied reads. It now selects the already provisioned elevated sandbox. Read-only access, denied undeclared Tools, disabled extra tools and skill restrictions remain enforced. No global CLI configuration was changed.

A real sandbox probe verified an allowed file could be read while a denied file and a write were blocked. A live call through the complete worker adapter read a harmless fixture and returned schema-valid JSON on the Health model. The installed CLI does not recognize `features.prefer_mxc`, so that speculative option was removed before the final verification.

Validation: all 43 focused Worker, Health and Answers tests passed, TypeScript checking passed, and the Worker tests passed again after final configuration cleanup.

## Cookie

The Global cookie and India authentication values parse successfully from ash_new's `.env`, with no literal outer quotes, control characters or duplicate definitions. Double quotes around the value are valid. Live authenticated searches returned 5,596 US symbols and 2,827 HK symbols; an India RELIANCE search succeeded too. No cookie value was displayed or copied. This verifies authentication, not a full MarketSmith dataset refresh.

Sash sync remains disabled as explicitly requested. The alarm decision remains open.

## Live Health rerun

Lake refresh job `554` completed successfully at 11:39 Singapore time after rebuilding all markets' fundamentals and panels and rerunning 120 stale strategy backtests. The data gate passed.

At 11:06 Singapore time, Saransh requested the complete pipeline again. The idle Health-only follow-up helper was stopped after verifying it had no active work, and replaced with `data/codex-sandbox-probe/run-complete-stocks.mjs`. This runner waits for the normal pipeline lock, then calls the same `runPipeline('stocks')` entry point as the CLI, with live workers and no worker override. It creates a new Run and executes all configured steps. Saturday-only MarketSmith/review scheduling and disabled Sash sync remain in effect. The active lake refresh was not interrupted.

Queue and final outcomes are recorded in `data/codex-sandbox-probe/complete-stocks-status.json`; logs are `complete-stocks.stdout.log` and `complete-stocks.stderr.log` in that directory.

The complete Run `2026-11-02-1139` ran from 11:39 to 11:44 Singapore time and ended partial. Its Lake refresh succeeded and the data gate passed; all 14 corrections remain approved, with none pending. The deterministic health report has 726 flags and 647 quarantined securities. Health's main Codex call hit its usage limit (retry time reported as 13:37), and Claude's fallback hit its weekly limit (23:00 reset). The Cursor adversary could not launch its unsupported Windows command wrapper. Plan produced no Rule plans because the preceding day was Sunday, so Desk and Portfolio Manager skipped and no orders were recorded. This matches the documented Tuesday–Saturday run schedule and closed-previous-day policy; it was not changed to force a Monday trade plan. Saturday-only steps and disabled Sash sync also skipped.

At 15:37 Singapore time, following Saransh's request to continue, the Health Step was retried on this latest Run after Codex's reported reset time. Codex (`gpt-6-astra`, high) completed the diagnosis at 15:44; the Brief was regenerated at 15:45. The Run now records `succeeded`, which permits scheduled skips and does not require a successful independent assessment. Portfolio Manager and Desk remain skipped under the Monday calendar policy, so this is not an end-to-end verification of their live execution.

Health identified mixed adjusted/unadjusted histories in ten US securities and other source-quality issues. These remain diagnosis and proposed repairs, not applied changes. It recorded two new split proposals: ID 150 for `HK:01351` (2026-10-15, ratio 0.2) and ID 151 for `US:CHOW` (2026-10-26, ratio 0.1). Both await approval and exchange-announcement verification; the prior approval of 14 corrections does not cover these.

The Cursor launch failure was reproduced with `commandLine('.../cursor-agent/agent.cmd', ['--version'])`. Its installed batch/PowerShell wrapper resolves a versioned Node bundle. The command resolver now recognises this launcher and starts that bundle directly, preserving argument boundaries without enabling shells for arbitrary batch scripts. A regression test failed before the change and passed afterward; the real `agent --version` now succeeds through the process adapter. A subsequent read-only live probe exposed a separate platform limitation: this Cursor CLI's enabled sandbox requires macOS or Linux and is unavailable on Windows. Its sandbox was not disabled. The completed Health result accurately retains its independent-assessment failure from before the launcher fix.
