# 32: Rule plan for the paper Books

**What to build:** Every Run makes each paper Book's Rule plan in code, with the same engine as the Book backtest, and the Stocks Brief shows it. Live then trades what was tested. See the stocks Pipeline PRD's Plan Step and "The Book engine".

**Repos:** ash_new, agents

**Blocked by:** 31: Stages, promotions and launching; 20: Corrections and Quarantine; 46: Market condition and the exposure level; 47: One Book end to end, in shadow

**Status:** done, but for a plan on the real Lake, which still has no prices for the Books' ETFs (see issue 47's "On the real Lake")

- [x] `pd plan` makes each paper Book's Rule plan as of each market's last session. It applies the Data gate and Quarantines, then runs the Book engine's next session from the paper Book's state (all cash at first), as issue 47 does for the India Book. That session includes:
  - the strategies' live-track orders at their Sleeves' weights;
  - the caps, the breakers, the exposure level and the Stages;
  - the order-size guard, in whole shares, and each buy's limit price;
  - Disaster stops for new positions, and on Saturdays the raises.
- [x] Each Rule plan names what it was made from: the Book state, the data version, each strategy's version, and the Mandate's and Playbook's versions.
- [x] When the Data gate fails, the plan is in Hold mode: no buys, and exits only through Disaster stops.
- [x] A Book whose market was shut the session before gets no orders.
- [x] Each order carries:
  - an id;
  - its Book, security, side and shares;
  - for a buy, its limit price;
  - the strategy and signal behind it;
  - any cut, with its reason.
- [x] Parity: started from the backtest's own holdings, the Rule plan equals the Book backtest's next session.
- [x] The Plan Step records the Rule plans, and the Brief shows each paper Book's Rule plan.
- [x] The Rule plan's JSON has a JSON Schema, and the stand-in `pd` has examples of it.
- [x] Tests:
  - the parity test;
  - Hold mode;
  - a Quarantined name isn't traded;
  - a market holiday gives no orders.

**Notes:**

- **The paper Books' plans** (`pdash.pipeline.plan.paper_plan`): `pd plan` makes one for each Book (India, the US and Hong Kong) after the India Book's shadow plan, each with the Book engine's next session (issue 47's `portfolios.rule_plan`) on its market's panels with the next session added.
  - **Its state** (`pd book-state <book> --paper`, `book_state.paper_book_state`) is its capital in cash (₹10 lakh, $100,000, HK$10 lakh until set) with an id, until issue 33 records the orders it fills. So until then every Run's paper plan is the Book's first session: its capital shared at its Sleeves' weights, its first buys the plan.
  - **Its Sleeves** are the Book's from `pd stages` (issue 31): each strategy at Paper, Real-small, Real-full or Retired, at its full share (the engine's paper Book). A Retired one winds down (`Track.retired_on` is the day it was Retired). A Candidate isn't in the Book. A Sleeve whose version is no longer its strategy's is left out, with why (`left_out`): ash_new keeps only each strategy's current version, so an old one can't be run (issue 31's "one live track per strategy").
  - **Each strategy's track** is its live track's, from its launch, as in issue 47.
  - **What it was made from:** the state's id, the data versions, each strategy's id, version and Stage, and the Mandate's and Playbook's versions.
- **The Playbook** is now in each Book's config (`config/books.yaml`, `core.books.Playbook`), with the PRD's placeholders: exposure floors of 80%, 50% and 0%, sizes 0.5× to 1×, waits up to 5 sessions, and drift under 2% skipped. Its `version` is hashed from its numbers, as the Mandate's is. Nothing uses its ranges yet: issue 34's final check will.
- **Hold mode:** `pd plan` reads the Data gate (`status.data_gate`: the gate alone, as `pd status` gives it) and prints it, with `mode` (`normal` or `hold`). On a day it fails every plan, the shadow one too, is in Hold mode: the engine places no order (`BookCourse.hold`), each order the session would have made is listed as stopped by `hold`, and only Disaster stops sell. A test plans a Hold day where a strategy drops one holding and another opens under its stop: only the stop sells. Raises of held stops on a Saturday are still listed.
- **A market shut the session before:** a Book whose market had no session on the day before the Run's day (`--on`; the Pipeline passes the Run's) has no plan that Run (`status: market_shut`, with the day). A Tuesday Run after a Monday holiday makes no orders; Saturday's Run plans Friday's close.
- **Quarantines** stop a security in every plan, as in issue 47.
- **Each order** now carries its Book (`book`) beside its id (`IN-paper-2026-10-26-001` in a paper Book), Sleeve (its strategy, or gold), security, side, whole shares, the last close it was sized at, a buy's limit, its reason and signal, and each cut with its rule.
- **Parity** (`tests/test_rule_plan.py`): issue 47's test now runs under an exposure level that drops on the compared Monday, so that session's trims and the buys it cut are compared too: started from the backtest's state on Friday 1 March 2024, the plan's Monday is the backtest's, share for share.
- **A buy cut to under a whole share** (the exposure level's room, say) places nothing, so the plan lists it as dropped with the first rule that cut it. Before the code review it was cut to a fraction and fell out of the plan unseen. The test's cash fund earns nothing: the plan can't know the weekend's interest, which would widen the backtest's room under the exposure level by a share or two.
- **The contract:** `contract/plan.schema.json` adds the gate and mode, `kind: paper`, `status: market_shut`, each plan's `mode`, `playbook_version` and `left_out`, and each order's `book`; `contract/book-state.schema.json` adds `paper`.
- **The Plan Step** reads `pd book-state` for each plan's Book, with `--paper` for a paper Book's, and logs Hold mode, each plan, and each Sleeve left out.
- **The Brief:** on a day the gate fails, a Hold mode panel with its reasons comes first. Each paper Book's plan follows the shadow plan: what a paper Book is, its state (all cash until issue 33), what it was made from (the Playbook's version among it), the Sleeves left out, its exposure level, its orders with their signals and cuts, the orders stopped by a rule, and the Disaster stops. A plan in Hold mode says so, and a Book whose market was shut says it has no order.
- **The stand-in `pd`:** `plan.normal.json`, `plan.hold.json`, `plan.shut.json`, `plan.cant-plan.json`, `book-state.india.json` and `book-state.paper.json`, from the fixture run renamed to real securities. `plan.shadow.json` is gone into `plan.normal.json`.
- **On issue 30's copy of the Lake, 27 October 2026:** the Data gate fails (no Health report, and the copy three sessions behind), so every plan is in Hold mode. The India paper Book holds only gold: no strategy is in Paper on this machine yet (`in-super30-ok-tuned` is a Candidate waiting for your approval). Hong Kong has no panels in the copy, so its paper Book can't plan.
- **Found on the way:** `pd status` fails on the real app database, on the Correction of kind `bar` proposed in issue 26 (`CorrectionChange` doesn't accept `bar`), so the Pipeline's Lake Step can't read the Lake's status there. `pd plan` reads the gate without the Corrections, so it isn't affected. This needs fixing in ash_new's Corrections, apart from this issue.
- **Not done:**
  - Recording the paper plans' orders and filling them is issue 33's: until then each paper plan starts from all cash.
  - A Retired Sleeve whose version isn't its strategy's current one is left out rather than wound down: with all cash, it holds nothing to wind down; once paper Books hold stocks (issue 33), it needs a track per version.
  - The real Books' Rule plans from their own Stages (a Paper strategy holding nothing, a Real-small one a quarter) wait for issue 42; the India Book's real plan is still issue 47's shadow plan.
