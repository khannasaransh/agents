# 07: PM Agent and the full Brief

**What to build:** Each Run ends with a PM Agent on Claude Code that turns reviews, commits and (when present) Discord messages into a line per Repo, highlights and To-dos, and a Brief that renders every section the PRD lists, even when an Agent fails. See the PRD's PM and Brief Steps.

**Blocked by:** 03: Real Workers: Codex and Claude Code; 06: Agent Memory

**Status:** ready-for-agent

- [ ] The PM Agent runs on Claude Code with review outputs, commit summaries, Discord messages if any, the Run's health so far and its Memory as inputs.
- [ ] Its output is checked against a schema with a line per Repo, highlights and a To-dos field; the rules for To-dos stay open, and the field may be empty.
- [ ] The PM Agent carries open items from earlier Runs in its Memory.
- [ ] The Brief Step renders, grouped by Team: per-Repo lines, findings by severity with Saransh's first, highlights, To-dos, the number of Repos reviewed, and Run health.
- [ ] When the PM Agent fails, the Brief is still written from the review outputs and Run health, and says the PM output is missing.
- [ ] The Brief is a Markdown file in the Run folder; nothing is posted and no notification is sent.
- [ ] Step tests cover a full Brief, a Brief after a PM failure, and a Brief with no Discord input.
