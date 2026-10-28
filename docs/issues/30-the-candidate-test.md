# 30: The Candidate test

**What to build:** For each Book, a Candidate report says which strategies earn a place, and whether the Book they make meets its objective. A strategy earns its place by what it adds to the Book, not by its own drawdown. See the stocks Pipeline PRD's "Strategies and Stages" and "The Book engine".

**Repos:** ash_new · **Mirrored in:** ash_new ticket 57 (keep both in step)

**Blocked by:** 25: CW2's selected variant and the ash ports; 28: Book backtest: caps, breakers and the order-size guard; 29: Book backtest: Disaster stops and Stage scaling

**Status:** done

- [x] Only the versions Saransh approved (issue 25) are tested: `pdash.strategies.approvals.candidates` gives the built-in strategies whose current version is approved in ash_new's `config/approved_versions.yaml`.
- [x] Each strategy in a Book's market is tested for:
  - holdout CAGR against the benchmark's over the same years (2013–2016);
  - a deflated Sharpe that clears 95%, counting every variant tried in its family as a trial (using the robustness tools from ash_new's ticket 44);
  - the Book backtest with and without it.
- [x] Candidates are chosen by forward selection. Starting from gold and the cash fund, the strategy that improves the Book most joins, until none does. "Improves" means a higher CAGR with max drawdown still at or below 25%, or a lower drawdown for the same CAGR.
- [x] The report checks the chosen Book against its objective: max drawdown at or below 25%, holdout CAGR at or above 20%.
- [x] A `pd` command writes each Book's Candidate report as JSON, with a JSON Schema, and as a readable summary.
- [x] The test is run on the current Lake for India and the US, and the reports are saved for Saransh to choose from.
- [x] Tests:
  - a strategy that improves a fixture Book passes;
  - a strategy that only adds drawdown fails;
  - a strategy that fails its holdout fails, whatever it adds.

**Notes:**

- **The command.** `pd candidate-test IN --out <folder>` (`pipeline.candidates`) prints the report as JSON (`contract/candidate-test.schema.json`) and, with `--out`, writes `IN.json` and a readable `IN.md` there. The range is the Book backtest's: the ten years to the latest session by default (`--start`, `--end`, `--data-version`).
- **Each strategy's three tests:**
  - **Holdout:** its own backtest over 2013-01-01 to 2016-08-15, against its own benchmark over the same sessions. The report names the benchmark and its basis (`holdout.benchmark`): every approved strategy's run compares against its benchmark's total return. So the Nifty 500 made 13.9% a year in the holdout, not the 12.6% price return the approvals' notes cite.
  - **Deflated Sharpe:** ticket 44's `analytics.robustness.deflated_sharpe`, on the strategy's own run over the range. It has to reach 95%.
  - **The Book with and without it:** against the chosen Book. For a strategy chosen, that is the chosen Book and the same without it. For any other, it is the chosen Book and the same with it added. A strategy that fails a gate fails whatever it adds; its "with" still says what it would have added.
- **Families and trials.** A strategy's family is the file it comes from (`strategies.trials.family_of`): a plugin's file (`cw2.py` makes every CW2 version; `super30.py` makes all three Super 30s), or a template's. Its trials are every variant the research tried of it, in its market, with its Sharpe over 2016-08-16 to 2026-08-14. They are in `config/trials.yaml`, which a census writes from the research's committed archives (`docs/review/candidate-test-20261028/census.py`):
  - Sources: the strategy-versions study, ash-strategies-opt (each change's Sharpe from its delta to the baseline), other-strategies-opt's evidence, and CW2's four archives.
  - A variant run only on a study's "saved" window counts once. The same curve recorded twice (a reproduced baseline, a carried-over variant) is one trial: Sharpes are compared to six places.
  - The counts: CW2 has 112 trials in India and 111 in the US. Super 30 has 22, Swing 16, CMO Momentum, Investor and Aim & Shoot 15 each, RS Rating 6.
  - The file records the built-in versions among the trials, so a strategy's own run is added as a trial only when its version isn't one of them.
  - Without the file the test refuses to run, rather than letting every strategy be its own only trial.
- **Forward selection.** Each round runs the Book with each strategy that passed both gates added to those chosen so far, at Real-full, after the ones before it (so the caps' room goes to those chosen first). The one that improves the Book most joins: the highest CAGR, then the shallowest drawdown among CAGRs the same. "The same CAGR" means within 0.1 point (`SAME_CAGR`), so a CAGR higher by less than that counts as the same and needs a shallower drawdown to improve. Each Book is run once and then reused.
- **The objective** is the Mandate's `drawdown_limit` (−25%) over the range, and the chosen Book's own holdout CAGR at 20% or more (`OBJECTIVE_CAGR`, a constant: it isn't in the Mandate, so the Mandate's version is unchanged).
- **The Book backtest's pieces** are now shared (`book_backtest.book_setup`, `run_window`, `headline`, `holdout`, `book_caveats`). `pd book-backtest`'s output is unchanged.
- **Run on the current Lake, 28 October 2026** (panels India `2026-10-23.70c27d24c7a7`, the US `2026-10-23.05106c938bea`; 2016-10-24 to 2026-10-23). The reports are in `docs/review/candidate-test-20261028/` (`IN.md`, `US.md`, and their JSON):
  - The Lake still has no prices for the Books' four ETFs. So the test ran on a copy of it (`run.py --copy`): the securities table was rebuilt as `pd build-securities` does, and the script checks that nothing in it changed but the four ETFs; their prices were fetched as `pd prices-backfill` does. The real Lake wasn't touched.
  - **India: one Candidate, `in-super30-ok-tuned`.** The Book it makes meets the objective: 15.9% a year, a −18.8% max drawdown, and 21.9% in the holdout.
  - In India the deflated Sharpe is what decides. Only `in-super30-ok-tuned` clears 95% (95.1%, 22 trials); the other eleven reach 41%–92%. `in-cw2-selected` would have improved the Book most (16.2% with a −14.7% drawdown), but its Sharpe of 1.06 against CW2's 112 trials makes 77%.
  - **The US: no Candidate.** The Book is gold and the cash fund alone, which misses the objective: 3.0% a year in the holdout.
  - Only `us-investor-v1-next-open` passes both gates in the US. Adding it takes the Book from 4.8% to 1.8% a year, with a −20.7% drawdown.
  - The Mandate's rules cost a Book of a single 8-slot strategy most of its return. In `pd book-backtest US --strategy us-investor-v1-next-open`, the breakers alone cost 15.0 points of CAGR: no new buys four times in 2018, then half the exposure from October 2018 to January 2021. The sector cap, the position cap, the limit price and the Disaster stops cost 6–8 points each.
  - `us-cw2-selected` fails its holdout (13.4% against the S&P 500's 14.2% total return) and its deflated Sharpe (92%).
- **For Saransh:**
  - **Choosing from these reports:** at a 95% bar over each family's every variant, the research's own search leaves almost nothing. Lowering the bar, or counting trials differently (for example, a family's trials across markets, or only its versions), is a decision for you; this test only reports.
  - **The breakers:** the US result says more about the breakers than about the strategies, and the exposure level (issue 46) is still missing from the Book engine.
- **Known limits, small enough to leave:**
  - The trials' Sharpes cover 2016-08-16 to 2026-08-14, while a strategy's own run covers the Book's range. By default the two are about two months apart.
  - Sweeps run on the dashboard (ticket 44's `tally`) aren't counted. None has been run on a built-in strategy.
  - A strategy chosen early stays chosen, even if a later one makes it unneeded: the chosen Book without it may then not be worse. The caveats say so.
  - `run.py --copy` copies a folder only once. Run it again on a fresh copy after the real Lake changes.
