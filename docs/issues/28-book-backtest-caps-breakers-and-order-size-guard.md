# 28: Book backtest: caps, breakers and the order-size guard

**What to build:** The Book backtest enforces the Mandate across the whole Book: the position and sector caps, the drawdown breakers, the order-size guard and each buy's limit price. Their cost is then in the evidence. See the stocks Pipeline PRD's "The Book engine".

**Repos:** ash_new · **Mirrored in:** ash_new ticket 55 (keep both in step)

**Blocked by:** 27: Book backtest: Sleeves, gold and the cash fund

**Status:** ready-for-agent

**Waiting on Saransh:** each Book's limit tolerance. Until then the placeholder is 3% above the last close.

- [ ] No position goes above 15% of the Book and no sector above 30%. A buy that would break either is cut to fit, and the part cut waits in the cash fund. The strategy's own track is unchanged.
- [ ] Breakers act on the Book's drawdown, measured on its value per unit against its highest close, so new money neither hides a drawdown nor deepens it:
  - at −10%, no new buys;
  - at −18%, at most half the Book in stocks (half its exposure level, once issue 46 adds one);
  - new buys resume once the Book recovers above −5%, and full exposure above −9%.
- [ ] No order is bigger than 1% of the stock's 20-day average traded value. Each cut is reported.
- [ ] Each buy carries a limit price: the last close plus the Book's tolerance. It fills at the next open only at or under its limit. A buy that doesn't fill leaves its money in the cash fund. Sales carry no limit.
- [ ] The result reports how often each rule acted and what it cost or saved.
- [ ] Tests:
  - two strategies buying the same stock are cut to 15% between them;
  - the sector cap holds;
  - the breakers trip and recover at their levels, and new money doesn't move the drawdown;
  - the guard cuts an oversized order;
  - a buy that opens above its limit isn't filled.
