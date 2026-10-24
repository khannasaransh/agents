# 33: Paper Books trade their Order lists

**What to build:** Each Book has a paper Book that trades its Order list automatically at the next open. The Brief shows how each paper Book stands. The process runs end to end on paper, with no real money involved. See the stocks Pipeline PRD's Check Step and "Real Books, paper Books and orders".

**Repos:** ash_new, agents

**Blocked by:** 32: Rule plan for the paper Books

**Status:** ready-for-agent

- [ ] Each Book has a paper Book: a paper portfolio in ash_new, fed by Order lists.
- [ ] A Check Step records each paper Book's Order list in ash_new, with ids and states. For now the Order list is the Rule plan unchanged.
- [ ] Each order fills at the next session's open with the strategies' costs, through the daily chain. Sales go first, and buys are cut to the cash available, as a manual paper portfolio's applied rebalance is today.
- [ ] Disaster stops are simulated on paper Books as in the backtest.
- [ ] The Brief shows:
  - each paper Book's value;
  - its drawdown against its breakers;
  - its Sleeves and Stages;
  - the positions whose Disaster stop would lose more than 1% of the Book;
  - the Books' combined value in INR.
- [ ] A dry run records no Order list.
- [ ] Tests:
  - orders fill at the next open;
  - sales go before buys, and a buy is cut to the cash available;
  - a Disaster stop is hit on paper.
