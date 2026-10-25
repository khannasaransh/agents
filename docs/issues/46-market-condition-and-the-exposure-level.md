# 46: Market condition and the exposure level

**What to build:** Code reads each market's Market condition from the Lake, and the condition sets how much of each Book may be in stocks. The Book engine applies that exposure level in the Book backtest and the Rule plan alike, so holding less in a weak market is tested like any other rule. See the stocks Pipeline PRD's "The Market condition and the Playbook", "The Book engine" and ADR 0003.

**Repos:** ash_new, agents · **Mirror:** not yet in ash_new's tickets

**Blocked by:** 28: Book backtest: caps, breakers and the order-size guard

**Status:** ready-for-agent

**Waiting on Saransh:** the Market condition's thresholds and the exposure levels. Until then the placeholders are 100%, 80% and 40% for Uptrend, Under pressure and Correction.

- [ ] ash_new reads each market's Market condition (Uptrend, Under pressure or Correction) for any session, from data up to that session's close:
  - the index against its 50- and 200-day averages;
  - breadth: the share of the index's members above their 200-day average;
  - distribution days.

  Its thresholds are in ash_new's config.
- [ ] MarketSmith's own outlook, from the latest dated snapshot, is recorded beside the condition and decides nothing.
- [ ] Each Book's config sets its exposure level for each Market condition.
- [ ] The Book engine applies the exposure level after the breakers. While the Book holds more in stocks than the level:
  - it makes no new buys;
  - it then trims the weakest holdings first: lowest RS Rating first, with ties going to the one closest to its stop.

  The strategies' own tracks never see this rule, so each trim's counterfactual is at hand.
- [ ] The Book backtest reports how often the exposure level acted and what it cost or saved, and runs with and without it.
- [ ] The Stocks Brief shows each market's Market condition, MarketSmith's outlook beside it, and each Book's exposure level.
- [ ] Tests:
  - **ash_new:** each condition is read right from a fixture Lake; over the level, no new buys are made, then the weakest are trimmed first, ties going to the one closest to its stop; the backtest with and without the rule.
  - **agents:** the Brief shows the condition and the level from a stand-in `pd plan`.
