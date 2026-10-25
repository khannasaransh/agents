# 42: Real Books' Order lists and order states

**What to build:** Each real Book gets its own Order list, scaled by Stage, for Saransh to place. Each order is valid only for its own session. It is tracked from proposed to filled or expired through his Answers and the brokers' tradebooks, so the Portfolio Manager never assumes what he did and an old order is never placed by mistake. See the stocks Pipeline PRD's "Orders and stops", "The Book state" and "Real Books, paper Books and orders".

**Repos:** ash_new, agents

**Blocked by:** 33: Paper Books trade their Order lists; 21: Answers in the Brief; 23: Broker inbox: ICICI Direct into the India real Book, with Reconciliation; 24: moomoo into the US real Book

**Status:** ready-for-agent

**Waiting on Saransh:** whether ICICI Direct and moomoo let a sale's proceeds pay for a buy at the same open. Until then the Order list assumes they do, as the paper Books do.

- [ ] `pd plan` makes each real Book's Rule plan from its Book state, scaled by Stage. It then goes through the same Steps as a paper Book's.
- [ ] Each real Book's Order list gives:
  - each buy and sale in whole shares, for the open: India's for the pre-open auction, the US's for that evening's open. A sale is a market order, and a buy a limit order at its limit price;
  - each buy that needs a sale's cash, listed under that sale, to be placed only once the sale is;
  - each Disaster stop to place or raise.
- [ ] Each order is proposed until an Answer marks it placed or skipped. It stays placed until a tradebook shows it filled, partly filled or not filled. A fill matches an open order for the same security and side, on that order's session.
- [ ] An order not filled on its session is expired, and so is the unfilled part of a partial fill. The next Rule plan starts from what was actually filled.
- [ ] An Answer that comes after an order's session is recorded, but it never revives the order. Answers still never expire; an order's validity is its own.
- [ ] The Book state reserves each placed buy's cash, at its limit, until a tradebook shows the fill. It doesn't count a placed sale's cash until then either. While a placed order has no tradebook, the Rule plan makes no other order for the same security.
- [ ] A fill that matches no order is recorded as Saransh's own trade and flagged in the Brief.
- [ ] A placed order with no tradebook by the next Run raises a To-do naming the file to drop.
- [ ] Every Saturday's Brief lists the Disaster stops not yet marked placed.
- [ ] The Brief opens with the Data gate's verdict, then the Order lists in the order Saransh places them (India first), then what's waiting on him.
- [ ] Tests:
  - Stage scaling of a real Book's orders;
  - each order state, including a partial fill and an expired order;
  - a late Answer doesn't revive an expired order;
  - a placed buy reserves its cash, and a placed sale's cash isn't counted before its fill;
  - a buy that needs a sale's cash is listed under it;
  - a fill with no order;
  - the missing-tradebook To-do;
  - the Saturday list of unplaced stops.
