# 28: Book backtest: caps, breakers and the order-size guard

**What to build:** The Book backtest enforces the Mandate across the whole Book: the position and sector caps, the drawdown breakers, the order-size guard and each buy's limit price. Their cost is then in the evidence. See the stocks Pipeline PRD's "The Book engine".

**Repos:** ash_new · **Mirrored in:** ash_new ticket 55 (keep both in step)

**Blocked by:** 27: Book backtest: Sleeves, gold and the cash fund

**Status:** done in ash_new, but for a run on the real Lake, which still has no prices for the Books' ETFs (see issue 27's "Not run on the real Lake")

**Waiting on Saransh:** nothing. He set each Book's limit tolerance at 3% above the last close on 31 October 2026.

- [x] No position goes above 15% of the Book and no sector above 30%. A buy that would break either is cut to fit, and the part cut waits in the cash fund. The strategy's own track is unchanged.
- [x] Breakers act on the Book's drawdown, measured on its value per unit against its highest close, so new money neither hides a drawdown nor deepens it:
  - at −10%, no new buys;
  - at −18%, at most half the Book in stocks (half its exposure level, once issue 46 adds one);
  - new buys resume once the Book recovers above −5%, and full exposure above −9%.
- [x] No order is bigger than 1% of the stock's 20-day average traded value. Each cut is reported.
- [x] Each buy carries a limit price: the last close plus the Book's tolerance. It fills at the next open only at or under its limit. A buy that doesn't fill leaves its money in the cash fund. Sales carry no limit.
- [x] The result reports how often each rule acted and what it cost or saved.
- [x] Tests:
  - two strategies buying the same stock are cut to 15% between them;
  - the sector cap holds;
  - the breakers trip and recover at their levels, and new money doesn't move the drawdown;
  - the guard cuts an oversized order;
  - a buy that opens above its limit isn't filled.

**Notes:**

- **Where the rules sit.** Each Sleeve's follower (`portfolios.follow.Follower`) sizes its orders as before, then asks each one of the Book (`Admit`) just before placing it, sales first. The Book's rules (`portfolios.book_engine._Gate`) may cut it. The follower then places what is left, in whole units, cutting a buy to what the cash then pays for. The strategy's own track never sees any of this.
  - **What a buy's cut leaves waits in the cash fund**, as the Sleeve's own cash, earning the fund's rate. It isn't bought later on its own: the strategy's next trade of the stock, the next April weighting, or the breakers' buying back (below) puts it to work.
  - **A strategy's sale that the guard cuts short** sells the rest at the next session, as an order waiting for a bar does, again within the guard.
  - **The rules apply in the PRD's order:** the breakers, the caps, the guard, then the limit price. The whole-share rounding, which the PRD puts before the limit, comes after it here; since the limit takes all of a buy or none of it, the order makes no difference.
  - **A paper portfolio follows as before:** it has no rules to ask.
- **The caps** are measured at the session's open, on the Book's value then and on the Sleeves' holdings as they stand, the orders placed before this one included.
  - **The position cap** holds each security, across every Sleeve, to 15% of the Book. **The sector cap** holds each sector to 30%, by the panels' sectors (today's, from the securities table, as the strategies' own sector limits use). A security without a sector has no sector cap.
  - **Only buys are cut.** A holding that grows past a cap by its price is left alone.
  - **The Sleeves take the room in the order their strategies are named** (`--strategy`), so the first named buys first and a later one's buy is cut to what is left. The test has two strategies wanting 11.25% of the Book each in the same stock: the first gets its 11.25%, the second 3.75%.
- **The breakers** watch the Book's value per unit at each close against its highest close. New money buys units at the close before it comes in, so it moves neither. Each breaker trips at its level and recovers above its own, with the events listed as they happen (`rules.breakers.events`):
  - **at −10%**, no new buys from the next open: every buy in a strategy's Sleeve is stopped, an April weighting's among them. Sales go ahead, and gold's Sleeve still buys back to its 10%;
  - **at −18%**, at most half the Book in stocks (`HALVED`, half of an exposure level that is 100% until issue 46). At each open while it holds, if the stocks are above half the Book's value they are sold down to it, each Sleeve's holdings alike, the money staying in each Sleeve's cash. Stocks that rise back above half are sold again the next session, so a recovery while halved makes many small sales;
  - **above −9%**, full exposure: no more selling down. Buys still wait for −5%;
  - **above −5%**, buys resume. At the next open, each Sleeve trades back to its strategy's weights (`Follower.rebalance`: the index's weights after its last trade), putting its waiting cash back to work, within the caps, guard and limit.

  The Book's own orders, the selling down and the buying back, are never left waiting: one in a stock without a bar that session is dropped, and a strategy's own order waiting there is left as it was. A test drops a stock, without a bar, while the Book is being sold down, and the exit goes through whole at its next bar.

  The test runs a fall through April with new money of a fifth of the Book. The value goes above its highest close, the value per unit doesn't, and the Book stays without new buys.
- **The order-size guard** holds each order to 1% of the stock's average traded value over the 20 sessions before (`engine.backtest.average_traded_value`, which the strategies' ADV filters use). The 1% is shared by all the Sleeves' orders in the stock on that side that session. It covers sales and gold's orders too. A stock with no traded value in that window isn't guarded. The cash fund is never traded in the backtest (it accrues), so LIQUIDBEES's missing volume (issue 26) doesn't meet the guard here; the Rule plan, which buys and sells the fund (issue 32), will have to allow for it. Each cut is listed (`rules.order_size_guard.cuts`): its date, Sleeve, security, side, the shares wanted and allowed, and the traded value.
- **The limit price** is the last close plus the Mandate's `limit_tolerance` (3%, the placeholder). A buy whose open is above it isn't filled, and it isn't tried again on its own. Sales carry no limit.
- **What each rule cost or saved** (`rules`, in `pd book-backtest`'s JSON). For each rule there are:
  - the orders it cut and the money they'd have traded beyond what it let through (for the selling-down, the sales it made and what they raised);
  - the same Book run again without it (`without`: CAGR, max drawdown, end value);
  - the effect, the Book's CAGR and max drawdown less that Book's (`effect`: above 0, it added return or made the fall shallower).

  The breakers are switched off together. The holdout is run with every rule but isn't broken down. On the fixture Lake, two Sleeves of two stocks each, the position cap acted 38 times. It cost 4.6 points of CAGR and made the max drawdown 1.3 points shallower. A Book backtest runs seven Book simulations: the Book, once without each rule, and the holdout. On the fixture Lake it takes about 3 seconds.
- **`BOOK_ENGINE_VERSION` is 2.** The result's caveats now name what isn't in it yet (the exposure level, Disaster stops, Stage scaling), the tolerance's placeholder, the Sleeves' order for the caps' room, cut buys not bought later, and today's sectors.
- **The stand-in `pd`'s example** (`test/pd/book-backtest.india.json`) is regenerated from the fixture run, with `rules`.
- **Known limits, small enough to leave:**
  - Sharing the caps' room by the Sleeves' order rather than pro rata favours the first named strategy when two want the same stock or sector.
  - The selling-down while halved trims a little every session the stocks rise above half the Book, paying costs each time. A band would trade less, but the Mandate gives no number for one.
  - The order-size guard holds back sales of a thin stock over several sessions. A strategy's exit from a stock it can't sell fast is slower in the Book than on its track.
  - The guard counts what it allows against the session's 1% before the follower rounds it to whole shares and cuts it to the cash. A later Sleeve's order in the same stock can be held to a little less than what is truly left. The error is on the safe side.
  - The money reported for each rule is measured before whole-share rounding. A stopped buy counts in full, even the part a cap would also have cut. `allowed` in a guard cut can be a fraction of a share. Each figure is a little high.
