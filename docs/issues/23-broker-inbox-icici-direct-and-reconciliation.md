# 23: Broker inbox: ICICI Direct into the India real Book, with Reconciliation

**What to build:** Saransh drops ICICI Direct's tradebook and holdings export in the Broker inbox. The next Run records them in the India Book's real portfolio and reconciles the holdings, and the Brief shows what he holds and any differences. This puts the riskiest plumbing, imports without an API, in use from the first phase. See the stocks Pipeline PRD's Broker inbox Step and "Real Books, paper Books and orders".

**Repos:** ash_new, agents

**Blocked by:** 17: Stocks Pipeline skeleton: the Lake Step and a data-status Stocks Brief

**Waiting on Saransh:** nothing. His samples are in `docs/data/icici/`, which is git-ignored (the `data/` pattern), so they never leave the machine.

**Status:** done

- [x] The India Book has a real portfolio in ash_new for ICICI Direct.
- [x] Import presets read ICICI Direct's tradebook and holdings export. They are built from Saransh's samples.
- [x] `pd` identifies each file's broker and kind, so the Pipeline hands it every file without knowing the formats.
- [x] A Broker inbox Step records each tradebook in the India Book's real portfolio once: a file it has seen before isn't recorded again.
  - Processed files move out of the inbox.
  - A file it can't read is set aside, with a To-do.
- [x] Given a holdings export, Reconciliation compares the real portfolio's positions with it, security by security. Each difference becomes a To-do.
- [x] The Brief shows the India Book's holdings and value, and Reconciliation's differences.
- [x] A dry run records nothing.
- [x] Tests:
  - **ash_new:** the sample files become the right ledger and positions; Reconciliation finds a missing fill and a quantity off by a split.
  - **agents:** each file is handed to `pd`, unreadable files are set aside, and the To-dos are raised.

**Notes:**

- **Saransh's samples** are `orderBook_Equity_<n>.csv`, the tradebook, and `<account>_Demat.csv`, the holdings export.
  - **The tradebook:** each trade by NSE symbol, with no ISIN. Its date is `14-Aug-26`, and it lists its newest trades first, a day's too. Its `Brokerage Incl. Taxes` is every charge on the trade: STT, exchange and SEBI charges, stamp duty, brokerage and GST.
  - **The holdings export:** each holding by ISIN, with the shares in `Allocated Quantity`. Its `Stock` column is ICICI Direct's own code (ASIPAI for Asian Paints), not NSE's symbol. It has no cost and no date.
  - **The PRD's "Broker charges in exports":** answered for ICICI Direct. The tradebook has every charge, and its brokerage isn't ₹0: about 0.24% of each trade in the sample. The cost presets still say ₹0 (the PRD's Costs).
- **In ash_new:**
  - **The presets** are `icici_direct_tradebook` and `icici_direct_holdings` in `portfolios/imports.py`, so the import wizard offers them too. The tradebook's fees are `Brokerage Incl. Taxes`.
  - **The India Book's real portfolio** is "India Book (ICICI Direct)", in rupees, marked `book = IN` (migration 0014). It is made the first time an ICICI Direct file is recorded, in the same database transaction, so an unreadable file leaves the Book without one. `brokers/books.py` declares each Book's broker and presets, which the US Book's moomoo (issue 24) joins.
  - **`pd broker import FILE...`** (`brokers/files.py`) is handed every file and knows each by its columns, using the import wizard's `detect`, `parse` and `prepare`. Its JSON is against `contract/broker-import.schema.json`.
    - It records the tradebooks first, oldest first trade first. A day's trades are put back in the order traded, since the file lists them newest first.
    - A tradebook whose content was recorded before (by SHA-256, in `broker_imports`) is `seen`, and nothing is recorded again. A trade the ledger has already, as in an overlapping tradebook, is left out, as the wizard leaves it out.
    - A tradebook is recorded whole or not at all. A row of a symbol the securities table hasn't got, a row it can't read, or a sale the ledger can't take makes the file `unreadable`, with the line and why. The trades and the file's record are written in one database transaction.
    - Then it reconciles each holdings export (`brokers/reconciliation.py`):
      - as of the day it was downloaded: its file's time, in India's time zone, since the export doesn't say;
      - counting each trade once it settles, on the weekday after its day (T+1). Holidays aren't counted, so a trade the day before a holiday shows as a difference for a week.
    - It exits 0 whenever every file was handled, unreadable ones among them. `--dry-run` records nothing and makes no portfolio. It reconciles against the ledger as it is, without the tradebooks it would record.
  - **Reconciliation's differences:**
    - `quantity`: both hold the security, in different numbers. When the broker's shares are a split's or bonus's of the ledger's, it names the ratio ("2 for 1", "3 for 2", "1 for 10").
    - `not_in_ledger` and `not_at_broker`: only one side holds it.
    - `unknown_security`: an ISIN the securities table hasn't got.

    Each reconciliation is kept in `broker_imports`. The latest day's is the Book's open differences, so an older export dropped in later reopens nothing. Issue 42's Book state will read them.
  - **`pd book-holdings`** gives each Book's real portfolio, valued as the Portfolios page values a real one, with its latest Reconciliation. Its JSON is against `contract/book-holdings.schema.json`.
  - `tests/test_brokers.py` uses made-up files in ICICI Direct's exact layouts: the byte-order mark, the CRLF lines and the trailing comma. The real samples hold Saransh's holdings, so they stay out of the repo.
- **The Broker inbox Step** (`steps/stocks/broker-inbox.ts`) runs between Answers and MarketSmith.
  - It hands every file at the inbox's top level to `pd broker import`, in name order. It leaves out Answers files (the Answers Step's), downloads still under way (`.crdownload`, `.part`, `.tmp`) and hidden files.
  - A file recorded, seen or reconciled moves into the Run's `broker-inbox/` folder. One `pd` couldn't read moves to the inbox's `set-aside/` folder, with a To-do giving why.
  - Then it reads `pd book-holdings` and records both answers as `broker-inbox.json`. It raises a To-do for each difference in each Book's latest Reconciliation, so a difference stays a To-do in every Run until a later holdings export settles it.
  - A `pd` failure fails the Step and leaves every file in the inbox. Every `pd broker import` is safe to repeat, since a tradebook recorded once is seen.
  - A dry run passes `--dry-run` and moves nothing.
- **The Stocks Brief** has a section per Book after the To-dos (`src/brokers.ts` words the files and the differences for the Step and the Brief):
  - its value at the broker, with its cash;
  - its holdings: shares, average cost, close and value;
  - its latest Reconciliation's differences, each in a sentence saying what to drop;
  - this Run's Broker inbox files.

  Before the first file it says where to drop one. When the Step failed before recording anything, it says the holdings couldn't be read.
- **Run on Saransh's samples** (a dry run, then a run into a copy of the app database): all 22 trades and all 54 holdings resolved to securities. 19 holdings matched, Angel One's and Lal PathLabs' through the Lake's split and bonus. The other 35 are `not_in_ledger`: holdings bought before the tradebook's first trade (31 October 2025).
  - So the first real Run raises 35 To-dos, unless Saransh drops tradebooks going back to when he bought them.
  - Issue 43 makes them Legacy holdings on a Book's first import. Until then they stay differences.
- **Not done here:**
  - matching fills to orders, and a To-do for a placed order with no tradebook (issue 42);
  - Legacy holdings on the first import (issue 43);
  - moomoo (issue 24).
