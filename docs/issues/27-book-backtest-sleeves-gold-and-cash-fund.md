# 27: Book backtest: Sleeves, gold and the cash fund

**What to build:** `pd book-backtest` backtests a whole Book. Its Sleeves follow their strategies' own tracks at inverse-volatility weights, beside 10% gold and the cash fund, and the result reports the Book's objective. This is the first slice of the Book engine that the Rule plan will later share. See the stocks Pipeline PRD's "The Book engine".

**Repos:** ash_new · **Mirrored in:** ash_new ticket 54 (keep both in step)

**Blocked by:** 26: Gold ETFs and cash funds in the Lake

**Status:** ready-for-agent

- [ ] The India and US Books are declared in ash_new's config, each with:
  - market, currency, broker and benchmark (the Nifty 500 TRI; the S&P 500 total return);
  - capital (a setting, with ash_new's preset capital standing in until set);
  - cash fund and gold ETF;
  - the Mandate's numbers, under a version: changing any of them makes a new version;
  - its real portfolio.
- [ ] The engine builds on ash_new's portfolio code that exists today (sizing, costs, drift and order proposals, paper follow) rather than making a second copy.
- [ ] A Book backtest runs each Sleeve's strategy on its own and lays the Book over it. The strategy's orders become the Book's at the Sleeve's weight, in whole shares (lots where a market has them), paying the cost presets (brokerage ₹0 / $0).
- [ ] The Book keeps each Sleeve's holdings apart, so a strategy's sale sells only its own Sleeve's shares.
- [ ] Sleeve weights:
  - Each strategy's weight is proportional to the inverse of its volatility over the past year.
  - Weights are set on the first session of each April and drift until the next.
  - Gold is reset to 10% at each re-weighting.
  - Whatever no Sleeve uses waits in the cash fund.
- [ ] Yearly new money, a set amount per year, goes in at each re-weighting.
- [ ] The result reports, against the Book's benchmark:
  - CAGR, max drawdown, the 2013–2016 holdout CAGR and Sharpe;
  - the distribution of rolling 12-month returns and of drawdowns.
- [ ] `pd book-backtest` writes the result as JSON, with a JSON Schema, naming the data version, each strategy's version and the Mandate's version. The same Book, data, versions and dates always give the same result.
- [ ] Tests on a fixture Lake:
  - a one-Sleeve Book returns its strategy's return, diluted by gold and cash;
  - weights follow inverse volatility;
  - re-weighting happens only yearly;
  - gold resets to 10%.
