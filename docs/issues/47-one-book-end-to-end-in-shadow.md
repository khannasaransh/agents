# 47: One Book end to end, in shadow

**What to build:** Before the full Book engine and any judgement, one Book goes end to end. `pd book-state` writes the India Book's state from its reconciled real portfolio. `pd plan` makes a Rule plan from it with one Sleeve, CW2's selected variant, and the Stocks Brief shows the state and the plan side by side. Nothing is recorded as an order. This proves the state and the plan can be trusted before the Portfolio Manager gets either. See the stocks Pipeline PRD's "The Book state" and its build order.

**Repos:** ash_new, agents

**Blocked by:** 23: Broker inbox: ICICI Direct into the India real Book, with Reconciliation; 25: CW2's selected variant and the ash ports; 27: Book backtest: Sleeves, gold and the cash fund

**Status:** done, but for a plan on the real Lake, which still has no prices for the Books' ETFs (see "On the real Lake")

- [x] `pd book-state` writes a Book's state as JSON, with a JSON Schema and an id:
  - its holdings and cash, replayed from its ledger;
  - Reconciliation's open differences;
  - its open orders and the cash they reserve (none until issue 42 records orders);
  - its Disaster stops;
  - which holdings are Legacy.

  The same ledger always gives the same state and the same id.
- [x] A security with an open Reconciliation difference is marked unsettled. The plan neither buys nor sells it on a signal until the difference is settled, as for a Quarantine.
- [x] `pd plan` makes a shadow Rule plan for the India Book from its state, with the Book engine of issue 27: CW2's selected variant as its one Sleeve at full share, gold and the cash fund. Legacy holdings are held, not sold (issue 43 sells them).
- [x] The Rule plan names what it was made from: the Book state's id, the data version, the strategy's version and the Mandate's version.
- [x] The Brief shows the India Book's state and the shadow Rule plan, with the signal behind each order. The Brief marks every order as not for placing.
- [x] Made twice from the same state and data, the plan is the same.
- [x] Tests:
  - **ash_new:** the state from a fixture ledger; an unsettled security isn't traded; the same inputs give the same state id and the same plan.
  - **agents:** the Brief shows the state and the shadow plan from a stand-in `pd`.

**Notes:**

- **The Book state** (`pdash.pipeline.book_state`, `pd book-state IN`, `contract/book-state.schema.json`):
  - **Holdings** are the real portfolio's ledger replayed with the data's dividends and splits, as `pd book-holdings` replays it. Every one is **Legacy** until issue 42 records the Rule plan's orders, so a holding can be a strategy's.
  - **Cash:** the brokers' files hold none, so the Book's cash is its capital (₹10 lakh, India's preset's, until Saransh sets it) less what its ledger's buys and fees cost, plus what its sales and dividends paid. An empty ledger is the capital in cash.
  - **Unsettled:** each open difference of the latest holdings export, with its kind and both quantities.
  - **Open orders, the cash they reserve, and Disaster stops** are empty lists and 0 until orders are recorded.
  - **The id** is 12 hex digits of the hash of the rest, its keys sorted. Nothing in the state records when it was written or the day's prices, so the same ledger gives the same id. A dividend or split the data learns of changes it, as it changes the holdings.
- **The engine resumes from a state.** `portfolios.book_engine` now ends each run where it got to (`BookState`: each Sleeve's cash, holdings, its strategy's weights and the orders waiting, the cash fund, the units, the breakers and the Disaster stops) and can run on from one (`simulate(state=...)`). A test writes a Book's state out as JSON on a close in February, reads it back and runs on through April's weighting: every trade, holding, stop and NAV is what the run straight through gave.
  - **Legacy holdings** sit beside the Sleeves: counted in the Book's value and its caps, never traded by the engine. A Book that starts with them shares out only its cash.
  - **A security the Book mustn't trade** (`BookCourse.frozen`: unsettled or Quarantined) is neither bought nor sold, by its strategy or by the Book's own orders. Its Disaster stop still sells it, as the order resting at the broker would. A strategy's sale of it waits and is asked again each session.
  - **Every cut is recorded** (`Cut`: its session, Sleeve, security, side, the shares wanted and allowed, and the rule), so the plan can say what cut each order.
- **The Rule plan's session** (`portfolios.rule_plan`): the next session's bars aren't known, so the panels get it as one more row (`with_next_session`): each security with a bar on the last session opens, trades and closes there at its last close, with no volume (the order-size guard reads only the sessions before). The engine trades it as any session. A Book that hasn't started starts on the last session, its cash shared at its Sleeves' weights, and its first buys are the plan; a started one resumes from its state.
  - **Parity:** a test runs two momentum strategies under the Mandate, takes the backtest's state on Friday 1 March 2024, and plans Monday from it on the data to Friday's close: every order is the backtest's Monday trade, share for share, where Monday opens at Friday's close. Only the cash fund's weekend interest, which isn't an order, is missing from the Sleeves' cash. That test is issue 32's parity test too.
  - **Disaster stops:** each new position's, at its distance under the last close (its price in the plan); and, when the last session ends its week, each held stop raised to its distance under that close, where that is higher.
- **`pd plan [--on DAY]`** (`pdash.pipeline.plan`, `contract/plan.schema.json`) prints `on` and each plan:
  - **The shadow plan** is the real Book's whose config names a `shadow_strategy` (`config/books.yaml`: `in-cw2-selected` for the India Book). One Sleeve, Real-full, beside gold and the cash fund.
  - **The strategy's track** is its live track's: the strategy run as its live index is (`pipeline.live.live_spec`), from its launch, on the market's panels with the next session, so its signals on the last close are its orders. `in-cw2-selected` isn't launched, so it is run from a year before the next session, as the Book backtest warms one up.
  - **It names** the state's id, the data version and the Book's panels' own, the strategy's id, name, version, Stage and Disaster stop, and the Mandate's version. Its own id is the hash of the rest, so the same state and data give the same plan and id; a test makes it twice and compares.
  - **Each order** has an id (`IN-2026-10-26-001`), its Sleeve, security, side, whole shares, the last close it was sized at, a buy's limit, its reason, its signal (the strategy holding it on the last close at a weight for a first buy; its track's trade, with its signal's day, score and rank where it has them, otherwise) and each cut, with its rule. Orders a rule cut to nothing are listed apart (`dropped`), and so are the Disaster stops to place or raise, the Legacy holdings held and the securities not traded.
  - **A Book it can't plan** (no price for its gold ETF or cash fund on the last session, a strategy it doesn't know, no money) gets `status: cant_plan` and why, rather than failing the command.
- **The Plan Step** (`steps/stocks/plan.ts`) runs after Health: `pd plan --on <the Run's day>`, then `pd book-state` for each Book with a plan, kept as `plan.json` and `book-states.json`. Both record nothing, so a dry run runs them as they are. The log says when a state's id isn't the one its plan was made from (the ledger changed between the two commands).
- **The Brief** shows each plan as "India Book in shadow: its Rule plan for …, not for placing", after the real Books: the state (its cash and where it comes from, its Legacy holdings, what is unsettled), what the plan was made from, the Sleeves' shares, each order with its signal and cut and "Not for placing" in its row, the orders stopped by a rule, the Disaster stops and the Legacy holdings. A plan ash_new couldn't make says why.
- **The stand-in `pd`** has `book-state.india.json`, `plan.shadow.json` (both from the fixture run, renamed to real securities) and `plan.cant-plan.json`.
- **On the real Lake, 29 October 2026:** `pd book-state IN` gives the India Book's state: no ledger recorded on this machine yet, so ₹10 lakh in cash (`08c1ddde44df`). `pd plan` says it can't plan: the Lake still has no price for `IN:GOLD1` (issue 27's "Not run on the real Lake"). On issue 30's copy of the Lake, which has the ETFs' prices, it plans 26 October: CW2's selected variant holds nothing (its market-trend filter sold everything on 12 October), so the plan is gold's 10%, 852 shares of `IN:GOLD1` at a limit of ₹120.45.
- **For Saransh:** the real Book's cash is its capital with its ledger's money, a stand-in until a cash balance is recorded. Set each Book's capital (`config/books.yaml`) to the money that is the Book's.
- **Not done:**
  - The real US and Hong Kong Books have no shadow plan: only the India Book names a `shadow_strategy`.
  - A limit price is the last close plus the tolerance to four decimals, not rounded to the market's tick.
