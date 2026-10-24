# 28: Book backtest: caps, breakers and the order-size guard

**What to build:** The Book backtest enforces the Mandate across the whole Book: the position and sector caps, the drawdown breakers, and the order-size guard. Their cost is then in the evidence. See the stocks Pipeline PRD's "The Book engine".

**Repos:** ash_new · **Mirrored in:** ash_new ticket 55 (keep both in step)

**Blocked by:** 27: Book backtest: Sleeves, gold and the cash fund

**Status:** ready-for-agent

- [ ] No position goes above 15% of the Book and no sector above 30%. A buy that would break either is cut to fit, and the part cut waits in the cash fund. The strategy's own track is unchanged.
- [ ] Breakers act on the Book's drawdown from its high-water mark:
  - at −10%, no new buys;
  - at −18%, exposure halved;
  - new buys resume once the Book recovers above −5%, and full exposure above −9%.
- [ ] No order is bigger than 1% of the stock's 20-day average traded value. Each cut is reported.
- [ ] The result reports how often each rule acted and what it cost or saved.
- [ ] Tests:
  - two strategies buying the same stock are cut to 15% between them;
  - the sector cap holds;
  - the breakers trip and recover at their levels;
  - the guard cuts an oversized order.
