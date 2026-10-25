# 34: The Portfolio Manager, the Playbook and the final check

**What to build:** A Portfolio Manager Agent starts from each Rule plan and changes it within its Book's Playbook, writing a Decision record with the evidence for each change. A final check in code accepts a change only inside the Mandate, inside its Lever's range and allowed by the Book's Judgement mode, with every cited figure found in the Run's inputs. A failing change is dropped, and the whole Book is then checked as the Order list would leave it. If it fails, the Rule plan goes out instead, but only once it passes the same check. See the stocks Pipeline PRD's Portfolio Manager and Check Steps, "The Market condition and the Playbook", and ADR 0003.

**Repos:** agents, ash_new

**Blocked by:** 33: Paper Books trade their Order lists; 46: Market condition and the exposure level

**Status:** ready-for-agent

**Waiting on Saransh:** the Playbook's ranges. Until then the placeholders are exposure floors of 80%, 50% and 0%, sizes from 0.5× to 1×, timing up to 5 sessions and rebalance under 2% of the Book.

- [ ] Each Book's config holds its Playbook beside its Mandate, under a version as the Mandate's is: a range for each Lever (exposure, selection, size, timing, trim and rebalance).
- [ ] Each Book has a Judgement mode (plan only, subtract only or Playbook), kept in the app database with every change, its date and the Answer that approved it. Real Books start in subtract only, paper Books in Playbook.
- [ ] `pd plan` writes each Book's Pool: the names any strategy with a Sleeve in it bought or signalled to buy in the last 2 months, from their live tracks.
- [ ] A Portfolio Manager Agent runs on Claude Code, with Codex as fallback, read-only in the Run folder. Its inputs are:
  - the Rule plans and the dossiers;
  - each Book's Playbook, Judgement mode, Market condition, exposure level and Pool;
  - the Data gate's verdict and the Health Agent's diagnosis;
  - the Stages and its Journal.
- [ ] Its output is checked against a schema:
  - per Book, its exposure level for the day and its changes from the Rule plan;
  - a Decision record for each change and for the exposure level: the Rule plan's order, what goes out instead, the Lever and Playbook line, each figure cited by input file, security and field with its value, what is expected, and the session it is judged on;
  - the Journal's new entries;
  - the Brief's commentary per Book.
- [ ] `pd check` accepts each change only if:
  - the Book's Judgement mode allows it: none in plan only; exposure cuts, dropped buys, trims, waits and rebalance skips in subtract only; also selection swaps within a Sleeve and sizes up to the range's top in Playbook;
  - it is inside its Lever's range, and a bought name is in the Pool;
  - its Decision record is complete and every cited figure matches the Run's inputs;
  - it doesn't drop or delay any of the Rule plan's strategy exits or Disaster stops.

  It drops each change that fails, with its reason.
- [ ] `pd check` then checks the whole Book as the Order list would leave it, since changes that pass one by one can break a limit together. It checks:
  - each position and sector against its cap;
  - the stocks held against the exposure level;
  - the buys against the cash left after what open orders reserve.
- [ ] If that check fails, or the Portfolio Manager failed, the Rule plan goes out instead, but only once it passes the same whole-Book check. If the Rule plan fails it too, only its exits and Disaster stops go out, with a To-do. The Brief says which applied and why.
- [ ] `pd check` treats the Portfolio Manager's output as failed if it was made from a Book state, Mandate version or Playbook version that is no longer current.
- [ ] Each accepted change is recorded as an Override, with the Rule plan's order and its Decision record beside it.
- [ ] The Journal is the Portfolio Manager's Memory. Save state applies it, and it carries what is still open.
- [ ] The Brief shows each Book's Judgement mode, its commentary, and every change with its Decision record in plain sentences, plus each dropped change and why.
- [ ] Moving a Book's Judgement mode, or changing a Playbook range, is an Answer on a proposal in the Brief.
- [ ] Tests:
  - **ash_new:** `pd check` accepts no change in plan only mode; accepts an exposure cut, a dropped buy, a trim and a wait in subtract only, and rejects a swap or a size above 1× there; accepts a swap to a Pool name in Playbook mode and rejects one outside the Pool; rejects a change outside its range, without a complete Decision record, or citing a figure not in the inputs; rejects a change that drops an exit; drops a failing change and keeps the rest; catches two changes that each pass but together break a cap; falls back to the Rule plan when what remains breaks the Mandate, and sends only exits and stops when the Rule plan fails too; refuses an output made from an old Book state or Playbook version. The Pool covers exactly 2 months of the live tracks.
  - **agents:** the Portfolio Manager gets its inputs; it falls back to Codex; after both Workers fail, the Rule plan goes out with a note; the Brief shows dropped changes.
