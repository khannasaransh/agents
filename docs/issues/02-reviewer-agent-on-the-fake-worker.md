# 02: Reviewer Agent on the fake Worker

**What to build:** Saransh runs `agents run daily --dry-run` and the Brief now carries review findings for every Repo with new commits, produced by the Reviewer Agent through a fake Worker. This ticket brings in the Eve-style Agent folder (config, instructions, schema), the Worker interface with its fake implementation, the Review Step, and Save state. See the PRD's "Agents", "Workers" and the Review and Save state Steps.

**Blocked by:** 01: Run skeleton: fetch and list new commits

**Status:** ready-for-agent

- [ ] An Agent is a folder with a config module and an instructions file; its config declares Worker, fallback Worker, model, effort, permissions, inputs, outputs, an optional output schema, a timeout and a maximum number of turns, and invalid configs fail with a clear message.
- [ ] One Worker interface ("call this Agent with these inputs, return its result") exists, with a fake Worker that returns canned results and can simulate failures.
- [ ] `--dry-run` runs every Agent Step on the fake Worker.
- [ ] The Review Step runs one Reviewer call per Repo with new commits, a few at a time, and none for unchanged Repos.
- [ ] Each review runs in a temporary clean worktree of the production branch at the new head, which is removed afterwards even when the call fails.
- [ ] The Reviewer's output is checked against a findings schema: severity, file, line, commit, author, summary, whether Saransh wrote it, plus a summary of what changed.
- [ ] Saransh's git author emails are read from the local env file and used to mark his commits.
- [ ] The Brief shows findings by severity, with Saransh's own first.
- [ ] Save state advances the last reviewed commit only for Repos whose review succeeded; a failed review is retried in the next Run.
- [ ] Step tests cover a changed Repo, an unchanged Repo, a failed review and worktree cleanup.
