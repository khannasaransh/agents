# The Pipeline is a plain script with a Step contract

The daily Pipeline is plain TypeScript run by launchd, not an agent and not a workflow engine. Its steps are fixed, so code runs them in order and calls a Worker only at the Steps that need judgment: reviewing commits, writing the PM output, and updating the wiki. Every Step is a standalone command that reads its inputs from the Run folder, writes its outputs there, exits non-zero on failure (78 when it skips itself, such as Discord before the bot is set up) and is safe to re-run, so Dagu can replace the Pipeline file later without any Step being rewritten.

## Considered Options

- **An agent as orchestrator** (one Claude or Codex session that runs the other Agents): rejected because the order never changes, and a model deciding it adds cost and makes Runs differ for no gain.
- **Vercel Eve**: rejected because it cannot use Claude Code, Codex or Antigravity as Workers on Saransh's subscriptions, and its tools cannot reach local Repos without custom code. Its folder-per-Agent layout is kept.
- **Dagu from the start**: deferred. It adds run history, retries and a web UI, but also a daemon, a second place for logic, and a fast-moving dependency, which one Pipeline for one user does not need yet.
- **Claude Code saved workflows**: rejected as the orchestrator because a workflow script cannot run shell commands itself and only spawns Claude subagents.
