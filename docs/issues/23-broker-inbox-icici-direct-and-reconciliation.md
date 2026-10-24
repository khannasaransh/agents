# 23: Broker inbox: ICICI Direct into the India real Book, with Reconciliation

**What to build:** Saransh drops ICICI Direct's tradebook and holdings export in the Broker inbox. The next Run records them in the India Book's real portfolio and reconciles the holdings, and the Brief shows what he holds and any differences. This puts the riskiest plumbing, imports without an API, in use from the first phase. See the stocks Pipeline PRD's Broker inbox Step and "Real Books, paper Books and orders".

**Repos:** ash_new, agents

**Blocked by:** 17: Stocks Pipeline skeleton: the Lake Step and a data-status Stocks Brief

**Waiting on Saransh:** one ICICI Direct tradebook and one holdings export, as samples.

**Status:** ready-for-agent

- [ ] The India Book has a real portfolio in ash_new for ICICI Direct.
- [ ] Import presets read ICICI Direct's tradebook and holdings export. They are built from Saransh's samples.
- [ ] `pd` identifies each file's broker and kind, so the Pipeline hands it every file without knowing the formats.
- [ ] A Broker inbox Step records each tradebook in the India Book's real portfolio once: a file it has seen before isn't recorded again.
  - Processed files move out of the inbox.
  - A file it can't read is set aside, with a To-do.
- [ ] Given a holdings export, Reconciliation compares the real portfolio's positions with it, security by security. Each difference becomes a To-do.
- [ ] The Brief shows the India Book's holdings and value, and Reconciliation's differences.
- [ ] A dry run records nothing.
- [ ] Tests:
  - **ash_new:** the sample files become the right ledger and positions; Reconciliation finds a missing fill and a quantity off by a split.
  - **agents:** each file is handed to `pd`, unreadable files are set aside, and the To-dos are raised.
