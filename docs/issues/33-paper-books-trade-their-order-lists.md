# 33: Paper Books trade their Order lists

**What to build:** Each Book has a paper Book that trades its Order list automatically at the next open. Beside it, a rules-only paper Book trades the Rule plan unchanged, so what the Portfolio Manager's judgement adds can later be measured (ADR 0004). The Brief shows how each stands. The process runs end to end on paper, with no real money involved. See the stocks Pipeline PRD's Check Step and "Real Books, paper Books and orders".

**Repos:** ash_new, agents

**Blocked by:** 32: Rule plan for the paper Books

**Status:** done, but for fills on the real Lake: no strategy is in Paper there yet, and the Lake has no prices for the Books' ETFs (see issue 47's "On the real Lake")

- [x] Each Book has two paper portfolios in ash_new, fed by Order lists:
  - its paper Book, which trades the final Order list;
  - its rules-only paper Book, which trades the Rule plan unchanged.

  Both start on the same day with the same cash and new money, and hold the same Sleeves at the same Stages.
- [x] A Check Step records each paper Book's Order list in ash_new, with ids and states. For now the Order list is the Rule plan unchanged.
- [x] The Check Step records nothing unless this Run's Plan Step succeeded and each Rule plan's Book state is still current. Otherwise the Brief says why.
- [x] If a session already has an Order list (because a Run was started again), recording a new one supersedes the old one's orders. No order is recorded twice.
- [x] Each order fills at the next session's open with the strategies' costs, through the daily chain. Fills are applied only once that chain's Health report passes; until then they wait.
  - Sales go first, and buys are cut to the cash available, as a manual paper portfolio's applied rebalance is today.
  - A buy fills only at or under its limit price.
- [x] Disaster stops are simulated on paper Books as in the backtest.
- [x] The Brief shows:
  - each paper Book's value, and its gap to its rules-only paper Book;
  - its drawdown against its breakers;
  - its Sleeves and Stages;
  - the positions whose Disaster stop would lose more than 1% of the Book;
  - the Books' combined value in INR.
- [x] A dry run records no Order list.
- [x] Tests:
  - orders fill at the next open, and each paper Book fills from its own list;
  - sales go before buys, and a buy is cut to the cash available;
  - a buy above its limit doesn't fill;
  - fills wait for a passing Health report;
  - a Disaster stop is hit on paper;
  - the Check Step records nothing when the Plan Step failed;
  - a second Order list for the same session supersedes the first and records no order twice.

**Notes:**

- **The paper Books** (`pdash.paper_books`; `PaperBook`, `OrderList` and `BookOrder` in the app database, migration 0016): each Book has a paper Book and a rules-only paper Book, each one of ash_new's paper portfolios (follow mode none, marked by its Book), made with its first Order list. Each keeps the Book engine's state on its last close filled (`BookState`, as JSON), which its next Rule plan runs from, and each Sleeve's strategy's stop distance. Both start on the same day (`pd check` starts neither unless both can: the close their first plans were made on, their capital shared out at their Sleeves' weights), with the same Sleeves at the same Stages (from `pd stages`), and take the same new money at each April's weighting.
- **`pd plan`** now makes each rules-only paper Book's plan beside its paper Book's (`kind: rules_only`, order ids `IN-rules-<session>-<n>`). Each paper plan carries what its Order list needs to be filled (`engine`): the Book engine's state it ran from, the money it moved at the open between the cash fund and each Sleeve, the new money, each Sleeve's strategy's weights after, and each strategy's stop distance. A paper Book whose Order list for a session the data already has isn't filled yet (its fills waiting for the Health report) can't be planned: its plan says why, so a list is never planned twice.
- **The Check Step** (`steps/stocks/check.ts`, after Plan) runs `pd check --plan plan.json --run <id>`, kept as `check.json`, then `pd paper-books`, kept as `paper-books.json`.
  - **What it records:** for now each paper Book's final Order list is its Rule plan unchanged (the Portfolio Manager is issue 34's), and each rules-only paper Book's is its own Rule plan. Each order is placed, to fill at the next open.
  - **Only if current:** a plan whose Book state id, Mandate version or Playbook version isn't current is not recorded, and the Brief says why. When this Run's Plan Step didn't succeed it records nothing, says why in `check.json` and skips itself.
  - **A second list** for the same session (a Run started again, its plans made again from the state the first list left) supersedes the first's orders; the same plan again records nothing (`unchanged`), whatever the state now says, so no order is recorded twice.
  - **A dry run** passes `--dry-run`: nothing is recorded, and the Brief says what would be.
  - **When a paper Book starts:** with its first plan outside Hold mode that has a strategy in Paper. Its first list shares its capital out and makes its strategies' first buys, which the Book engine makes only once, so a Hold-mode plan (no orders) or one with no strategy (gold alone) would start it with nothing bought, its strategies' holdings bought only when they traded again. Until then nothing is recorded, and why is said.
- **Fills** (`pipeline.paper_books`, the daily chain's new `paper_books` step after `health`, and `pd paper-fill`): each paper Book is brought from its last close filled to the Lake's last session, a session at a time, by the Book engine (`book_engine.fill`), which reuses the backtest's session: the cash fund's return and dividends, each Disaster stop the price opens through, then the session's Order list at the open (`Follower.fill`), the stops for the new positions and those the low reaches, and the close with its breakers and weekly raises.
  - **The orders:** sales first, then the money the plan moved between the Sleeves and the cash fund (into a Sleeve, no more than the cash fund holds), then buys, each cut to the whole shares its Sleeve's cash pays for, with the strategies' costs. Cutting to the Sleeve's cash, not the Book's, is how the Book backtest pays for a Sleeve's buys. A buy fills only at or under its limit. Each order is then filled, partly filled or expired, with why (`no_bar`, `over_limit`, `no_cash`, `not_held`); the ledger's trades carry their order's id.
  - **Health:** nothing is filled until the chain's Health report passes (not `fail`; the latest report when the chain didn't check). Until then the fills wait.
  - **Sessions without a list** trade nothing. A list whose session the data never had expires once later sessions are filled, and no longer waits.
- **`pd paper-books`** (`contract/paper-books.schema.json`): for each Book, its paper Book's and rules-only paper Book's value on their last close filled (their capital before), the gap between them, the paper Book's drawdown against its breakers, its Sleeves and their Stages with each Sleeve's value, and the positions whose Disaster stop would lose more than the Mandate's risk per trade (1%) of it; then the paper Books together in rupees, at each currency's latest rate (a Book whose currency has no rate is named apart).
- **`pd book-state <book> --paper`** (and `--rules-only`) now reads the paper Book's state: its holdings and cash summed over its Sleeves, its Disaster stops, the orders of its lists not yet filled and the cash their buys reserve at their limits, its last close filled (`as_of`) and the engine's state (`engine`). The Plan Step asks for the rules-only one's too.
- **The Brief:** after each paper Book's plan, its rules-only paper Book's (one line while it makes the same orders), then the Order lists the Check Step recorded (or why none was), then a Paper Books section: each Book's paper Book against its rules-only one, its drawdown against its breakers, its Sleeves and Stages, its riskiest Disaster stops, and the Books together in rupees. A paper Book's state shows its last close filled, the orders waiting and its Disaster stops. The Brief's `render` now takes its inputs as one object (issue 32's review noted its 12 parameters).
- **The contract:** `contract/check.schema.json` and `contract/paper-books.schema.json` are new; `plan.schema.json` adds `kind: rules_only` and `engine`; `book-state.schema.json` adds `rules_only`, `as_of` and `engine`. The stand-in `pd` has `check.recorded.json`, `check.dry-run.json`, `paper-books.json` and `book-state.rules-only.json`, and each plan example now has the rules-only plans.
- **On issue 30's copy of the Lake, 27 October 2026** (with a copy of the app database): the Data gate fails (no Health report, the copy three sessions behind), so every plan is in Hold mode and `pd check` records nothing, each paper Book waiting for its first plan outside Hold mode; Hong Kong has no panels there. `pd paper-books` gives each Book its capital in cash, ₹2.25 crore together at the copy's rates.
- **ash_new's web app:** the Data page names the new daily chain step ("Paper Books"); its API types are regenerated.
- **Tests:**
  - **ash_new:** `tests/test_paper_fill.py` (the engine: fills at the open, sales before buys and a buy cut to its Sleeve's cash, a buy over its limit, a Disaster stop hit on paper, a session without a list, no bar, the plan's money moved); `tests/test_paper_books.py` (recording each paper Book's list and its rules-only one's, a second list superseding the first with no order twice, a stale state not recorded, a dry run, each paper Book filling from its own list at the next open, fills waiting for a passing Health report, the next plan running on from the filled state, and `pd paper-books`). The fixture lake moved to `tests/plan_lake.py`.
  - **agents:** `test/check.test.ts` (recording, nothing recorded when the Plan Step failed, a dry run, a failing `pd check`), and the Brief's and the Pipeline's tests.
- **Found on the way, fixed:** on issue 30's copy of the Lake, the Hold-mode plans would have started each paper Book empty (hence the rule above). And before a fix, a paper Book whose first list was recorded but not yet filled counted as not started, so the next Run would plan its first buys again, and the fills would buy twice. A test caught it.
- **Code review** (Standards and Spec, in parallel). Fixed:
  - **Spec:** the paper Book and its rules-only paper Book could start on different days (a stale state refused one but not the other); now neither starts without the other, and a test shows it. Money moving into a Sleeve could overdraw the cash fund when a sale filled short; it is now capped at what the cash fund holds. A list whose session never came stayed "waiting" in `pd paper-books`; it is now closed when it expires.
  - **Standards:** ash_new's glossary had two "Order list" rows with different meanings (the new one is now "Paper Book's Order list"); its "Daily chain" and "Job" rows didn't name the new step; docstrings said "trades" for what the glossary calls transactions; the fill report named the paper Book "IN paper paper Book"; `"no_session"` was a bare string twice.
  - Left as judgement calls: near-duplicate code (summing Sleeves' holdings, reading a paper Book's state, the unfilled lists), the plan kinds as strings beside `PaperBookKind`, the many `fill` names, `OrderState.PROPOSED` and `SKIPPED` unused until issue 42, and superseded orders keeping their ids beside the new ones (only placed orders fill).
  - **Not fixed, for you to weigh:** outside the daily chain (`pd paper-fill`, or a refresh without its checks), fills read the latest Health report on disk, which may be older than the prices being filled.
- **Not done:**
  - The Portfolio Manager's changes, and the final check of the whole Book, are issue 34's: until then the paper Book and its rules-only paper Book trade the same plans, so their gap is nothing.
  - New money for a paper Book comes only at a weighting, as in the Book backtest; money Saransh adds between weightings isn't modelled.
  - A strategy promoted into Paper after a paper Book has started gets money only at the next April's weighting, as the Book engine shares money out.
