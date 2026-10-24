# 25: CW2's selected variant and the ash ports

**What to build:** The strategies the Candidate test will choose from are the best versions Saransh has. CW2's selected research variant runs as a strategy of its own, and the ash ports are in the catalog, backtested on the current Lake. See the stocks Pipeline PRD's "Strategies and Stages".

**Repos:** ash_new · **Mirrored in:** ash_new ticket 52 (keep both in step)

**Blocked by:** 15: Fix the stuck refresh and the dying process pool

**Status:** ready-for-agent

- [ ] CW2's selected variant is a strategy of its own for India and the US, next to the original. Its rules:
  - the SuperTrend(10, 2) gate;
  - ranking 80/20 by RS over 55 sessions and up-days over 63;
  - the 5% regime buffer in India;
  - fills at the next open.

  Nothing is launched yet, so nothing has a live track to move.
- [ ] Its backtests reproduce the research's figures within rounding, or the difference is explained:
  - India 2016–2026: 29.95% CAGR, −27.86% max drawdown, 38.96% CAGR in the 2013–2016 holdout;
  - US 2016–2026: 20.91% CAGR.
- [ ] The ash ports (CMO Momentum, HAMA, Investor, Swing, GFS, Aim & Shoot, RS Rating, the Super 30s) are loaded into the catalog and backtested on the current Lake.
- [ ] Tests: the variant's gate, ranking and buffer behave as specified on a fixture Lake.
