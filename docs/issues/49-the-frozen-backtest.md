# 49: The frozen backtest

**What to build:** Each strategy version has one backtest over 2006 to 2016 whose result never changes, whatever the Lake learns later: run on data built once from the Lake and pinned, worked out once and kept. See the stocks Pipeline PRD's story 143.

**Repos:** ash_new · **Mirrored in:** ash_new ticket 60 (keep both in step)

**Blocked by:** 25: CW2's selected variant and the ash ports

**Waiting on Saransh:** nothing now. India's early prices are left uncorrected for the moment; next, the frozen results and the early data's falls are checked against MarketSmith's chart data.

**Status:** done

- [x] Each market's frozen data is built from the Lake over 2005 to 15 August 2016 and pinned in ash_new's `config/frozen_backtest.yaml`. It is kept for good, beside the data the daily backtests use.
- [x] The Lake's indices, which start in 2011, get Yahoo's earlier bars for it.
- [x] Frozen data that is lost is built again only if it comes out the same, else refused.
- [x] Each strategy version's frozen backtest (1 January 2006 to 15 August 2016) is worked out once and kept. A changed strategy is a new version with its own.
- [x] `pd frozen build` and `pd frozen backtest` in ash_new, and every built-in version's frozen backtest worked out.
- [x] Tests: a result that doesn't change when the Lake does, a new version's own result, and lost data built again only as it was.

**Notes:**

- **Why:** the daily backtests run on the current Lake, which each refresh can change: a Correction, a new delisted security, a split it learns of, today's sectors. Old results move a little each time. The frozen backtest's data and results don't.
- **The frozen data,** pinned in ash_new's config, with ash_new's [frozen backtest record](../../../backend/portfolio-dashboard/docs/review/2026-10-26-frozen-backtest.md):
  - India: `frozen-2016-08-12.acc4562dfe7c`, 1,459 securities;
  - the US: `frozen-2016-08-15.562c2d18c1cb`, 3,292 securities;
  - Hong Kong: `frozen-2016-08-15.3f1b265827ec`, 1,553 securities.

  The window ends where the 2016–2026 selection window starts.
- **The data's limits before 2011:**
  - **India's indices:** the Nifty 500 starts on 26 September 2005, so the regime filter buys nothing until mid-2006. The Nifty 50, which India's ports rank relative strength by, starts on 17 September 2007.
  - **Fewer securities** on 2 January 2006 (India 650, the US 2,158, Hong Kong 857), and none of those delisted before the Lake began. So the early years favour survivors.
- **India's 2005–2010 prices have errors, now frozen in.** They hold 161 one-session collapses of 50–100%, against 15 in 2011–2016, and only 20 are matched by a stored split or bonus. They look like bonuses, splits and demergers the Lake never learned of. They give strategies fake losses and keep stocks out of CW2 for ten years.
  - **The effect:** CW2's selected variant makes 10.62% in the 2013–2016 holdout on the frozen data, against 38.96% on the current Lake.
  - **To fix:** Corrections for the early falls, approved. Then delete India's pin and freeze India again. India's results then change once, by decision, and never again.
  - The US's and Hong Kong's early falls cluster in 2008–09, so many may be real.
- **The approved versions over 2006–2016:** 20 of 21 beat their benchmark. The exception is `in-swing-v1-tuned`: 8.29% against the Nifty 500's 10.85%.
  - **The US:** 7.6–11.6% a year against the S&P 500's 5.3%.
  - **Hong Kong:** the two Swings make 13.0% and 13.3% against the Hang Seng's 4.1%.
  - **The approvals are unchanged.** The frozen backtest is a reference, and the Candidate test (issue 30) may read it.
- **Back it up:** the frozen data lives in ash_new's `data/lake/`, which git ignores. A copy of `data/lake/panels/region=*/frozen-*` and `data/lake/frozen/` is what keeps the same results on another machine.
