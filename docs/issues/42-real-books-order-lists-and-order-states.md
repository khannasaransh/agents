# 42: Real Books' Order lists and order states

**What to build:** Each real Book gets its own Order list, scaled by Stage, for Saransh to place. Each order is tracked from proposed to filled through his Answers and the brokers' tradebooks, so the Portfolio Manager never assumes what he did. See the stocks Pipeline PRD's "Orders and stops" and "Real Books, paper Books and orders".

**Repos:** ash_new, agents

**Blocked by:** 33: Paper Books trade their Order lists; 21: Answers in the Brief; 23: Broker inbox: ICICI Direct into the India real Book, with Reconciliation; 24: moomoo into the US real Book

**Status:** ready-for-agent

- [ ] `pd plan` makes each real Book's Rule plan from its real holdings and cash, scaled by Stage. It then goes through the same Steps as a paper Book's.
- [ ] Each real Book's Order list gives:
  - each buy and sale in whole shares, as market orders: India's for the pre-open auction, the US's for that evening's open;
  - each Disaster stop to place or raise.
- [ ] Each order is proposed until an Answer marks it placed or skipped, and placed until a tradebook shows it filled or partly filled. A fill matches an open order for the same security and side, on that order's session.
- [ ] A fill that matches no order is recorded as Saransh's own trade and flagged in the Brief.
- [ ] A placed order with no tradebook by the next Run raises a To-do naming the file to drop.
- [ ] Every Saturday's Brief lists the Disaster stops not yet marked placed.
- [ ] The Brief opens with the Data gate's verdict, then the Order lists in the order Saransh places them (India first), then what's waiting on him.
- [ ] Tests:
  - Stage scaling of a real Book's orders;
  - each order state, including a partial fill;
  - a fill with no order;
  - the missing-tradebook To-do;
  - the Saturday list of unplaced stops.
