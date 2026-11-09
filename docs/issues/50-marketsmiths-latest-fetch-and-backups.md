# 50: MarketSmith's latest fetch and its backups

**What to build:** MarketSmith is fetched twice a week, but only what changed. A latest fetch asks for:
- the symbols with results lately;
- the symbols the store hasn't got;
- the stalest.

A full fetch of every symbol comes once a year. Each fetch starts from what the store has. It is checked whole before it replaces the store, and what it replaces is kept as a backup. The Health Agent looks into a fetch or a backup that went wrong, so a half one is never kept. See the stocks Pipeline PRD's MarketSmith Step.

**Repos:** ash_new, agents · **Mirrored in:** ash_new ticket 61 (keep both in step)

**Blocked by:** 22: MarketSmith on Saturdays

**Decisions, Saransh, 9 November 2026:**
- **Both modes start from a copy of the current `latest/`.** The symbols fetched replace their own folders.
- **Latest every Wednesday and Saturday.** Full once a year, from 1 July.
- **Backups:** every one of the current month is kept, and only the last of each month before.
- **ash_backend's defaults are kept:**
  - results in the last 15 days;
  - stale after 90 days, at most 500 a market;
  - nothing fetched in the last 10 days fetched again, but the new symbols.
- **The Health Agent checks the fetch and the backups**, so a half backup or a failed fetch is never kept.

**Status:** done, but for its first latest fetch on real data, on Wednesday 11 November 2026 (see "Not done")

- [x] `pd marketsmith --mode full|latest|auto`:
  - **full** fetches every symbol of the universe;
  - **latest** fetches only the symbols with results in the last 15 days, those `latest/` hasn't got, and up to 500 not fetched for 90 days;
  - **auto** fetches in full a region not fetched in full since the last 1 July (`--full-on`), and latest otherwise.
- [x] Each fetch starts from a copy of `latest/`, and every symbol it doesn't fetch keeps its last fetch, with when that was.
- [x] The results calendars: NASDAQ's for the US, NSE's for India, and AAStocks' for Hong Kong. A calendar that fails leaves the fetch to its new and stale symbols, with a To-do.
- [x] A fetch is checked whole before it replaces `latest/`. One that isn't whole is discarded, leaving `latest/` as it was.
- [x] The `latest/` a fetch replaces becomes a backup. Backups are pruned by month, and one that isn't whole is removed whatever its month.
- [x] The dated snapshot is of the whole store, each entry with its own fetch time.
- [x] The MarketSmith Step runs on Wednesdays and Saturdays with `--mode auto`. Its line in the log and the Brief says which mode ran, what it chose and what went wrong.
- [x] The Health Step runs when the fetch went wrong, even on a healthy Lake, and gives the Health Agent the fetch to check. It runs when:
  - a region failed;
  - a results calendar couldn't be read;
  - symbols of the last fetch weren't whole;
  - a backup was removed for not being whole.
- [x] Tests:
  - **ash_new**, on the fake MarketSmith, never the network:
    - a latest fetch, the 10-day rule, new and stale symbols;
    - auto's yearly full fetch;
    - a symbol not whole fetched again;
    - a fetch not whole not kept;
    - the backups' monthly pruning, and the backup's files left unchanged by the next fetch;
    - each calendar parsed, AAStocks' dates kept across fetches, and a failing calendar.
  - **agents:** the Step's days and arguments, a latest fetch's line and its calendar To-do, the Health Agent called on a fetch that went wrong and not on one that went well, and the Brief's line.

**Notes:**

- **The store** (ash_new `pdash.marketsmith.store`):
  - `begin` stages a copy of `latest/`, hard-linked file by file so it costs no disk, leaving out any symbol whose files aren't whole (`left_out`), so it is fetched again.
  - A symbol fetched gets its folder cleared and its files written anew, never through a link, so `latest/` and the backups never change underneath.
  - `commit` merges this fetch's manifest lines over those carried. A symbol that failed, or that MarketSmith now has nothing for, keeps its last fetch if it had one.
  - It checks the staged store (`check_store`: the manifest read and its counts right, each fetched symbol's files there and ending as a JSON object does). Only then does it rename `latest/` into `backups/<its run id>/`, with the `mappingExact.json` of then, and the staged store into `latest/`.
- **Pruning** (`RawStore.prune`) removes each backup that isn't whole, then in each month before the current one every backup but its last. A month whose last backup isn't whole keeps the one before it.
- **Choosing a latest fetch's symbols** (`fetch._choose`), in the universe's order:
  - the symbols with results on the calendar in the 15 days to today (the market's own date), unless fetched in the last 10 days;
  - the symbols with no whole fetch in `latest/` (new);
  - then the stalest, over 90 days, oldest first, at most 500.

  A symbol in `latest/` but no longer in the universe stays as it was.
- **The calendars** (`pdash.marketsmith.results`, from ash_backend's `fetch_latest`, copied, not imported):
  - **NASDAQ:** asked one weekday at a time. `BRK.B` is read as MarketSmith's `BRK/B`.
  - **NSE:** its financial results and its event calendar's results meetings, with ash_new's NSE headers.
  - **AAStocks:** lists only the results to come. So each date it gives is kept in `results_calendar.json` beside the store, for 60 days, and a code counts once its date has passed into the window. The first Hong Kong latest fetch finds none, and each later one finds those announced since.

  On 9 November 2026, NASDAQ listed 621 reporters for 5 November, and NSE's event calendar had 1,521 events over 15 days. Its financial-results endpoint gave only 1 row over the same window. AAStocks listed 40 codes from 10 to 30 November.
- **auto's mode** (`fetch.fetch_mode`):
  - A region with no fetch is fetched full.
  - A manifest from before the modes counts as a full fetch on its day, as every fetch then was. So the 8 November India fetch, and the 9 November US and Hong Kong one, are this year's full fetches, and the next is due from 1 July 2027.
  - The manifest keeps `mode` and `full_fetched_at_ms`.
- **`pd marketsmith`'s JSON** (`contract/marketsmith.schema.json`) gives each region `mode`, `chosen` (by reason), `calendar`, `left_out` and `backups` (kept, and each removed with why). `ok`, `skipped` and `failed` count what this fetch asked for.
- **The agents Step** passes `--mode auto --full-on 07-01` (`fetchDays`, `fullFetchOn`). A calendar that failed raises a To-do, and the cookie To-do now says "in this Run", not "this Saturday".
- **The Health Step** adds `marketsmithProblems` (`src/marketsmith.ts`) to why it runs, and gives the Agent `marketsmith`, this Run's `marketsmith.json`. Its instructions say what to check in the store: whether `latest/` is the last good fetch, which backup went and why, and whether each month before still has one.
- **Disk:** a backup costs only the files the next fetch replaced, as the rest are hard links. A full fetch replaces every file, so that backup is a full copy: the US's `latest/` was 441 MB on 9 November 2026.

**Not done:**
- **The first latest fetch on real data:** Wednesday 11 November 2026's Run.
- **The 9 November full fetch of the US and Hong Kong** ran on the code before this change. It replaced `latest/` without a backup, and its manifest has no mode, so it counts as a full fetch.
