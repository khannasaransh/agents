# 22: MarketSmith on Saturdays

**What to build:** MarketSmith's fetch moves from ash_backend into ash_new, and each Saturday's Run uses it before the Lake refresh, so fundamentals are never more than a week old. Each fetch is kept as a dated snapshot, so a Decision record that cites a rating can be checked later. An expired cookie costs a To-do, never a failed Run. ash_backend's Portfolio Manager and Sash's `PM_BUY` alerts are turned off. See the stocks Pipeline PRD's MarketSmith Step and "ash_backend".

**Repos:** ash_new, ash_backend, agents · **Mirror:** none: like issues 17, 20 and 21, it lives only here

**Blocked by:** 17: Stocks Pipeline skeleton: the Lake Step and a data-status Stocks Brief

**Status:** done, but for the dossier, which is issue 37's, and two steps of Saransh's: the cookies' move and ash_backend's deploy (see Notes)

- [x] `pd marketsmith` fetches MarketSmith's India and US data, as ash_backend's `fetch` job kind does, and writes the raw store that ash_new already reads. It exits 78 when MarketSmith rejects a cookie.
- [ ] Each fetch is also kept as a dated snapshot of the ratings, flags and estimates, and a dossier names the snapshot its figures came from. This takes up what ash_new's parked ticket 49 deferred.
- [ ] MarketSmith's cookies move to ash_new's env file. Only `pd marketsmith` reads them.
- [x] A MarketSmith Step runs before the Lake Step on Saturdays, and skips itself on other days.
- [x] An expired cookie skips the Step and gives a To-do naming the cookie.
- [x] The Saturday refresh builds fundamentals from the new fetch.
- [ ] ash_backend's Portfolio Manager agent and Sash's `PM_BUY` alerts are turned off. ash_backend's own timer keeps running for the Sash app until Saransh decides on the app; then ash_backend is archived.
- [x] Tests:
  - **ash_new:** a fetch parsed from recorded responses, never the network, writes the raw store and a dated snapshot; a rejected cookie exits 78.
  - **agents:** the Step skips itself on a weekday; a stand-in `pd marketsmith` that exits 78 becomes a skip with a To-do; a successful fetch is recorded.

**Notes:**

- **In ash_new:**
  - `pd marketsmith` is `src/pdash/marketsmith/`, ported from ash_backend's `fetch` job (copied, not imported, as ash_new's ADR 0001 has it, now amended):
    - `india.py` and `global_ms.py` are each site's endpoints;
    - `store.py` is the raw store's layout and commit;
    - `fetch.py` is a region's fetch from start to finish.
  - It fetches India and the US by default (`--region` for one, or Hong Kong). It writes `raw/MS/<region>/latest/` and `mappingExact.json` in ash_backend's data folder, in ash_backend's layout, so the securities table, fundamentals and screener read it as before.
  - India's universe is NSE's equity list, fetched again each time; it falls back to the cached copy, then to the last fetch's symbols. The US's is every symbol its boards' search lists. Both are as ash_backend's `update_symbols` made them.
  - The two regions are fetched at once, since they are different sites. Each region is paced as ash_backend paced it: 0.4 s ± 25% after each of India's answers, and 1.5 s ± 50% after the Global site's. A full fetch takes hours.
  - **What it keeps when something fails:**
    - A symbol whose fetch fails is tried again after a wait, then once more at the end. If it still fails, it keeps its last fetch. This is new: ash_backend dropped such a symbol from `latest/`, and ash_new then marked it inactive.
    - India's files that failed are asked for again at the end, as ash_backend did. One that fails again keeps an error record, which the readers skip. Unlike ash_backend's, the record never holds the token.
    - A rejected cookie, or any other failure, stops that region alone and leaves its raw store as it was.
  - It no longer copies each fetch into a `raw_<run id>/` archive. The dated snapshot replaces that, and ash_backend's existing archives are kept.
  - **The snapshot** is `data/lake/marketsmith/snapshots/<region>/<day>.json`, its id `<region>:<day>` (the day the fetch started, in UTC). For each security it holds:
    - the fetch time;
    - O'Neil's ratings;
    - India's red flags (the `getRedFlags` names set to 1);
    - India's estimates: the consensus, the ratings' counts, the target and each fiscal year's EPS and sales.

    `snapshots.snapshot_of(settings, security_id, on)` gives a security's entry in the latest snapshot on or before a day, with the snapshot's id. That is what issue 37's dossier will call to name its snapshot. The dossier itself is issue 37's, so this box stays open until then. Ticket 49 records what it took up.
  - The snapshot keeps the ratings, flags and estimates this issue names. Shareholding, news and the O'Neil checklist, which the PRD's dossier also reads, are still read from the latest fetch only.
  - **The cookies** are `PDASH_MS_INDIA_AUTH` (MarketSmith India's `ms-auth=...` token) and `PDASH_MS_GLOBAL_COOKIE` (marketsmith.hk's session cookie, for the US and Hong Kong), in ash_new's `.env`.
    - They are read by `pdash.marketsmith.cookies.Cookies`, never by `Settings`, so the Settings page and every other command never see them.
    - A cookie that isn't set counts as rejected, without asking MarketSmith.
  - **Its JSON** is against `contract/marketsmith.schema.json`: each region's status (`fetched`, `cookie_rejected` or `failed`), the cookie it uses, its counts, its run id, its snapshot and why it wasn't fetched. It exits:
    - 78 when a cookie was rejected and nothing else failed;
    - 1 when a region failed otherwise;
    - 0 when every region was fetched.
  - It holds its own lock (`lake/_state/marketsmith.lock`), so two fetches never overlap. It doesn't take the refresh's lock: the stocks Pipeline runs it before `pd daily`, and its commit is a swap of folders.
  - India's universe isn't filtered by ash_backend's `REMOVED_TICKERS_IN`. NSE's equity list doesn't have delisted symbols, and one MarketSmith can't find is skipped anyway.
  - Refreshing NSE's equity list also refreshes the cached copy that `pd enrich-securities` reads (`data/lake/official_lists/`). It is the same list, replaced only once it reads as one.
  - `pd daily`'s fundamentals step already rebuilds when the manifest's fetch times change, so the Saturday refresh builds from the new fetch. `tests/test_marketsmith.py` checks this.
  - `tests/test_marketsmith.py` answers every request from recorded responses in `tests/marketsmith_responses/`, trimmed from the raw store (`tests/marketsmith_fake.py`).
- **The MarketSmith Step** (`steps/stocks/marketsmith.ts`) runs between Answers and Lake.
  - It decides the day by the Run's id, its local start date, so a Saturday's Run re-run on Sunday still fetches.
  - It skips itself on other days and in a dry run.
  - It records what `pd marketsmith` printed as `marketsmith.json` and logs a line per region.
  - On exit 78 it skips with one To-do per rejected cookie. The To-do names the cookie and the regions it left unfetched, and gives the `pd marketsmith --region` command to run once the cookie is fresh.
  - Run again in the same Run, it asks only for the regions not yet fetched (`--region`), since a full fetch takes hours, and keeps the others as recorded.
  - Any other failure fails the Step, and the Lake Step still runs.
  - Once every region is fetched, it doesn't fetch again in the Run unless forced. Forced, it fetches every region again.
  - `pd marketsmith` gets `AGENTS_MARKETSMITH_TIMEOUT_SECONDS` (14 hours by default).
- **The Stocks Brief** has a MarketSmith section on Saturdays, before the Lake's, with a line per region (`src/marketsmith.ts`, shared with the Step's log).
- **In ash_backend:** `PM_ENABLED` (off by default) turns the Portfolio Manager agent off.
  - Its daily step reviews nothing and deletes the `PM_BUY` alerts it wrote.
  - `check_alerts` never trips or pushes a `PM_BUY` alert.
  - Its last regime no longer tightens the portfolio stops.
  - The rest of `run_all_latest` keeps the Sash app's data, and ash_backend's MarketSmith cookies stay in its own `.env` for that.
- **Waiting on Saransh:**
  - Copy MarketSmith's cookies into ash_new's `.env` as `PDASH_MS_INDIA_AUTH` and `PDASH_MS_GLOBAL_COOKIE`. The Pipeline never reads them, so it can't move them.
  - Deploy ash_backend to its VM. Until then, the VM's timer still runs the Portfolio Manager.
- **Found:** ash_backend's error records hold MarketSmith India's token in their URL (`raw/MS/IN/latest/*/summary.json` has some, ACEVECTOR's among them). Each `pd marketsmith` fetch of India replaces them. The tokens are likely long expired.

