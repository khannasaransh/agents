# 44: Fill costs and the real-to-paper gap

**What to build:** The weekly review shows what Saransh's fills cost against the open price at each broker, and how far each real Book trails its paper Book. Real slippage then corrects the cost presets, and the cost of skips and Stages is visible. See the stocks Pipeline PRD's "Reviews".

**Repos:** ash_new, agents

**Blocked by:** 42: Real Books' Order lists and order states; 35: Weekly review, promotions and demotions

**Status:** done, but for a review on real data: no real Book has a fill yet

- [x] For each broker, the weekly review compares each fill with its session's open price, against the slippage the cost presets assume. It flags a broker whose fills cost more.
- [x] It shows each real Book's gap to its paper Book, split into fills, skips, expired orders and Stage scaling.
- [x] Tests:
  - the cost of a fill against the open;
  - the flag;
  - a gap split that adds up.

**Notes:**

- **Fill costs** (ash_new `pipeline.real_review.fill_costs`, `pd review`'s `fill_costs`): each fill of the week matched to an order, against its session's open on the Book's panels: a buy above the open and a sale below it cost, in basis points of its value. Beside each, the slippage its market's cost preset assumes for it (its bucket by its 20-session average traded value). Each broker's are weighted by value, and `costs_more` flags one whose fills cost more than assumed: its fill costs should then correct the presets (by hand: nothing changes config). Own trades aren't measured: they have no order's open to be held to.
- **The real-to-paper gap** (`real_gap`, per Book): the paper Book's return over the week (its value per unit, 100 before its first close) less the real Book's (its cash, ledger money and holdings at each close), split into, each as a part of the real Book's value at the week's start: `fills` (what its fills cost against their opens), `skips` (what each skipped order would have made from its session's open to the week's last close; a skipped sale's, what holding on lost), `expired` (the same for expired orders and the unfilled parts of partial fills) and `stages`, the rest. So the split always adds up, and `stages` holds whatever else the Books hold apart: chiefly the Stages, but also Legacy holdings, own trades and the paper side's Overrides.
- **The Brief's weekly review** shows the fill costs by broker, flagging one that costs more, and each Book's real Book against its paper Book with the split. The Portfolio Manager's instructions cover both, for its commentary.
- **Tests:** ash_new `tests/test_real_review.py` (a fill's cost against the open, the flag, a split that adds up) and `tests/test_real_books.py` (both measured on the fixture lake through a tradebook and a paper fill); agents `test/stocks-brief.test.ts`.
- **Not done:** the Stage-scaling part is the rest of the gap, not measured on its own; the real Book's return isn't adjusted for new money, which no real Book has yet.
