# 32: Rule plan for the paper Books

**What to build:** Every Run makes each paper Book's Rule plan in code, with the same engine as the Book backtest, and the Stocks Brief shows it. Live then trades what was tested. See the stocks Pipeline PRD's Plan Step and "The Book engine".

**Repos:** ash_new, agents

**Blocked by:** 31: Stages, promotions and launching; 20: Corrections and Quarantine

**Status:** ready-for-agent

- [ ] `pd plan` makes each paper Book's Rule plan as of each market's last session. It applies the Data gate and Quarantines, then runs the Book engine's next session from the paper Book's holdings and cash (all cash at first). That session includes:
  - the strategies' live-track orders at their Sleeves' weights;
  - the caps, the breakers and the Stages;
  - the order-size guard, in whole shares;
  - Disaster stops for new positions, and on Saturdays the raises.
- [ ] When the Data gate fails, the plan is in Hold mode: no buys, and exits only through Disaster stops.
- [ ] A Book whose market was shut the session before gets no orders.
- [ ] Each order carries:
  - an id;
  - its Book, security, side and shares;
  - the strategy and signal behind it;
  - any cut, with its reason.
- [ ] Parity: started from the backtest's own holdings, the Rule plan equals the Book backtest's next session.
- [ ] The Plan Step records the Rule plans, and the Brief shows each paper Book's Rule plan.
- [ ] The Rule plan's JSON has a JSON Schema, and the stand-in `pd` has examples of it.
- [ ] Tests:
  - the parity test;
  - Hold mode;
  - a Quarantined name isn't traded;
  - a market holiday gives no orders.
