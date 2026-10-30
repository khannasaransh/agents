# 36: Monthly review with attribution

**What to build:** On the first Saturday of each month, the review says where each Book's return came from and reviews its risk. See the stocks Pipeline PRD's "Reviews".

**Repos:** ash_new, agents

**Blocked by:** 35: Weekly review, promotions and demotions

**Status:** done, but for a review on real data: no paper Book has filled a close yet (see "Not done")

- [x] `pd review` attributes each Book's return over the month to its sources, which add up to the total:
  - Sleeve weights;
  - picks within Sleeves;
  - gold;
  - cash;
  - costs;
  - Overrides;
  - for the US Book in INR, the currency.
- [x] For a paper Book, the Overrides' part is its gap to its rules-only paper Book. It is not the sum of the Overrides' own scores, which interact.
- [x] It also reports:
  - the correlation between Sleeves;
  - each Book's drawdown against its limits;
  - the promotions due.
- [x] The Portfolio Manager writes the monthly commentary in that Saturday's Brief.
- [x] Tests:
  - attribution adds up to the Book's return;
  - a month with no Overrides attributes nothing to them;
  - the US Book's currency part matches the dollar's move.

**Notes:**

- **`pd review --month YYYY-MM`** (ash_new's `pipeline.attribution`, `contract/review.schema.json`'s `monthly`, null without `--month`) adds the monthly review of that month to the weekly one, for each Book's paper Book. The Review Step passes the month before on a month's first Saturday (`monthReviewed` in `src/schedule.ts`).
- **Where the figures come from:** each paper Book now keeps, for each close filled, where its value came from (migration 0019, `paper_book_closes`; `pipeline.paper_books.sources`): each Sleeve's holdings at the close before and at the close, the money its trades put into them, cash dividends and costs, and what the cash fund earned (`book_engine.Filled.interest`). From the first fill after this change; no paper Book has filled one yet, so nothing is lost.
- **The attribution** adds up exactly, close by close: each source's part of a close is what it made over the Book's value at the open (the close before plus new money), carried at the value per unit so far over the month's first. So new money in April doesn't break it.
  - **Sleeve weights:** each strategy's Sleeve's holdings after the open's trades (valued at the close before), at the Book's benchmark's return that session. **Picks within Sleeves:** the rest of what its holdings made. Both are given by Sleeve too.
  - **Gold**, **cash** (the cash fund, the Sleeves' own cash among it) and **costs**.
  - **Overrides:** the paper Book's return less its rules-only paper Book's over the same closes. The other parts are then the rules-only Book's (what the Rule plan's sources made, as the Brief and the Portfolio Manager's instructions say), so the parts still add up to the paper Book's return. So a month with no new Override still has a part for earlier ones whose effect lasts (a buy dropped last month is still not held): the tests' month without Overrides is one whose paper Book never had one. When the two haven't filled the same closes, the Overrides' part is null, with why, and the parts are the paper Book's own.
  - **Currency**, for a Book not in rupees (the US and Hong Kong Books, as the PRD has it): its currency's move against the rupee over the month. The other parts are its own times one plus that move, so they add up to its return in rupees. Without the rates it stays in its own currency, with why.
- **Correlation between Sleeves:** of daily returns over the year to the month's end: each reviewed Sleeve's strategy's own backtest, and the gold ETF's total-return index.
- **Drawdown against the limits:** the paper Book's value per unit against its highest close, at the month's last close and at its deepest in the month, against the Mandate's breakers (−10%, −18%) and its drawdown limit (−25%), naming each the deepest reached.
- **Promotions due** are the weekly review's `promotions_due`, shown again in the monthly section.
- **The Portfolio Manager** gets the monthly figures inside `review` and writes `monthly`, the commentary (null on other days). **The Brief** has a "Monthly review: October 2026" section after the weekly review: the commentary, each Book's sources in a table with its return, its benchmark's and its rules-only paper Book's, the correlations, the drawdown against the limits and the promotions due. A Book with nothing measured is left out.
- **On a copy of the real app database, 30 October 2026:** `pd review --dry-run --month 2026-10` runs and validates against its schema. The Data gate fails and no paper Book has filled a close, so each Book's attribution and drawdown say "Its paper Book has no close filled in 2026-10".
- **Tests:**
  - **ash_new:** `tests/test_attribution_rules.py` (on hand-made closes: the parts add up, with new money and costs; Sleeve weights are the holdings at the benchmark's return; no Overrides attribute nothing to them, a gap attributes itself; without the rules-only Book; the currency part is the dollar's move and the rupee return adds up; a missing benchmark day; the correlation pairs); `tests/test_monthly_review.py` (through fills and `pd review --month` on the fixture Lake run on through January 2019: each month's parts add up to the paper Book's recorded value per unit, December's with its costs; no Overrides, nothing to them; a dropped buy's gap; the correlation, the drawdown against the limits, a Book with no paper Book; no `--month`, no monthly; a bad month refused).
  - **agents:** `test/schedule.test.ts` (the first Saturday's month); `test/stocks-review.test.ts` (`--month` on the first Saturday); `test/portfolio-manager.test.ts` (the monthly figures in, the commentary out); `test/stocks-brief.test.ts` (the monthly review, the dollar's part, none on other Saturdays); `test/pd/review.monthly.json`.
- **Code review** (Standards and Spec, in parallel sub-agents). Fixed: the rate lookup now has tests of its own (the dollar's and the Hong Kong dollar's move against the rupee, from the close before to the last, and without rates), not only the attribution given a move; the Brief and the Portfolio Manager's instructions say the parts besides the Overrides are the rules-only paper Book's; a Sleeve left out of the correlation for its version says why; a missing docstring, a needless default on `Filled.interest`, an unclear parameter name and two docstring wraps. Left as judgement calls: `_attribution`'s nine parameters and the month passed beside its dates; `sources` as a dict shared by key between `pipeline.paper_books` and `pipeline.attribution` (it is stored as JSON); `monthly` taking the specs rather than the weekly review's `Reviewing`, which would import `pipeline.review` back; the correlation's backtest call repeating the weekly review's; the Mandate's limit names written out in ash_new, the agents types and the Brief.
- **Not done:**
  - No paper Book has filled a close on the real Lake (no strategy is in Paper yet), so no month has been attributed on real data.
  - The real Books aren't attributed: they have no Order lists until issue 42.
  - **For Saransh:** two choices made here. "Sleeve weights" is each Sleeve's money at the benchmark's return, so it carries the market's move and "picks" is what beat or lagged it; the other reading (the inverse-volatility weights against an even split) would put the market in "picks". And the correlation is over each strategy's own backtest for the past year, since the live tracks are only months old. Say if either should change.
