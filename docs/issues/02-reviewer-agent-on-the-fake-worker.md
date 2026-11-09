# 02: Reviewer Agent on the fake Worker

**What to build:** Saransh runs `agents run daily --dry-run` and the Brief now carries review findings for every Repo with new commits, produced by the Reviewer Agent through a fake Worker. This ticket brings in the Eve-style Agent folder (config, instructions, schema), the Worker interface with its fake implementation, the Review Step, and Save state. See the PRD's "Agents", "Workers" and the Review and Save state Steps.

**Blocked by:** 01: Run skeleton: fetch and list new commits

**Status:** done

- [x] An Agent is a folder with a config module and an instructions file; its config declares Worker, fallback Worker, model, effort, permissions, inputs, outputs, an optional output schema, a timeout and a maximum number of turns, and invalid configs fail with a clear message.
- [x] One Worker interface ("call this Agent with these inputs, return its result") exists, with a fake Worker that returns canned results and can simulate failures.
- [x] `--dry-run` runs every Agent Step on the fake Worker.
- [x] The Review Step runs one Reviewer call per Repo with new commits, a few at a time, and none for unchanged Repos.
- [x] Each review runs in a temporary clean worktree of the production branch at the new head, which is removed afterwards even when the call fails.
- [x] The Reviewer's output is checked against a findings schema: severity, file, line, commit, author, summary, whether Saransh wrote it, plus a summary of what changed.
- [x] Saransh's git author emails are read from the local env file and used to mark his commits.
- [x] The Brief shows findings by severity, with Saransh's own first.
- [x] Save state advances the last reviewed commit only for Repos whose review succeeded; a failed review is retried in the next Run.
- [x] Step tests cover a changed Repo, an unchanged Repo, a failed review and worktree cleanup.

**Notes:**

- **Checked on 4 November 2026** against the code and its tests, after this issue's status had gone stale: `test/agent.test.ts`, `test/review.test.ts`, `test/save-state.test.ts` and `test/brief.test.ts` cover each box, the fake Worker being `src/workers/fake.ts`.
