# 47: One Book end to end, in shadow

**What to build:** Before the full Book engine and any judgement, one Book goes end to end. `pd book-state` writes the India Book's state from its reconciled real portfolio. `pd plan` makes a Rule plan from it with one Sleeve, CW2's selected variant, and the Stocks Brief shows the state and the plan side by side. Nothing is recorded as an order. This proves the state and the plan can be trusted before the Portfolio Manager gets either. See the stocks Pipeline PRD's "The Book state" and its build order.

**Repos:** ash_new, agents

**Blocked by:** 23: Broker inbox: ICICI Direct into the India real Book, with Reconciliation; 25: CW2's selected variant and the ash ports; 27: Book backtest: Sleeves, gold and the cash fund

**Status:** ready-for-agent

- [ ] `pd book-state` writes a Book's state as JSON, with a JSON Schema and an id:
  - its holdings and cash, replayed from its ledger;
  - Reconciliation's open differences;
  - its open orders and the cash they reserve (none until issue 42 records orders);
  - its Disaster stops;
  - which holdings are Legacy.

  The same ledger always gives the same state and the same id.
- [ ] A security with an open Reconciliation difference is marked unsettled. The plan neither buys nor sells it on a signal until the difference is settled, as for a Quarantine.
- [ ] `pd plan` makes a shadow Rule plan for the India Book from its state, with the Book engine of issue 27: CW2's selected variant as its one Sleeve at full share, gold and the cash fund. Legacy holdings are held, not sold (issue 43 sells them).
- [ ] The Rule plan names what it was made from: the Book state's id, the data version, the strategy's version and the Mandate's version.
- [ ] The Brief shows the India Book's state and the shadow Rule plan, with the signal behind each order. The Brief marks every order as not for placing.
- [ ] Made twice from the same state and data, the plan is the same.
- [ ] Tests:
  - **ash_new:** the state from a fixture ledger; an unsettled security isn't traded; the same inputs give the same state id and the same plan.
  - **agents:** the Brief shows the state and the shadow plan from a stand-in `pd`.
