# 32: Rule plan for the paper Books

**What to build:** Every Run makes each paper Book's Rule plan in code, with the same engine as the Book backtest, and the Stocks Brief shows it. Live then trades what was tested. See the stocks Pipeline PRD's Plan Step and "The Book engine".

**Repos:** ash_new, agents

**Blocked by:** 31: Stages, promotions and launching; 20: Corrections and Quarantine; 46: Market condition and the exposure level; 47: One Book end to end, in shadow

**Status:** ready-for-agent

- [ ] `pd plan` makes each paper Book's Rule plan as of each market's last session. It applies the Data gate and Quarantines, then runs the Book engine's next session from the paper Book's state (all cash at first), as issue 47 does for the India Book. That session includes:
  - the strategies' live-track orders at their Sleeves' weights;
  - the caps, the breakers, the exposure level and the Stages;
  - the order-size guard, in whole shares, and each buy's limit price;
  - Disaster stops for new positions, and on Saturdays the raises.
- [ ] Each Rule plan names what it was made from: the Book state, the data version, each strategy's version, and the Mandate's and Playbook's versions.
- [ ] When the Data gate fails, the plan is in Hold mode: no buys, and exits only through Disaster stops.
- [ ] A Book whose market was shut the session before gets no orders.
- [ ] Each order carries:
  - an id;
  - its Book, security, side and shares;
  - for a buy, its limit price;
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
