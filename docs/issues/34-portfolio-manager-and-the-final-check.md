# 34: The Portfolio Manager and the final check

**What to build:** A Portfolio Manager Agent reads the Rule plans and may subtract from them, writing a reason for each. A final check in code makes sure every change is a subtraction inside the Mandate. Otherwise the Rule plan goes out unchanged. See the stocks Pipeline PRD's Portfolio Manager and Check Steps.

**Repos:** agents, ash_new

**Blocked by:** 33: Paper Books trade their Order lists

**Status:** ready-for-agent

- [ ] A Portfolio Manager Agent runs on Claude Code, with Codex as fallback, read-only in the Run folder. It gets the Rule plans, the Data gate's verdict, the Health Agent's diagnosis, the Stages and its Journal.
- [ ] Its output is checked against a schema:
  - per Book, the subtractions from the Rule plan, each with a reason;
  - the Journal's new entries;
  - the Brief's commentary per Book.
- [ ] `pd check` accepts the output only if every change from the Rule plan is a subtraction (a veto, a trim or a dropped buy) and everything stays inside the Mandate. Otherwise, or when the Portfolio Manager failed, the Rule plan goes out unchanged, and the Brief says why.
- [ ] Each accepted subtraction is recorded as an Override, with the Rule plan's order beside it.
- [ ] The Journal is the Portfolio Manager's Memory. Save state applies it, and it carries what is still open.
- [ ] The Brief shows each Book's commentary and every subtraction with its reason.
- [ ] Tests:
  - **ash_new:** `pd check` accepts subtractions, and rejects an addition, a size increase, or anything outside the Mandate.
  - **agents:** the Portfolio Manager gets its inputs; it falls back to Codex; after both Workers fail, the Rule plan goes out with a note.
