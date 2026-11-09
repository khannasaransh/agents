# 03: Real Workers: Codex and Claude Code

**What to build:** Saransh runs `agents run daily` without `--dry-run` and the Reviewer really reviews a Repo on Codex, falling back to Claude Code if Codex fails, times out or hits a quota limit. See the PRD's "Workers".

**Blocked by:** 02: Reviewer Agent on the fake Worker

**Status:** done, but for confirming a real review on the Mac (see Notes)

- [x] A Codex Worker runs an Agent through non-interactive exec, requests JSON output and, when the Agent has a schema, Codex's schema-checked final answer.
- [x] A Claude Code Worker runs an Agent through headless print mode with JSON output and its schema option, on Saransh's logged-in subscription (never the minimal mode that ignores that login).
- [x] Each Worker maps the Agent's permissions onto the CLI's sandbox or allowlist: read-only for the Reviewer, named write folders otherwise; nothing runs with permission checks disabled.
- [x] Each Worker enforces the Agent's timeout by ending the process and passes the maximum number of turns where the CLI supports it.
- [x] A failed, timed-out or quota-limited call is retried once on the fallback Worker, and both attempts are logged in the Run.
- [x] Command-line tests check, without starting any CLI, that each Worker builds the right command line for a given Agent config.
- [ ] A real Run reviews at least one changed Repo on Codex and the findings appear in the Brief.

**Notes:**

- **Checked on 4 November 2026** against the code and its tests, after this issue's status had gone stale: `test/workers.test.ts` covers the command lines and `test/review.test.ts` the timeouts and the fallback. The last box stays open because it can't be checked from the Windows machine: the daily Pipeline runs on the Mac, so no Run of it is here. A Mac Run's Brief with Codex findings closes it. The Reviewer and the daily PM now both run on `gpt-6-astra`.
