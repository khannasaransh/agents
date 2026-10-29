# 46: Market condition and the exposure level

**What to build:** Code reads each market's Market condition from the Lake, and the condition sets how much of each Book may be in stocks. The Book engine applies that exposure level in the Book backtest and the Rule plan alike, so holding less in a weak market is tested like any other rule. See the stocks Pipeline PRD's "The Market condition and the Playbook", "The Book engine" and ADR 0003.

**Repos:** ash_new, agents · **Mirror:** not yet in ash_new's tickets

**Blocked by:** 28: Book backtest: caps, breakers and the order-size guard

**Status:** done, but for MarketSmith's outlook, which no fetch records yet (see "Not done")

**Waiting on Saransh:** the Market condition's thresholds and the exposure levels. Until then the placeholders are 100%, 80% and 40% for Uptrend, Under pressure and Correction.

- [x] ash_new reads each market's Market condition (Uptrend, Under pressure or Correction) for any session, from data up to that session's close:
  - the index against its 50- and 200-day averages;
  - breadth: the share of the index's members above their 200-day average;
  - distribution days.

  Its thresholds are in ash_new's config.
- [x] MarketSmith's own outlook, from the latest dated snapshot, is recorded beside the condition and decides nothing.
- [x] Each Book's config sets its exposure level for each Market condition.
- [x] The Book engine applies the exposure level after the breakers. While the Book holds more in stocks than the level:
  - it makes no new buys;
  - it then trims the weakest holdings first: lowest RS Rating first, with ties going to the one closest to its stop.

  The strategies' own tracks never see this rule, so each trim's counterfactual is at hand.
- [x] The Book backtest reports how often the exposure level acted and what it cost or saved, and runs with and without it.
- [x] The Stocks Brief shows each market's Market condition, MarketSmith's outlook beside it, and each Book's exposure level.
- [x] Tests:
  - **ash_new:** each condition is read right from a fixture Lake; over the level, no new buys are made, then the weakest are trimmed first, ties going to the one closest to its stop; the backtest with and without the rule.
  - **agents:** the Brief shows the condition and the level from a stand-in `pd plan`.

**Notes:**

- **The Market condition** (`pdash.engine.market_condition`) is read on each session's close from the data to that close, by each Book's benchmark (the Nifty 500, the S&P 500, the Hang Seng). Its thresholds are in `config/market_condition.yaml` (the same placeholders stand in without the file):
  - **the index** against its 50- and 200-day averages of its closes;
  - **breadth:** the share of the index's members with a bar above their own 200-day average, of those with 200 closes. The members are the index's on that session where the Lake keeps its membership (`core.indices`: the Nifty 500 and the S&P 500); elsewhere (the Hang Seng, and before a membership's history begins) the whole market's securities stand in, and the reading says which (`breadth_of`);
  - **distribution days:** sessions the index fell 0.2% or more on more volume than the session before, over the last 25 sessions. The Lake keeps no index volume, so the shares its members (or the market) traded together stand in for it.

  **Correction:** the index under its 200-day average with breadth under 40%, or 7 distribution days. **Under pressure**, if not a Correction: the index under its 50-day average, breadth under 50%, or 5 distribution days. Otherwise **Uptrend**. These combinations are placeholders as much as the numbers.
- **The exposure level** is each Book's `exposure` in `config/books.yaml` (100%, 80%, 40%; outside the Mandate, so its version is unchanged). A session trades under the level its market's condition on the close before sets (`exposure_by_row`).
- **In the Book engine** (`portfolios.book_engine`, rule 4, after the breakers): the stocks are everything but gold, Legacy holdings among them.
  - **No new buys:** a buy in a strategy's Sleeve is cut to the room under the level (`exposure_level`), so over it a buy is stopped.
  - **Trims:** at each open while the stocks are over the level, the strategies' holdings are sold weakest first (`exposure_trims`): the lowest RS Rating on the close before (ash_new's re-created rating; none counts as the weakest), ties going to the holding closest to its Disaster stop. Each is sold out until the last, which is trimmed by what is left over, across the Sleeves holding it in proportion. Legacy holdings are never trimmed here.
  - **The second breaker** now holds the stocks to half the exposure level, not half the Book.
  - Stocks rising back over the level are trimmed again the next session, a little at a time, as the halved breaker's selling down does.
- **The Book backtest** (`BOOK_ENGINE_VERSION` 4) reads the market's condition on its panels and reports it as the other rules: `rules.exposure_level` has the buys it cut, the trims and what they raised, the levels, how many sessions of the range the market spent in each condition, and the same Book without it (`without`, `effect`). The Candidate test runs its Books under it too. The caveat that it was missing is replaced by one saying its levels and thresholds are placeholders.
- **`pd plan`** now begins with `markets`: each Book's market's reading on the last close, the exposure level it sets the Book, and MarketSmith's outlook (`marketsmith.snapshots.outlook_of`, the latest snapshot on or before the Run's day). Each plan has its `exposure` (the condition and level), and its session trades under it, as the backtest's would.
- **The Brief** has a "Market condition" table before the plans: each market's condition, its index against its averages, breadth and whose it is, distribution days, MarketSmith's outlook, and its Book's exposure level, with what each means. A plan says the level it trades under.
- **The stand-in `pd`'s examples:** `book-backtest.india.json` is regenerated from the fixture run, with `rules.exposure_level`; `plan.shadow.json` and `plan.cant-plan.json` have `markets` from the real Lake.
- **On the real Lake, 23 October 2026's close:** India in a Correction (the Nifty 500 at 21,428, under its 50-day 22,730 and 200-day 22,814; 27% of its members above their 200-day average; 11 distribution days), so the India Book's level is 40%. The US Under pressure (the S&P 500 under its 50-day average; 55% breadth; 5 distribution days): 80%. Hong Kong in a Correction (22% of the market): 40%.
- **On issue 30's copy of the Lake**, `pd book-backtest IN --strategy in-super30-ok-tuned` (2016-10-24 to 2026-10-23): the market was in an Uptrend on 902 sessions, Under pressure on 861 and in a Correction on 713. The exposure level stopped 13 buys and made 112 trims; it cost 0.2 points of CAGR (15.6% against 15.9% without it) and made the max drawdown 3.3 points shallower (−15.5% against −18.8%).
- **For Saransh:**
  - **The objective:** with the exposure level, that Book's holdout CAGR is 15.6%, under the 20% objective it met in issue 30's Candidate report (21.9%). The report was made without the level; running the Candidate test again would choose under it.
  - **The thresholds and levels:** the condition is Under pressure or a Correction on 63% of the ten years' sessions at these placeholders. Thresholds that call fewer of them would trade the drawdown it saves for less of the return it costs.
- **Not done:**
  - **MarketSmith's outlook:** no fetch records it, so each snapshot's is null and the Brief says "not in its snapshot". Recording it means finding which of MarketSmith's responses carries it, in `pd marketsmith`.
  - The Hang Seng's members aren't in the Lake, so Hong Kong's breadth is the whole market's.
