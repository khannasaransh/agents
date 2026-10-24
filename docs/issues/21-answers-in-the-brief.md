# 21: Answers in the Brief

**What to build:** Saransh answers what's waiting on him in the Stocks Brief itself. He clicks buttons, then Save answers, and the next Run applies his Answers. Nothing has to be running for this to work. The first kinds of Answer cover Corrections and Quarantines, and later tickets add their own kinds. See the stocks Pipeline PRD's "Answers" and the Answers Step.

**Repos:** agents, ash_new

**Blocked by:** 20: Corrections and Quarantine

**Status:** ready-for-agent

- [ ] Every item waiting on Saransh in the Brief has an id and buttons for its Answers. The first kinds:
  - a waiting Correction: approve or reject;
  - a Quarantine: dismiss its flag.
- [ ] A Save answers button downloads one Answers file naming the Run and each Answer, with an optional note. The page works when opened from disk with nothing running.
- [ ] A new first Step, Answers:
  - reads every Answers file in Downloads and in the Broker inbox;
  - applies them through `pd`, oldest first;
  - applies a later Answer to an item only while that item is still open, and logs any Answer it ignores;
  - moves the files into the Run.
- [ ] Answers never expire. An item without an Answer appears again in the next Brief.
- [ ] A dry run consumes no Answers file.
- [ ] Tests:
  - an Answers file built from the items embedded in a Brief, the way the button builds it, is applied once;
  - an Answer to a settled item is ignored;
  - an old file can't undo a newer Answer.
