# 42: Real Books' Order lists and order states

**What to build:** Each real Book gets its own Order list, scaled by Stage, for Saransh to place. Each order is valid only for its own session. It is tracked from proposed to filled or expired through his Answers and the brokers' tradebooks, so the Portfolio Manager never assumes what he did and an old order is never placed by mistake. See the stocks Pipeline PRD's "Orders and stops", "The Book state" and "Real Books, paper Books and orders".

**Repos:** ash_new, agents

**Blocked by:** 33: Paper Books trade their Order lists; 21: Answers in the Brief; 23: Broker inbox: ICICI Direct into the India real Book, with Reconciliation; 24: moomoo into the US real Book

**Status:** done, but for its first list on real data: no strategy is Real-small or Real-full yet, so no real Book has started (see "Not done")

**Waiting on Saransh:** nothing. On 31 October 2026 he confirmed that a sale's proceeds at ICICI Direct and moomoo pay for a buy at the same open, as the Order list assumes.

- [x] `pd plan` makes each real Book's Rule plan from its Book state, scaled by Stage. It then goes through the same Steps as a paper Book's.
- [x] Each real Book's Order list gives:
  - each buy and sale in whole shares, for the open: India's for the pre-open auction, the US's for that evening's open. A sale is a market order, and a buy a limit order at its limit price;
  - each buy that needs a sale's cash, listed under that sale, to be placed only once the sale is;
  - each Disaster stop to place or raise.
- [x] Each order is proposed until an Answer marks it placed or skipped. It stays placed until a tradebook shows it filled, partly filled or not filled. A fill matches an open order for the same security and side, on that order's session.
- [x] An order not filled on its session is expired, and so is the unfilled part of a partial fill. The next Rule plan starts from what was actually filled.
- [x] An Answer that comes after an order's session is recorded, but it never revives the order. Answers still never expire; an order's validity is its own.
- [x] The Book state reserves each placed buy's cash, at its limit, until a tradebook shows the fill. It doesn't count a placed sale's cash until then either. While a placed order has no tradebook, the Rule plan makes no other order for the same security.
- [x] A fill that matches no order is recorded as Saransh's own trade and flagged in the Brief.
- [x] A placed order with no tradebook by the next Run raises a To-do naming the file to drop.
- [x] Every Saturday's Brief lists the Disaster stops not yet marked placed.
- [x] The Brief opens with the Data gate's verdict, then the Order lists in the order Saransh places them (India first), then what's waiting on him.
- [x] Tests:
  - Stage scaling of a real Book's orders;
  - each order state, including a partial fill and an expired order;
  - a late Answer doesn't revive an expired order;
  - a placed buy reserves its cash, and a placed sale's cash isn't counted before its fill;
  - a buy that needs a sale's cash is listed under it;
  - a fill with no order;
  - the missing-tradebook To-do;
  - the Saturday list of unplaced stops.

**Notes:**

- **The real Book's Rule plan** (ash_new `pipeline.plan.real_plan`) replaces issue 47's shadow plan: each real Book's (India, the US, Hong Kong) has the Book's Sleeves from `pd stages`, each scaled by its Stage (Paper holds nothing, Real-small a quarter, Real-full all), plan kind `real`, `for_placing: true`, order ids `IN-<session>-001`. `shadow_strategy` is gone from config/books.yaml. It carries what the Portfolio Manager judges by (its real side's Judgement mode, subtract only at first), and its names go on the Desk's review list beside the paper Book's; the Desk reviews a name once per Book.
- **The Book state** (`pd book-state`) now gives a real Book's placed orders no tradebook has shown (`open_orders`), what their buys reserve at their limits (`reserved`), its Disaster stops with whether each is marked placed, and the Book engine's state its next plan runs on from (`engine`). A placed sale's money isn't in it: the ledger hasn't got the sale. The plan holds back the reserve (out of the order's Sleeve's cash first, `reserving`) and makes no order of a placed order's security (`not_traded: open_order`).
- **The next plan starts from what was filled** (`pipeline.real_books.engine_state`): the latest list's starting state, its session's fills at their tradebook prices and costs through the Book engine (its Disaster stops resting at the broker: set and raised, never sold there, `BookCourse.stops_at_broker`), on to the panels' last session; then each fill of an earlier list its state hadn't counted (`included`, by order row); then held to the ledger: no Sleeve holds more than the ledger, the ledger's rest is Legacy, the cash is the ledger's. Before a Book's first list there is none: its cash is shared out afresh.
- **`pd check`** records each real Book's final list (`OrderList.real_book`, migration 0022), each order proposed, each buy its cash can't pay for `under` the sale whose money covers it (`under_sales`: a sale's money pays for a buy at the same open, as the paper Books assume and Saransh confirmed), and its Disaster stops (`BookStop`; a raise supersedes the stop before, one at the same price stays). A real Book starts with its first plan outside Hold mode with a strategy at Real-small or Real-full: before that it would buy only gold. Recording a session again supersedes only the old list's proposed orders. Before recording, it expires each order still proposed once its session is over (`not_placed`).
- **Answers:** `order:<id>` takes placed or skipped (`pd orders mark <id> <answer> --saved-at <the file's savedAt>`), `stop:<id>` takes placed (`pd orders stop`). An Answer saved after the order's session closed (the market calendar's close) is recorded on the order, which stays expired; one saved in time but applied after the sweep still applies.
- **Fills** (`pd broker import`, `real_books.store.match_fills`, in the tradebook's own database transaction): each trade from the Book's first list's session fills the orders of the same security and side on its day (proposed, placed or expired unanswered: a fill on its session shows it was placed), a trade larger than one order filling each in turn; what matches no order is an own trade (`BookFill` without an order), logged and flagged in the Brief. A tradebook covers the sessions from its first trade's to the last over when it was downloaded (its file's time), so one downloaded during a session settles nothing of it: each order of a covered session is filled, partly filled (the rest expired, `not_filled`) or expired.
- **`pd orders show`** (contract/orders.schema.json): each real Book's orders still open and those of its last 5 lists, each with its state, fills, Answer and whether its session is over; its stops of what it holds or an open buy; its own trades since.
- **The Broker inbox Step** reads `pd orders show` after the files and raises one To-do per Book with placed orders whose sessions are over and no tradebook has shown, naming the file to drop. **The Check Step** reads it again into `orders.json`.
- **The Brief** opens with the Data gate (the Health Agent's diagnosis under it), then the Order lists, India first: what to place, sales at market with the buys that need their money under them, buys at their limits, India's for the pre-open auction and the US's for that evening's open, each with Placed and Skipped buttons; the stops to place or raise with a Placed button; orders waiting for a tradebook; what became of the last lists' orders; own trades, flagged. Every Saturday it lists the stops not marked placed. Then the To-dos and the items waiting on Saransh. The plans section shows each real Book's plan beside its state, for placing.
- **The Portfolio Manager** judges real plans too, each entry naming its plan by `plan_id`.
- **Tests:**
  - **ash_new:** `tests/test_real_books.py` (Stage scaling, a Book of Paper strategies recording no list, the list proposed with its stops, Answers placing and skipping, a placed buy reserving its cash and keeping the plan off its security, a late Answer, the sweep and an on-time Answer after it, a tradebook filling, partly filling and expiring with an own trade, a fill larger than its order, a tradebook downloaded during its session, the next plan running on from what filled, a stop marked placed, `under_sales`, the reserve); `test_plan.py` for the real plan.
  - **agents:** `test/broker-inbox.test.ts` (the missing-tradebook To-do, an own trade logged), `test/answers.test.ts` (order and stop Answers with their savedAt, a late one ignored), `test/stocks-brief.test.ts` (the Order lists, their buttons and items, the Saturday stops), and the Check, Plan, Portfolio Manager and Pipeline tests.
- **Code review** (Standards and Spec, in parallel). Fixed: a tradebook downloaded during a session settled it early, and one covering only later days settled earlier sessions (now it covers from its first trade's to the last session over); a fill larger than one order became an own trade whole (now it fills each in turn); `included` keyed by order id collided when a session's list was made again (now by row); an on-time Answer applied after the sweep was treated as late; "slippage" and "position" against the glossary; contradictory schema text; docstrings that didn't match; the Saturday check now uses `runWeekday`.
  - Left as judgement calls: some duplication (the ledger replay in three places, `_not_current_real` beside `_not_current`), the `kind == REAL`/`paper` branches, string kinds beside `PaperBookKind`, a buy no sale covers listed under the last sale.
- **Not done:**
  - No strategy is Real-small or Real-full yet, so no real Book has started on real data.
  - A tradebook covers only the sessions from its first trade: a session no file has a trade of keeps its placed orders placed, and its To-do, until one does.
  - Early exits are still the paper Book's only.
