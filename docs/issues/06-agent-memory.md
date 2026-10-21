# 06: Agent Memory

**What to build:** The Reviewer remembers each Repo's conventions and the findings Saransh has waved off, from one Run to the next. Agents propose Memory changes in their output and Save state applies them, so every change is logged with its Run. See the PRD's "Agents" (Memory).

**Blocked by:** 02: Reviewer Agent on the fake Worker

**Status:** ready-for-agent

- [ ] Each Agent has Memory as Markdown notes; the Reviewer has one Memory file per Repo.
- [ ] Memory is read at the start of an Agent call and given to the Worker as input.
- [ ] Agents propose Memory edits in their output; Save state applies them and records each change in the Run.
- [ ] Memory lives in the git-ignored data area and is never deleted automatically.
- [ ] Saransh can edit a Memory file by hand and the next Run uses his version.
- [ ] Step tests cover reading Memory, applying a proposed edit, and a Run whose Agent proposes no edits.
