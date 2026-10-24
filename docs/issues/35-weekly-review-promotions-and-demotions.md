# 35: Weekly review, promotions and demotions

**What to build:** Every Saturday the Stocks Brief carries the weekly review. Each Sleeve and Book is measured against its backtest's range and its benchmark. A strategy that breaks the demotion rule is demoted. The Portfolio Manager proposes promotions, which Saransh approves with an Answer. See the stocks Pipeline PRD's Review Step and "Reviews".

**Repos:** ash_new, agents

**Blocked by:** 34: The Portfolio Manager and the final check

**Status:** ready-for-agent

- [ ] On Saturdays, a Review Step gets the weekly figures from `pd review`:
  - each Sleeve's and Book's live return and drawdown, against its backtest's range and its benchmark;
  - Reconciliation's differences.

  On other days the Step skips itself.
- [ ] The demotion rule is applied by itself, and the Brief reports each demotion. A strategy is demoted when:
  - its live drawdown passes 1.5 times its backtest's worst; or
  - after 12 months live, its rolling 12-month return falls below its backtest's 5th percentile.
- [ ] On Saturdays the Portfolio Manager gets the figures, writes the review's commentary, and proposes a promotion when a Stage's time is up (3 months of Paper, 6 of Real-small) and the strategy's record is inside its tested range.
- [ ] An approving Answer moves a promotion's Stage, and the next Rule plan uses it.
- [ ] Tests:
  - live within range and outside it;
  - each half of the demotion rule;
  - a promotion is proposed and approved;
  - the Step skips itself on weekdays.
