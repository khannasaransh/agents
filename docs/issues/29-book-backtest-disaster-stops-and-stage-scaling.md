# 29: Book backtest: Disaster stops and Stage scaling

**What to build:** The Book backtest tests the Disaster stops held at the broker, on daily bars. It also holds each Sleeve at its Stage's share, so both a real Book and a paper Book can be backtested. See the stocks Pipeline PRD's "The Book engine".

**Repos:** ash_new · **Mirrored in:** ash_new ticket 56 (keep both in step)

**Blocked by:** 27: Book backtest: Sleeves, gold and the cash fund

**Status:** done, but for a run on the real Lake, which still has no prices for the Books' ETFs (see issue 27's "Not run on the real Lake")

- [x] Every new position gets a Disaster stop at twice its strategy's stop distance, or 15% below entry where the strategy has no stop.
- [x] Each week's last session raises the stop to the same distance below that session's close. A stop is never lowered.
- [x] On daily bars, a low at or under the stop sells at the stop, or at the open when the price opens below it.
- [x] Strategy exits stay end-of-day, as each strategy's spec says.
- [x] Stage scaling:
  - in a real Book, a Paper strategy holds nothing, a Real-small one a quarter of its share and a Real-full one all of it, with the rest in the cash fund;
  - a paper Book holds every strategy from Paper up at its full share.
- [x] Tests:
  - a stop is touched intraday;
  - the price gaps through a stop;
  - a stop is raised on the week's last session, and never lowered;
  - each Stage is scaled correctly in a real and in a paper Book.

**Notes:**

- **Where the stops sit.** The Book engine keeps a Disaster stop for each holding of a strategy's Sleeve (`portfolios.book_engine._Stops`), beside the Mandate's rules. Gold's Sleeve has none: it isn't a strategy's, and has no stop distance to double. A Book without a Mandate has none either, and each Book has one.
- **The stop distance** is the strategy's own stop-loss (`book_engine.strategy_stop`): a rule strategy's `exits.stop_loss_pct`, or a plugin's `stop_loss` parameter, the fall under its buy that sells it. A plugin's trailing stop isn't counted. The Disaster stop is twice that (`disaster_stop_multiple`), or the Mandate's 15% (`disaster_stop_without`) for a basket, a rule strategy without a stop-loss or a plugin without one (`in-sector-rotation`). So `in-cw2-selected`'s is 20% and `in-canslim-leaders`'s 16%.
- **A session, in order:**
  1. **At the open,** before the April weighting, the breakers' selling down and the strategies' orders, a holding that opens at or under its stop is sold at the open.
  2. **The session's orders.**
  3. **After them,** each new position gets its stop: its distance under the price it was bought at. A holding added to keeps its stop; one sold out and bought again later gets a new one.
  4. **During the session,** a holding whose low reaches its stop is sold at the stop, a position bought at that open among them: the stop is placed with the buy. A bar without a low is read by the lower of its open and close.
  5. **At the close** of the week's last session (the last of its calendar week in the panels: a Friday, or the session before a Friday holiday; the panels' own last session only on a Friday, as a later session of its week may come), each stop is raised to its distance under the close. It is never lowered. A holding without a bar that session keeps its stop.

  Stops are kept to four decimals, as prices are quoted.
- **A stop sells the whole holding** as the order resting at the broker would, without asking the Mandate's rules: the order-size guard doesn't cut it and the breakers don't stop it. It pays the cost preset, its slippage included, and no more.
- **The strategy still holds the stock.** Its track never sees the stop. The Sleeve buys the stock back only when the strategy trades it again, to the weight it holds after, or when the breakers' buying back trades the Sleeve back to its strategy's weights. The April weighting resizes holding by holding, so it doesn't buy it back. Until then its money waits in the cash fund.
- **Strategy exits stay end-of-day:** a strategy's stop-loss is on its track, as before, and its Sleeve sells at the next open. A test has a strategy with a 10% stop whose stock trades down 18% and closes 12% under: its Disaster stop, at 20%, isn't touched, and the Sleeve sells at the next open as the track says.
- **Stage scaling.** Each Sleeve is named with its Stage (`pd book-backtest IN --strategy in-cw2-selected:real-small`: `paper`, `real-small` or `real-full`, which is the default). The inverse-volatility shares are set among all the strategies first, then each is scaled by its Stage (`STAGE_SHARE`): so in a real Book a Paper strategy's share waits in the cash fund rather than going to the others. `--paper` backtests the paper Book, which holds each at its full share. A Candidate isn't in a Book yet, and a Retired strategy only winds down (issue 31), so neither is accepted. Each strategy keeps its Stage over the whole range.
- **The result** (`pd book-backtest`'s JSON) says whether it is the paper Book (`paper`), and each strategy's Stage, stop distance (`stop_distance`) and Disaster stop (`disaster_stop`). What each Sleeve holds at the end comes with each holding's stop (`at_end.sleeves.*.stops`), as the Rule plan (issue 32) will need them. `rules.disaster_stops` reports the stops like the other rules: how many sold and what they raised, each sale (`hits`: date, Sleeve, security, shares, price, and whether the price `gapped` through the stop), and the same Book without them (`without`, `effect`). A Book backtest now runs eight Book simulations: the Book, once without each rule, and the holdout.
- **On the fixture Lake**, two Sleeves of baskets without stops (15%): the Disaster stops sold 12 times. They cost 1.1 points of CAGR and made the max drawdown 0.8 points shallower. The position cap now acts 39 times. The fixture's bars have only closes, so each stop there sells at a "gap", at the session's close, as an order without an open trades. The tests on in-memory panels give bars their opens and lows.
- **`BOOK_ENGINE_VERSION` is 3.** The caveats now say how the stops are tested and that Stages are held over the range; only the exposure level (issue 46) is still missing.
- **The breakers' tests run without Disaster stops.** Their stocks fall 30%, which would sell them at the 15% stop before the breakers act.
- **The stand-in `pd`'s example** (`test/pd/book-backtest.india.json`) is regenerated from the fixture run, with the Stages and `rules.disaster_stops`.
- **Not run on the real Lake,** for the reason issues 27 and 28 give: it still has no prices for the Books' ETFs.
- **Known limits, small enough to leave:**
  - A stop fills at exactly its price when the low reaches it. In a fast fall a real stop order can fill lower. Only the preset's slippage is paid.
  - A daily bar can't say when in the session the low came. A position bought at the open and stopped the same day is assumed bought first, as the open comes first.
  - A plugin's stop distance is read from a parameter named `stop_loss`. A plugin naming its stop otherwise would get the 15% without one.
  - The breakers' buying back can buy back a stock a stop sold, if the strategy still holds it.
