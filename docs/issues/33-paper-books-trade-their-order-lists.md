# 33: Paper Books trade their Order lists

**What to build:** Each Book has a paper Book that trades its Order list automatically at the next open. Beside it, a rules-only paper Book trades the Rule plan unchanged, so what the Portfolio Manager's judgement adds can later be measured (ADR 0004). The Brief shows how each stands. The process runs end to end on paper, with no real money involved. See the stocks Pipeline PRD's Check Step and "Real Books, paper Books and orders".

**Repos:** ash_new, agents

**Blocked by:** 32: Rule plan for the paper Books

**Status:** ready-for-agent

- [ ] Each Book has two paper portfolios in ash_new, fed by Order lists:
  - its paper Book, which trades the final Order list;
  - its rules-only paper Book, which trades the Rule plan unchanged.

  Both start on the same day with the same cash and new money, and hold the same Sleeves at the same Stages.
- [ ] A Check Step records each paper Book's Order list in ash_new, with ids and states. For now the Order list is the Rule plan unchanged.
- [ ] The Check Step records nothing unless this Run's Plan Step succeeded and each Rule plan's Book state is still current. Otherwise the Brief says why.
- [ ] If a session already has an Order list (because a Run was started again), recording a new one supersedes the old one's orders. No order is recorded twice.
- [ ] Each order fills at the next session's open with the strategies' costs, through the daily chain. Fills are applied only once that chain's Health report passes; until then they wait.
  - Sales go first, and buys are cut to the cash available, as a manual paper portfolio's applied rebalance is today.
  - A buy fills only at or under its limit price.
- [ ] Disaster stops are simulated on paper Books as in the backtest.
- [ ] The Brief shows:
  - each paper Book's value, and its gap to its rules-only paper Book;
  - its drawdown against its breakers;
  - its Sleeves and Stages;
  - the positions whose Disaster stop would lose more than 1% of the Book;
  - the Books' combined value in INR.
- [ ] A dry run records no Order list.
- [ ] Tests:
  - orders fill at the next open, and each paper Book fills from its own list;
  - sales go before buys, and a buy is cut to the cash available;
  - a buy above its limit doesn't fill;
  - fills wait for a passing Health report;
  - a Disaster stop is hit on paper;
  - the Check Step records nothing when the Plan Step failed;
  - a second Order list for the same session supersedes the first and records no order twice.
