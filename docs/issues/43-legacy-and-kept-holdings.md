# 43: Legacy and Kept holdings

**What to build:** What Saransh already holds comes into the Books. Anything he marks kept stays outside them, and the rest is wound down as the Sleeves need the cash, at as little tax as possible. See the stocks Pipeline PRD's "Legacy and kept holdings" and "The Book engine".

**Repos:** ash_new, agents

**Blocked by:** 42: Real Books' Order lists and order states

**Status:** done, but for real data: no real Book has had its first import yet

- [x] On a real Book's first import, every holding no strategy bought becomes a Legacy holding. The Brief asks whether to keep each one.
- [x] A keep Answer makes it a Kept holding. A Kept holding is outside the Book and never sold, but it counts toward the 15% position cap when a strategy buys the same stock.
- [x] Legacy holdings are sold to pay for the Sleeves' buys: losses first, then gains. A winner within two months of turning long-term (12 months in India, 24 in the US) is held until it has.
- [x] Tests:
  - the first import marks Legacy holdings;
  - a Kept holding is never sold, and is counted toward the cap;
  - Legacy holdings are sold in the right order;
  - a winner near long-term waits.

**Notes:**

- **First import** (ash_new `pdash.real_books.legacy`, `LegacyHolding`, migration 0023): each tradebook `pd broker import` records in a Book that has had no Order list yet records every security its ledger then holds as a Legacy holding, once (`legacy` in its result). `pd book-state` marks what the ledger holds beyond the Sleeves Legacy, each with its lots (the oldest, the Sleeves' coming later), its record's id (`legacy_id`) and Saransh's Answer (`answer`).
- **Keep or sell:** the Brief lists each Legacy holding not yet answered, with Keep and Sell (`legacy:<id>`, `pd legacy keep|sell <id>`). Kept, it is a Kept holding: outside its Book (not its value, its stocks or its cash: what its shares cost, at the ledger's average cost, is put back into the cash), never sold. Sell, or no Answer, leaves it Legacy; Sell only stops the Brief asking.
- **Wound down** (ash_new `book_engine.WindDown`, a real Book's, by its region's `long_term_months` in config/regions.yaml: 12 in India, 24 in the US and Hong Kong): the first session shares the Legacy holdings' value out with the cash, so the Sleeves are given money they still hold, and an April's weighting counts it too. At each open the Legacy holdings it may sell are ordered losses first (the largest), then gains (the smallest share of the price); a winner with shares turning long-term within two months waits until they have (`waits_until` in the plan). Each buy is paid by the cash first, as far as a strategy's buy stays under the exposure level, then by what of them isn't spoken for, and cut to what both pay for (`legacy_held`); the part they pay for moves no money into stocks, so the exposure level holds. So a Legacy holding is sold only once the cash runs out, or the exposure level would be passed. After the session's orders, what the buys took of them is sold in that order, whole shares or board lots: orders under the Sleeve `legacy`, role `legacy`, which the final check never drops and the fills replay.
- **Kept and the caps:** the Book engine counts each Kept holding toward the position and sector caps of a strategy's buy (`BookCourse.kept`), and so does the final check (the plan's `kept`, `breaches`).
- **Tests:**
  - **ash_new:** `tests/test_book_engine.py` (sold for the Sleeves' buys, losses first then the smallest gains; a winner near long-term waiting and the buys cut to what the rest pays for; a Kept holding never sold and counted toward the position cap), `tests/test_real_books.py` (the first import marking Legacy holdings, which the plan sells for the Sleeves' buys, and none recorded once the Book has a list; a Kept holding outside the Book and never sold, answered once), `tests/test_plan.py`.
  - **agents:** `test/stocks-brief.test.ts` (the Brief's Keep and Sell items, and the Answers Step applying one through `pd legacy`), and the stand-in `pd`'s examples against ash_new's changed schemas.
- **Not done:**
  - Only a Legacy holding can be marked kept, not any holding (PRD story 100 asks for any).
  - A Kept holding's later dividends still count in the Book's cash.
  - Holdings bought before the first tradebook's period aren't in the ledger, so they aren't Legacy: they show only as Reconciliation differences.
- **For Saransh to confirm:** a Kept holding's cost is put back into the Book's cash, reading the Book's capital as the money for the Book alone. If the capital is instead everything in the account, kept holdings included, the Kept holding should come out of the capital instead, and the plan's cash would be less by its cost.
