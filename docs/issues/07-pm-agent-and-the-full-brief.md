# 07: PM Agent and the full Brief

**What to build:** Each Run ends with a PM Agent on Claude Code that turns reviews, commits and (when present) Discord messages into a line per Repo, highlights and To-dos, and a Brief that renders every section the PRD lists, even when an Agent fails. See the PRD's PM and Brief Steps.

**Blocked by:** 03: Real Workers: Codex and Claude Code; 06: Agent Memory

**Status:** done

- [x] The PM Agent runs on Claude Code with review outputs, commit summaries, Discord messages if any, the Run's health so far and its Memory as inputs.
- [x] Its output is checked against a schema with a line per Repo, highlights and a To-dos field; the rules for To-dos stay open, and the field may be empty.
- [x] The PM Agent carries open items from earlier Runs in its Memory.
- [x] The Brief Step renders, grouped by Team: per-Repo lines, findings by severity with Saransh's first, highlights, To-dos, the number of Repos reviewed, and Run health.
- [x] When the PM Agent fails, the Brief is still written from the review outputs and Run health, and says the PM output is missing.
- [x] The Brief is a Markdown file in the Run folder; nothing is posted and no notification is sent.
- [x] Step tests cover a full Brief, a Brief after a PM failure, and a Brief with no Discord input.

**Decided while building:** the daily Pipeline runs PM between Review and Save state. PM falls back to Codex and runs read-only in the Run folder, so Codex now skips its git repo check. Its `discord` input is null until the Discord Step (08) exists, and the Brief then says no Discord messages were read. PM writes `pm.json` in the Run folder, recording a failure there too. Its Memory is one file, `memory/pm/notes.md`, which Save state applies or queues like the Reviewer's, never from a dry run. The Brief opens with To-dos and Discord highlights, puts each Repo's PM line under its heading, and counts the Repos reviewed in Run health.
