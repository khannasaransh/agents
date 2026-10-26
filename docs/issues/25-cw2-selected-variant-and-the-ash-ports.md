# 25: CW2's selected variant and the ash ports

**What to build:** The Candidate test chooses only from strategy versions Saransh has approved. The ash ports already exist (ash_new's review of 20 Oct 2026, with tests showing their signals match ash's code), so they are audited, not ported again. Each strategy gets a named version, and a report says how each port differs from ash's own strategy. CW2's selected research variant runs as a strategy of its own. See the stocks Pipeline PRD's "Strategies and Stages".

**Repos:** ash_new · **Mirrored in:** ash_new ticket 52 (keep both in step)

**Blocked by:** 15: Fix the stuck refresh and the dying process pool

**Status:** done

**Waiting on Saransh:** nothing. He approved versions on 26 October (issue 48 lists them).

- [x] Every strategy has a version: its rules, its parameters and its code hash. A change to any of them makes a new version, which is a new strategy and starts as a Candidate.
- [x] CW2's selected variant is a strategy of its own for India and the US, next to the original. Its rules:
  - the SuperTrend(10, 2) gate;
  - ranking 80/20 by RS over 55 sessions and up-days over 63;
  - the 5% regime buffer in India;
  - fills at the next open.

  Nothing is launched yet, so nothing has a live track to move.
- [x] Its backtests reproduce the research's figures within rounding, or the difference is explained:
  - India 2016–2026: 29.95% CAGR, −27.86% max drawdown, 38.96% CAGR in the 2013–2016 holdout;
  - US 2016–2026: 20.91% CAGR.
- [x] The ash ports (CMO Momentum, HAMA, Investor, Swing, GFS, Aim & Shoot, RS Rating, the Super 30s) are audited. A report gives, for each port's version, how it differs from ash's own strategy:
  - fill timing: the ports trade on the close, as ash does, while the Books trade at the next open;
  - the regime index: India's is the Nifty 500, where ash used ^NSMIDCP;
  - costs and the benchmark;
  - inputs ash had that the Lake doesn't, such as Super 30's fund-holder history.

  The tests showing each port's signals match ash's code stay as they are.
- [x] Each port gets a version that fills at the next open, which is the one a Book can trade. Both versions are backtested on the current Lake, and the report gives both.
- [x] The approved versions are recorded in ash_new's config. The Candidate test considers only those, and no version inherits an old backtest's approval by name.
- [x] Tests:
  - the variant's gate, ranking and buffer behave as specified on a fixture Lake;
  - a changed parameter makes a new version;
  - a port's next-open version fills at the next session's open.

**Notes:**

- **A version** is a strategy's rules, its parameters and its code. In ash_new it is 12 hex digits hashed from the spec's content hash and the engine's version (`pdash.strategies.approvals.version_of`). The content hash holds a plugin's file's hash; the spec's id, name and description aren't part of it, but a plugin's file is hashed whole, so a change to its words is a new version too. `pd versions` lists every built-in strategy's version, where it fills and whether it is approved.
- **Approvals** are in ash_new's `config/approved_versions.yaml`, each naming a strategy and its version.
  - An approval of a version that is no longer the strategy's is stale: `pd versions` lists it, and it approves nothing.
  - `candidates(settings)` gives the built-in strategies whose current version is approved. Issue 30's Candidate test reads it.
  - **21 are approved,** from 26 October, at Saransh's word. The rule: a version a Book can trade whose CAGR beat its benchmark's in both 2016–2026 and the 2013–2016 holdout. Issue 48 lists them.
- **The engine's version is part of every strategy's.** CW2's SuperTrend and up-day ranking, and every port's slot trading rules, live in ash_new's engine (`pdash.engine.trading`), not the plugin's file. A change there bumps `ENGINE_VERSION`, so it is a new version of every strategy and unapproves them all, even one whose trades it doesn't change. Saransh then approves again from `pd versions`.
- **"Starts as a Candidate"** means, until the Stages exist (issue 31), that a new version has no approval.
- **Each port's versions**, in ash_new's plugins. A plugin's `strategies` may now name `"IN:next-open"`, which makes `in-<plugin>-next-open`.
  - **ash's version** (`in-hama`): ash's settings, filled on its signal's own close as ash's engine fills. Its signals are the ones the port's tests check against ash's code, unchanged.
  - **`-next-open`**, in India and the US: the same settings, filled at the next open. This is the version a Book can trade.
  - **`-tuned`**, in India and the US, where ash_new's cross-market study of 20 October changed something: its setup, filled at the next open.
  - **`-selected`** is CW2's: the research's selected variant. So `in-cw2-selected` and `us-cw2-selected` sit next to the original `in-cw2` and `us-cw2`.
  - **Hong Kong** kept ash's version only, since no Book traded it. Issue 48 made it a Book and gave it the same versions: `-next-open` for each port; `-tuned` for HAMA, Investor and Swing; `-selected` for CW2.

  Since 20 October each region had traded the study's setup at the next open, under the plain id. Now ash's setup and the study's are both kept, each under an id of its own.
- **CW2's selected variant reproduces its research exactly.** That holds on the current Lake and on the panels the research pinned:

  | | Sharpe | CAGR | Max drawdown | CAGR, 2013–2016 holdout |
  |---|---|---|---|---|
  | India | 1.029 | 29.95% | −27.86% | 38.96% |
  | US | 0.842 | 20.91% | −26.01% | |

  So no difference needs explaining.
- **The audit** is ash_new's `docs/review/2026-10-26-strategy-versions.md`. It gives each port's differences from ash's own strategy, and both versions' backtests on the current Lake.
  - **Fill timing:** ash fills on the close. Filling at the next open costs most of India's ports 1–5 points of CAGR (Swing 13.70% → 8.80%, Super 30 OK −2.75, HAMA −1.96). A few gain: CW2 India +1.22, Swing US +2.27.
  - **The regime index:** India's is the Nifty 500, where ash used ^NSMIDCP. On the Nifty 500, ash's own code lands within a few points of the ports. The US and Hong Kong use ash's own index.
  - **Costs:** ash charged a flat rate a side plus slippage (India 0.30% + 0.15%). ash_new charges each market's preset, with slippage by liquidity. So India's liquid names cost less than in ash, and its thinnest cost more. Neither has ICICI Direct's real brokerage (issue 23).
  - **The benchmark:** each region's broad index, price return. ash reported India against the Nifty 50.
  - **Inputs:**
    - Super 30's fund holders aren't in the Lake, so every stock gets that point.
    - RS Rating uses ash_new's point-in-time RS Rating, not MarketSmith's snapshot.
    - Investor's quality veto isn't ported. It was inert in ash's runs.
    - vol_delivery isn't ported at all.
    - ash's cache started in 2015, and its symbol list was a snapshot.
  - **Every figure reproduces its earlier record:** the close figures the port's record of 20 October, the next-open and tuned figures the cross-market study's.
- **Against the benchmark in the 2013–2016 holdout**, issue 30's first gate, several versions a Book can trade fall short. Issue 30 decides.
  - **India:** GFS, HAMA, Investor, and CMO Momentum at ash's settings. CMO Momentum's tuned version passes.
  - **The US:** GFS, HAMA and Aim & Shoot.
- **Nothing is launched**, so no live track had to move.
- **What the versions cost:** the plugins now make 61 strategies, up from 29.
  - None is in ash_new's app database yet, because its API hasn't started since the ports. Its first start queues their backtests.
  - After that, each `pd daily` with new data reruns every stale strategy, one after another.
  - The 51 India and US versions took about 63 minutes of backtests, eight at a time. The 19 they replace took 23. That still fits within the Lake Step's 3-hour timeout.
  - If it grows too long, the fix is to rerun only the approved and launched strategies daily. That isn't done here.
- **Issue 15's status line** still says ready-for-agent, though all its boxes are ticked (as are ash_new ticket 50's). It is left as it was.
