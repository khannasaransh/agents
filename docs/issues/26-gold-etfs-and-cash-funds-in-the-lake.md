# 26: Gold ETFs and cash funds in the Lake

**What to build:** The Lake has what the Books hold besides stocks: a gold ETF in each market, a liquid ETF as India's cash fund and a T-bill ETF as the US's. The daily chain refreshes them, and backtests can hold them. See the stocks Pipeline PRD's "The Book engine".

**Repos:** ash_new · **Mirrored in:** ash_new ticket 53 (keep both in step)

**Blocked by:** 15: Fix the stuck refresh and the dying process pool

**Status:** done, but for the real Lake's first refresh with them

**The Hong Kong Book holds the US Book's gold ETF and cash fund** (Saransh, 26 October 2026; issue 48), in dollars: nothing is chosen for Hong Kong. Its backtest values them in Hong Kong dollars at each day's rate (the peg keeps the rate within 7.75–7.85), and its cash fund earns the US's risk-free rate.

- [x] Each Book's gold ETF and cash fund are chosen for the longest clean price history, and the choices are recorded in ash_new's config.
- [ ] Their prices are in the Lake, and the daily chain refreshes them. The daily chain refreshes them; the real Lake has them once the next `pd daily` runs (see "The real Lake doesn't have them yet").
- [x] A backtest can hold them. In a backtest the cash fund earns the region's risk-free rate, since a liquid ETF's price doesn't show its return.
- [x] Tests: the instruments are refreshed with the rest, and a backtest holding the cash fund earns the risk-free rate.

**Notes:**

- **The choices**, in ash_new's `config/books.yaml`, each with why it was chosen. Each is the longest clean history on Yahoo, which the Lake's prices come from (checked 27 October 2026):

  | Book | Gold ETF | Cash fund |
  |---|---|---|
  | India | Kotak Gold ETF (`IN:GOLD1`), from April 2008 | Nippon India's Liquid BeES (`IN:LIQUIDBEES`), from January 2009 |
  | US | SPDR Gold Shares (`US:GLD`), from November 2004 | SPDR's 1-3 Month T-Bill ETF (`US:BIL`), from May 2007 |
  | Hong Kong | the US Book's, in dollars | the US Book's, in dollars |

  - **GOLDBEES lost to Kotak's GOLD1.** GOLDBEES has no opens until 2010 and closes at 0.34 for two days in December 2019. SETFGOLD falls a hundredfold for two days in January 2022.
  - **LIQUIDBEES is the only liquid ETF trading before 2018.** Yahoo has no volume for it on most days from 2012 to 2023, which issue 28's order-size guard will have to allow for.
  - **SHV starts four months before BIL**, but it holds Treasury notes and bonds as well as bills.
  - **The Indian two carry their ISINs**, from NSE's ETF list. ICICI Direct's holdings export finds a security by its ISIN, and NSE's equity list, which `pd enrich-securities` reads, has no ETFs.
- **In the Lake:** they are securities like the rest, marked `kind: etf` in the securities table, so the daily chain refreshes their prices with the rest.
  - `pd build-securities` adds them from the config. It marks one no Book holds any more as inactive, and keeps its prices.
  - The prices step fetches their whole histories the first time.
- **The panels leave them out**, so no strategy's universe holds them, and RS Ratings and every data version stay as they were.
  - **Checked on a copy of the Lake:** after the ETFs joined it, with their prices, the India, US and Hong Kong panels came to the same data versions as before. So no backtest goes stale.
  - The frozen panels are built the same way, so their pins hold too.
- **A backtest holds them on a Book's panels** (`pipeline.book_instruments.book_panels(settings, book)`): its market's panels with its gold ETF and cash fund as columns of their own. Issue 27's Book backtest starts from them.
  - The gold ETF is held on its own total-return index.
  - The cash fund's index grows at its own region's risk-free rate by the calendar, whatever its price does. On the copy of the Lake from 2016:
    - LIQUIDBEES: 7.0000% a year, where its price returns 0.0001%;
    - BIL: 4.0000%, where its price returns 0.03%.
- **The Hong Kong Book's** are the US Book's on each Hong Kong session.
  - Each session sees the last US bar dated before it, since the US's bars for a day close after Hong Kong's. It trades only on a session with a new bar.
  - They are valued at each day's rate. BIL's 4.0000% in dollars came to 4.11% a year in Hong Kong dollars from 2016, as the rate moved from 7.75 to 7.85.
  - A basket can't hold another region's security, so only the Book backtest will hold them.
- **The real Lake doesn't have them yet.** Its prices end on 23 October, and `pd status` fails on a proposed Correction of kind `bar`, which the corrections code doesn't know. So no refresh was run from here. The next `pd daily` adds them.
- **For Saransh: the risk-free rate is one figure for the whole history.** It is the settings' `risk_free` (India 7%, the US 4%). So BIL earns 4% a year through 2011–2016 and 2020–21, when T-bills paid close to nothing, and a Book's 2013–2016 holdout CAGR and Sharpe come out too high. A rate by date (each region's T-bill or overnight rate) would fix it. That is a decision for issue 27, not made here.
- **For issue 27: a Book's panels have a data version of their own.** It is the market's panels' version and the instruments' columns hashed together, so `book_panels(settings, book, data_version)` takes the market's version, not its own. A Book run that stores its version must keep the market's too, for `book_panels` and for the stale check.
- **A strategy's market leaves the ETFs out.** Its exchanges are those of the securities it can hold, so India's runs keep their ids, though the preset charges by exchange.
