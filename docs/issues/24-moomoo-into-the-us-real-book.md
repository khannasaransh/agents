# 24: moomoo into the US real Book

**What to build:** moomoo's trade history and positions exports are recorded in the US Book's real portfolio and reconciled, just as ICICI Direct's are for India. See the stocks Pipeline PRD's "Real Books, paper Books and orders".

**Repos:** ash_new · **Mirrored in:** ash_new ticket 51 (keep both in step)

**Blocked by:** 23: Broker inbox: ICICI Direct into the India real Book, with Reconciliation

**Waiting on Saransh:** one moomoo trade history and one positions export, as samples.

**Status:** ready-for-agent

- [ ] The US Book has a real portfolio in ash_new for moomoo, in USD.
- [ ] Import presets read moomoo's trade history and positions exports, built from Saransh's samples.
- [ ] `pd` recognises moomoo's files, so the Broker inbox Step hands them in unchanged.
- [ ] Reconciliation works for the US Book as it does for India.
- [ ] Tests: the sample files become the right ledger and positions, and Reconciliation finds the differences planted in them.
