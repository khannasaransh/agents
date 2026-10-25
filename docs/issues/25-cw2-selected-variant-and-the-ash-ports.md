# 25: CW2's selected variant and the ash ports

**What to build:** The Candidate test chooses only from strategy versions Saransh has approved. The ash ports already exist (ash_new's review of 20 Oct 2026, with tests showing their signals match ash's code), so they are audited, not ported again. Each strategy gets a named version, and a report says how each port differs from ash's own strategy. CW2's selected research variant runs as a strategy of its own. See the stocks Pipeline PRD's "Strategies and Stages".

**Repos:** ash_new · **Mirrored in:** ash_new ticket 52 (keep both in step)

**Blocked by:** 15: Fix the stuck refresh and the dying process pool

**Status:** ready-for-agent

**Waiting on Saransh:** which versions the Candidate test may choose from, once the report is out.

- [ ] Every strategy has a version: its rules, its parameters and its code hash. A change to any of them makes a new version, which is a new strategy and starts as a Candidate.
- [ ] CW2's selected variant is a strategy of its own for India and the US, next to the original. Its rules:
  - the SuperTrend(10, 2) gate;
  - ranking 80/20 by RS over 55 sessions and up-days over 63;
  - the 5% regime buffer in India;
  - fills at the next open.

  Nothing is launched yet, so nothing has a live track to move.
- [ ] Its backtests reproduce the research's figures within rounding, or the difference is explained:
  - India 2016–2026: 29.95% CAGR, −27.86% max drawdown, 38.96% CAGR in the 2013–2016 holdout;
  - US 2016–2026: 20.91% CAGR.
- [ ] The ash ports (CMO Momentum, HAMA, Investor, Swing, GFS, Aim & Shoot, RS Rating, the Super 30s) are audited. A report gives, for each port's version, how it differs from ash's own strategy:
  - fill timing: the ports trade on the close, as ash does, while the Books trade at the next open;
  - the regime index: India's is the Nifty 500, where ash used ^NSMIDCP;
  - costs and the benchmark;
  - inputs ash had that the Lake doesn't, such as Super 30's fund-holder history.

  The tests showing each port's signals match ash's code stay as they are.
- [ ] Each port gets a version that fills at the next open, which is the one a Book can trade. Both versions are backtested on the current Lake, and the report gives both.
- [ ] The approved versions are recorded in ash_new's config. The Candidate test considers only those, and no version inherits an old backtest's approval by name.
- [ ] Tests:
  - the variant's gate, ranking and buffer behave as specified on a fixture Lake;
  - a changed parameter makes a new version;
  - a port's next-open version fills at the next session's open.
