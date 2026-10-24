# 30: The Candidate test

**What to build:** For each Book, a Candidate report says which strategies earn a place, and whether the Book they make meets its objective. A strategy earns its place by what it adds to the Book, not by its own drawdown. See the stocks Pipeline PRD's "Strategies and Stages" and "The Book engine".

**Repos:** ash_new · **Mirrored in:** ash_new ticket 57 (keep both in step)

**Blocked by:** 25: CW2's selected variant and the ash ports; 28: Book backtest: caps, breakers and the order-size guard; 29: Book backtest: Disaster stops and Stage scaling

**Status:** ready-for-agent

- [ ] Each strategy in a Book's market is tested for:
  - holdout CAGR against the benchmark's over the same years (2013–2016);
  - a deflated Sharpe that clears 95%, counting every variant tried in its family as a trial (using the robustness tools from ash_new's ticket 44);
  - the Book backtest with and without it.
- [ ] Candidates are chosen by forward selection. Starting from gold and the cash fund, the strategy that improves the Book most joins, until none does. "Improves" means a higher CAGR with max drawdown still at or below 25%, or a lower drawdown for the same CAGR.
- [ ] The report checks the chosen Book against its objective: max drawdown at or below 25%, holdout CAGR at or above 20%.
- [ ] A `pd` command writes each Book's Candidate report as JSON, with a JSON Schema, and as a readable summary.
- [ ] The test is run on the current Lake for India and the US, and the reports are saved for Saransh to choose from.
- [ ] Tests:
  - a strategy that improves a fixture Book passes;
  - a strategy that only adds drawdown fails;
  - a strategy that fails its holdout fails, whatever it adds.
