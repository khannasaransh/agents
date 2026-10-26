# 24: moomoo into the US real Book

**What to build:** moomoo's trade history and positions exports are recorded in the US Book's real portfolio and reconciled, just as ICICI Direct's are for India. See the stocks Pipeline PRD's "Real Books, paper Books and orders".

**Repos:** ash_new · **Mirrored in:** ash_new ticket 51 (keep both in step)

**Blocked by:** 23: Broker inbox: ICICI Direct into the India real Book, with Reconciliation

**Waiting on Saransh:** nothing. His samples are in `docs/data/moomoo/`, which is git-ignored (the `data/` pattern), so they never leave the machine.

**Status:** done

- [x] The US Book has a real portfolio in ash_new for moomoo, in USD.
- [x] Import presets read moomoo's trade history and positions exports, built from Saransh's samples.
- [x] `pd` recognises moomoo's files, so the Broker inbox Step hands them in unchanged.
- [x] Reconciliation works for the US Book as it does for India.
- [x] Tests: the sample files become the right ledger and positions, and Reconciliation finds the differences planted in them.

**Notes:**

- **Saransh's samples** are `History Transactions-Margin Account(<n>)-<from>-<to>.csv`, the trade history, and `Positions-Margin Account(<n>)-<date>-<time>.csv`, the positions. Both have a byte-order mark and every cell quoted, and both cover the whole margin account: its US, Hong Kong and Singapore markets.
  - **The trade history:** every fill since the account opened (96 in the sample, all buys, from 19 December 2023), by symbol, with no ISIN. It lists its newest fills first, across markets. Its `Fill Time` is `Sep 21, 2026 12:00:46 ET`, in the fill's own market's time (ET, HKT, SGT), and its `Markets` says which: `US`, `HK` or `SG`.
  - **The positions:** each holding by symbol, with its shares in `Quantity` (fractional ones too: 6.24 of Apple), its `Average Cost` and its `Currency` (USD, HKD, SGD). It has no market column and no date.
  - **The PRD's "Broker charges in exports":** answered for moomoo. The trade history has no charges: its `Fill Amount` is the shares times the price. So the reviews can't check the $0 brokerage from it.
- **Only the US Book's rows are recorded.** The PRD leaves Hong Kong out of the Books, and ash_new has no Singapore. So moomoo's Hong Kong and Singapore fills and holdings are set aside, in the import wizard too. (Since issue 48, the Hong Kong rows are the Hong Kong Book's: each file is read for both Books.)
- **A fill of a security ash_new hasn't got is set aside, not refused.** This differs from ICICI Direct, where such a row makes the tradebook unreadable. moomoo's history is every fill since the account opened, so one stranger would keep every later download out too. The sample has one: iShares Latin America 40 ETF (ILF), 22 fills and 235 shares, the US Book's largest holding. Reconciliation names it as `unknown_security` while it is held, and the trade history's line counts its fills only among the rows set aside, with no To-do of their own. Once the Lake has it, the next download records them: each download is a new file, since it runs to its own day.
- **A position holds a trade from its day.** moomoo's positions aren't settled demat holdings, so Reconciliation doesn't wait for T+1 as it does for ICICI Direct.
- **In ash_new:**
  - **The presets** are `moomoo_trades` and `moomoo_positions` in `portfolios/imports.py`, so the import wizard offers them too.
    - A mapping marked `region_only`, with a region and an exchange column, reads only that region's rows and sets aside the others' ("Of another market than US: HK"). Only moomoo's presets are marked: a saved mapping with a region and an exchange column still reads every row in its region, as before. The API's schema and the web app's types are regenerated for the new field.
    - The exchange column can hold an exchange's code, a region's or a currency's (`core.regions.market_codes`), so the positions' `Currency` column says each holding's market.
    - A date is also read from the part before its time of day (`Sep 21, 2026`), and a day's fills are put in order by their clock time even with a zone after it.
  - **The US Book's real portfolio** is "US Book (moomoo)", in dollars, marked `book = US`. `brokers/books.py` declares its rules beside the India Book's: `settled_holdings` (whether a trade counts only once it settles) and `whole_tradebooks` (whether a stranger refuses the file).
  - **Reconciliation** finds each holding by its ISIN, else its symbol, in the Book's market, and is dated in the Book's market's time zone. So positions downloaded on a Saturday morning in Singapore are as of Friday in New York.
  - **The contract** (`broker-import` and `book-holdings`) adds `moomoo` and `US`, and gives each difference a `symbol` beside its `isin`: moomoo's positions name a holding by symbol.
  - `tests/test_brokers.py` and `tests/test_imports.py` use made-up files in moomoo's exact layouts. Those files have Hong Kong and Singapore rows, an ETF the data hasn't got, a same-day buy and sale, a fractional reward and a split the data hasn't got.
- **In this repo:** `src/brokers.ts` names moomoo's files as moomoo does ("moomoo's trade history", "moomoo's positions", "Drop the trade history with its buys…"), and names a security the data hasn't got by its symbol ("iShares Latin America 40 ETF (symbol ILF)"). The Brief shows the US Book after the India Book, in dollars.
- **Run on Saransh's samples** (a dry run, then a run into a copy of the app database):
  - The trade history's 81 US fills: 59 recorded. ILF's 22 and the 15 Hong Kong and Singapore fills were set aside.
  - The positions as of 25 October 2026: 34 of the 40 US holdings matched. The 6 differences are ILF, and five fractional holdings no fill has:
    - Apple 6.24 against 6, Tesla 5.16 against 5, and Sea 8.8 against 8;
    - NIO's 4.8 and NVIDIA's 0.8, which have no fill at all.

    These look like moomoo's share rewards, which the trade history doesn't list. If so, they stay To-dos until issue 43's Legacy holdings, or until a way to record them is chosen.
- **Not done here:**
  - ILF in the Lake. The securities table is built from the exchanges' lists, which have no ETFs; issue 26 adds the Books' gold ETFs and cash funds only.
  - the Hong Kong ETF and Singapore gold the account holds, which no Book manages;
  - matching fills to orders (issue 42), and Legacy holdings on the first import (issue 43).
