# 38: US Feeds

**What to build:** US names get Feeds too: SEC EDGAR filings and Yahoo's earnings dates, in the same shape as India's. Their dossiers carry them. See the stocks Pipeline PRD's "Feeds and dossiers".

**Repos:** ash_new · **Mirrored in:** ash_new ticket 58 (keep both in step)

**Blocked by:** 37: India Feeds and the dossiers

**Waiting on Saransh:** the contact for the SEC's required User-Agent.

**Status:** done, but for EDGAR on the real endpoints: it waits on the contact for the SEC's User-Agent (see "Not done")

- [x] `pd feeds` fetches SEC EDGAR filings (8-K, 10-Q, 10-K, Form 4) for the US names.
  - It sends the User-Agent contact Saransh sets. The agents repo's env file passes it to `pd`, and it isn't filled in by default.
  - It stays within the SEC's fair-access rate.
- [x] It fetches Yahoo's earnings dates for the US names.
- [x] The events have the same shape and caching as India's, and the dossiers include them.
- [x] Without the User-Agent contact, EDGAR skips itself with a To-do.
- [x] Tests run on recorded responses, never the network: parsing, the cache, and the skip when the contact is missing.

**Notes:**

- **EDGAR** (ash_new's `pdash.feeds.us.Edgar`):
  - It reads a company's submissions (`data.sec.gov/submissions/CIK##########.json`), finding its CIK from the SEC's `company_tickers.json` by its Yahoo ticker (`BRK-B`). The tickers are kept a week in the feeds cache.
  - Each 8-K, 10-Q, 10-K and Form 4 (and their amendments) filed since the last fetch becomes an event. A filing is kind `filing`, a Form 4 kind `insider`. The title gives the form and an 8-K's items, and the link is the filing's primary document.
- **The User-Agent contact:** set `SEC_CONTACT` in the agents repo's `.env` (your name and email; `.env.example` has it, blank). `runPd` passes it to every `pd` as `PDASH_SEC_CONTACT`, and ash_new also reads that from its own `.env`. Without it, EDGAR skips itself for the US names (`status: skipped`, saying which setting), and the Feeds Step raises a To-do asking for it.
- **Fair access:** EDGAR is asked at most 8 times a second, under the SEC's 10.
- **Yahoo's earnings dates** come from yfinance's `Ticker.calendar`, read a second apart.
  - Each is a `results` event on its first day. A range Yahoo expects keeps its last day in `until`, and the analysts' EPS and revenue averages are in `detail`.
  - Yahoo gives only what is to come, so an earnings date it no longer gives has moved and is dropped from the cache.
- **The same shape and caching** as India's: the same event, cache, failing-source rule and dossier (issue 37's notes). A US name's dossier carries its filings and earnings date. Hong Kong has no Feeds.
- **Tests (ash_new `tests/test_feeds.py`):**
  - **Fixtures:** the SEC responses are written in the shapes the SEC documents. None was fetched, as that needs the contact. Yahoo's AAPL calendar was recorded on 30 October 2026.
  - **What they cover:** EDGAR's forms filed since a day, their titles, kinds and links; Yahoo's earnings date and a range; the contact sent as the User-Agent to the tickers and the submissions; the skip without it, even with every name fetched lately; the contact read from the environment; and the pacer's interval.
  - **agents:** the To-do, and the contact passed to `pd` (`test/feeds.test.ts`).
- **On real data, 30 October 2026:** Yahoo gave AAPL's 3 November earnings date, and EDGAR skipped itself, the contact not being set.
- **Not done:**
  - **EDGAR on the real endpoints:** never fetched, waiting on the contact (**for Saransh**: set `SEC_CONTACT`). Its parser follows the SEC's documented shape. Check the first Run's `feeds.json` after setting it.
