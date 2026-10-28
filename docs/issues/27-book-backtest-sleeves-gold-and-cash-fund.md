# 27: Book backtest: Sleeves, gold and the cash fund

**What to build:** `pd book-backtest` backtests a whole Book. Its Sleeves follow their strategies' own tracks at inverse-volatility weights, beside 10% gold and the cash fund, and the result reports the Book's objective. This is the first slice of the Book engine that the Rule plan will later share. See the stocks Pipeline PRD's "The Book engine".

**Repos:** ash_new · **Mirrored in:** ash_new ticket 54 (keep both in step)

**Blocked by:** 26: Gold ETFs and cash funds in the Lake

**The Hong Kong Book holds the US Book's gold ETF and cash fund** (Saransh, 26 October 2026; issue 48), in dollars: nothing is chosen for Hong Kong. Its backtest values them in Hong Kong dollars at each day's rate (the peg keeps the rate within 7.75–7.85), and its cash fund earns the US's risk-free rate.

**Status:** done, but for a run on the real Lake, which has no prices for the Books' ETFs yet (see "Not run on the real Lake")

- [x] The India and US Books are declared in ash_new's config, each with:
  - market, currency, broker and benchmark (the Nifty 500 TRI; the S&P 500 total return);
  - capital (a setting, with ash_new's preset capital standing in until set);
  - cash fund and gold ETF;
  - the Mandate's numbers, under a version: changing any of them makes a new version;
  - its real portfolio.
- [x] The engine builds on ash_new's portfolio code that exists today (sizing, costs, drift and order proposals, paper follow) rather than making a second copy.
- [x] A Book backtest runs each Sleeve's strategy on its own and lays the Book over it. The strategy's orders become the Book's at the Sleeve's weight, in whole shares (lots where a market has them), paying the cost presets (brokerage ₹0 / $0).
- [x] The Book keeps each Sleeve's holdings apart, so a strategy's sale sells only its own Sleeve's shares.
- [x] Sleeve weights:
  - Each strategy's weight is proportional to the inverse of its volatility over the past year.
  - Weights are set on the first session of each April and drift until the next.
  - Gold is reset to 10% at each re-weighting.
  - Whatever no Sleeve uses waits in the cash fund.
- [x] Yearly new money, a set amount per year, goes in at each re-weighting.
- [x] The result reports, against the Book's benchmark:
  - CAGR, max drawdown, the 2013–2016 holdout CAGR and Sharpe;
  - the distribution of rolling 12-month returns and of drawdowns.
- [x] `pd book-backtest` writes the result as JSON, with a JSON Schema, naming the data version, each strategy's version and the Mandate's version. The same Book, data, versions and dates always give the same result.
- [x] Tests on a fixture Lake:
  - a one-Sleeve Book returns its strategy's return, diluted by gold and cash;
  - weights follow inverse volatility;
  - re-weighting happens only yearly;
  - gold resets to 10%.

**Notes:**

- **The Books** are declared in ash_new's `config/books.yaml` (`pdash.core.books.Book`): India, the US and Hong Kong, each with its market, currency, broker, benchmark (`^CRSLDX`, the Nifty 500, and `^GSPC`, the S&P 500, each compared as its total return where the Lake has its levels; Hong Kong's `^HSI` as its price index, since the Lake has no Hang Seng total return), capital, yearly new money, gold ETF, cash fund and Mandate.
  - **Capital** is `null` for each, so its market's cost preset's stands in: ₹10 lakh, $100,000, HK$10 lakh. **New money** is 0 until Saransh sets it.
  - **Its real portfolio** is named (`real_portfolio`: India Book (ICICI Direct)). It is the one marked with its code, at its broker (`brokers.books.REAL_BOOKS`), and a test holds the two to the same name, market, currency and broker.
  - **The Mandate's numbers** are the PRD's: gold 10%, 15% a position, 30% a sector, the breakers at −10% and −18% (resuming above −5% and −9%), the −25% limit, 1% risk a trade, the order-size guard at 1% of the 20-day average traded value, Disaster stops at twice the strategy's stop or 15%, and the limit tolerance's 3% placeholder. Their **version** is 12 hex digits hashed from them (`Mandate.version`): any change makes a new one. Only gold's share is used so far; the rest wait for issues 28 and 29. Saransh hasn't yet confirmed them as the first version.
- **The engine** is ash_new's `pdash.portfolios.book_engine`, on the paper follower (`portfolios.follow`). The follower now runs one session at a time (`Follower`: its dividends, then any resize, then its orders), and can resize a portfolio holding for holding through the follower's own sizing (`portfolios.orders.size`). A paper portfolio follows exactly as before.
  - **Each Sleeve** is a follower of its strategy's track on the Book's panels. It has its own holdings and cash, so a strategy's sale sells only its own Sleeve's shares. Gold is a Sleeve too, holding the gold ETF.
  - **The strategies run on their own first**, on the market's panels, from a year before the Book's start (`run_backtest`, so the runs are stored and read back). They run again to the Book's start, for what each holds on that close. Its Sleeve buys that at the next open, as a paper portfolio starts, and from then on trades what the strategy trades, to the weight it holds after.
  - **Weights** are set on the Book's first session and on the first session of each April. Each strategy's is proportional to the inverse of its volatility: the deviation of its own index's daily returns over the 365 days to the close before, × √252. A strategy with fewer than 20 returns there, or none to speak of, gets the average of the others' inverses (all alike when none has one). They share what gold's 10% leaves.
  - **On an April's first session**, at the open and before the strategies' own orders that session:
    - the year's new money comes in;
    - each Sleeve is resized to its share of the Book's value at the open, every holding and its cash in the shares they had, in whole units with costs;
    - the Sleeves that shrink go first, and those that grow take what that freed.

    In between, the weights drift.
  - **The cash fund** holds whatever no Sleeve uses: the money no Sleeve was given, and each Sleeve's own cash (a strategy's empty places, what whole shares leave, sale proceeds waiting). It earns the fund's index on the Book's panels, its region's risk-free rate, on the cash at each close, in fractions and without costs. Whether and when the fund itself is bought and sold is for the Rule plan (issue 32).
  - **The NAV** is the Book's value per unit, 100 on its first close. New money buys units at the close before, so it moves the value, not the NAV.
  - **Costs:** the Sleeves pay the market's cost preset (brokerage ₹0, $0), whatever a strategy's own spec says, with its board lots and its securities' exchanges. The Hong Kong Book's gold ETF pays the US preset.
- **`pd book-backtest IN --strategy … [--start] [--end] [--data-version]`** (`pdash.pipeline.book_backtest`) prints the result as JSON (ash_new's `contract/book-backtest.schema.json`). By default it covers the ten years to the latest session.
  - **It names** the market's data version (the strategies ran on it, and `book_panels` builds from it) and the Book's panels' own, each strategy's version and run id, whether that version is approved, and the Mandate's version and numbers.
  - **It reports**, against the benchmark:
    - CAGR, max drawdown, volatility and Sharpe;
    - the holdout (1 January 2013 to 15 August 2016, the window ash_new's research held out), run as a Book backtest of its own, with its CAGR, max drawdown and Sharpe beside the benchmark's;
    - the distribution of rolling 12-month returns (least, 5th to 95th percentiles, most) and how often they beat the benchmark's;
    - the drawdown on each session, its distribution, and each fall deeper than 5%;
    - each weighting with its volatilities and weights, what the Book held at the end, its costs and what the cash fund earned;
    - its caveats.

    The deflated Sharpe waits for issue 30's Candidate test, which counts the trials.
  - **The same Book, data, versions and dates give the same result:** it records no time, and a test prints it twice and compares.
  - **A benchmark without total-return levels** in the Lake over the range is compared as its price index (`benchmark.basis`), and a caveat says so. That is always the case for Hong Kong's.
  - **It refuses** a strategy of another market, a strategy it doesn't know, and a Book whose gold ETF or cash fund has no price by its start. Holding cash in their place would be quietly wrong.
- **The stand-in `pd`** here has an example of its output (`test/pd/book-backtest.india.json`), which the tests check against ash_new's schema.
- **Not run on the real Lake.** The Lake still has no prices for `IN:GOLD1`, `IN:LIQUIDBEES`, `US:GLD` or `US:BIL`, since no `pd daily` has run since issue 26. So every Book backtest on it is refused. No refresh was run from here: `pd status` still fails on the proposed Correction of kind `bar` that issue 26 found. After the next `pd daily`, `pd book-backtest IN --strategy in-cw2-selected` runs.
- **Known limits, small enough to leave:**
  - A Sleeve resized while a holding has no bar at that open keeps that holding's shares. So gold, say, can miss its 10% until the next weighting.
  - The Hong Kong Book's gold ETF pays the US preset's per-share FINRA TAF, and its minimum and maximum, in Hong Kong dollars without conversion. That makes it about 7.8 times too small: cents.
  - India's preset carries Zerodha's ₹15.34 DP charge a scrip sold, not ICICI Direct's. The real brokerage comes with contract notes, as the PRD says.
  - A strategy that sits in cash for part of its year before the Book's start shows less volatility, and so gets more weight, than it would fully invested.
- **For Saransh: the risk-free rate is still one figure for the whole history** (the settings' `risk_free`: India 7%, the US 4%). Issue 26 left that decision here, and it isn't changed: a rate by date needs a source of each region's bill or overnight rate in the Lake, which is work of its own. Until then, the cash fund overstates the years when bills paid next to nothing (2011–2016 and 2020–21 in the US), and so the holdout's CAGR and Sharpe. Every result says so in its caveats.
