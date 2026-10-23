# 06: Agent Memory

**What to build:** The Reviewer remembers each Repo's conventions and the findings Saransh has waved off, from one Run to the next. Agents propose Memory changes in their output and Save state applies them, or queues them for Saransh to accept or reject, so every change is logged with its Run. See the PRD's "Agents" (Memory).

**Blocked by:** 02: Reviewer Agent on the fake Worker

**Status:** done

- [x] Each Agent has Memory as Markdown notes; the Reviewer has one Memory file per Repo.
- [x] Memory is read at the start of an Agent call and given to the Worker as input.
- [x] Agents propose Memory edits in their output; Save state applies them and records each change in the Run.
- [x] An Agent's config can set `memoryChanges: 'review'`, so Save state queues its edits instead; Saransh accepts or rejects each with `agents memory`, and the Run that proposed it records the decision.
- [x] Memory lives in the git-ignored data area and is never deleted automatically.
- [x] Saransh can edit a Memory file by hand and the next Run uses his version.
- [x] Step tests cover reading Memory, applying a proposed edit, and a Run whose Agent proposes no edits.

**Decided while building:** a proposal is the whole new Memory file, or null for no change. `memoryChanges` defaults to `'apply'`. In `'review'` mode, a newer proposal for the same file replaces an older one still waiting; `agents memory` shows each as a diff against the Memory Saransh has now, and the Brief lists those waiting.
