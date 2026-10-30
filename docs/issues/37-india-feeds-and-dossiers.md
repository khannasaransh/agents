# 37: India Feeds and the dossiers

**What to build:** For the names the Desk will review, the Pipeline fetches India's company events and builds a dossier per name, covering everything the Desk may read. The Brief shows coming events for the holdings. See the stocks Pipeline PRD's Feeds Step and "Feeds and dossiers".

**Repos:** ash_new, agents

**Blocked by:** 32: Rule plan for the paper Books

**Status:** done, but for a review list on real data: no strategy is in Paper yet, so no paper Book has a buy (see "Not done")

- [x] `pd plan` lists the names the Desk reviews: the Rule plan's buys and sales, plus the holdings with results or another event in the next 5 sessions. For each name it says which analysts it needs, and why:
  - Events, for a name with results or another event in the next 5 sessions, or with a new event since its last view;
  - Chart, for each buy;
  - Risk, for each Book with buys, over all of them.

  A sale needs no analyst, since the Desk can't stop one.
- [x] `pd feeds` fetches, for those names and the holdings in India:
  - NSE's and BSE's corporate announcements;
  - board meetings, which give results dates;
  - pledges.

  It caches what it has fetched before. Each event has its date, its kind, the time it was fetched and a link to its source. A Decision record may cite only events fetched before its Run.
- [x] A source that fails skips itself with a To-do, since these endpoints need browser-like headers and change without notice.
- [x] `pd plan` writes a dossier for each name the Desk reviews:
  - about a year of daily bars, with volume, RS and the distance from its 52-week high;
  - MarketSmith's snapshot;
  - fundamentals;
  - its events;
  - the strategy and signal behind its order.

  The dossier holds a copy of what it read, not a pointer to MarketSmith's latest fetch, so a Decision record can be checked against it later. Issue 22 keeps each MarketSmith fetch as a dated snapshot; `pdash.marketsmith.snapshots.snapshot_of` gives a name's entry with the snapshot's id, for the dossier to name.
- [x] A Feeds Step runs after the Plan Step, and the Brief shows coming events for the holdings.
- [x] Tests run on recorded responses, never the network:
  - parsing each source;
  - the cache;
  - a failing source;
  - the review list, and the analysts each name needs.

**Notes:**

- **The review list** (ash_new's `pipeline.dossiers.review_list`; `contract/plan.schema.json`'s `review`). `pd plan` prints it with the Rule plans: each paper Book's buys and sales (not gold's), then its holdings with results or a board meeting in the next 5 sessions of its market, counted from the Run's day (`--on`).
  - **Events:** a name with such an event, or with an event new since the Events analyst's last view. The last views come from `pd plan --last-views FILE` (`{"IN:RELIANCE": "<ISO time>"}`, in UTC without an offset): an event is new when it was fetched after the view. Without a view, an event is new when it is dated in the 5 sessions before the Run's day. Nothing passes `--last-views` yet: the Desk's views are issue 39's.
  - **Chart:** each buy. **Risk:** each Book with buys, naming them.
  - **A sale** is listed with no analyst and why.
  - `analysts` lists the analysts needed at all, so issue 39's Desk Step can skip itself on a quiet day.
  - Only the paper Books' plans are reviewed. The shadow plan isn't for placing, and the rules-only plan trades the Rule plan unchanged.
  - `review.holdings` is every Book's holdings, real and paper, except its gold ETF and cash fund, each with the Books holding it. `pd feeds` fetches for these too.
- **The Feeds run after the Plan Step**, as the issue has it. So the review list reads the events earlier Runs fetched (the feeds cache), and a results date first fetched in this Run counts from the next Run's plan. Boards announce results meetings well before 5 sessions (Reliance's 30 October meeting was announced on the 27th, three sessions ahead), so a holding can miss one Run's review. Say if Feeds should run before the plan instead, for the holdings at least.
- **`pd feeds --plan plan.json --dossiers dossiers`** (ash_new's `pdash.feeds`, `pipeline.feeds`; `contract/feeds.schema.json`):
  - **NSE:** `corporate-announcements`, `corporate-board-meetings` (90 days back and 90 ahead) and `corporate-pledgedata`, for names listed on NSE. It sends a browser's User-Agent, Accept and Referer, and no cookies: on 30 October 2026 the API answered without them.
  - **BSE:** `AnnSubCategoryGetData`, by the scrip code BSE's `ListofScripData` gives the name's ISIN or symbol (the list is kept a week).
  - **Board meetings:** NSE sends each one twice (the XBRL intimation and the letter), so it becomes one event per meeting day. That event is a `results` event when either copy mentions financial results; otherwise it is a `board_meeting`.
  - **Pledges:** each quarter's disclosure, with the promoters' holding, the share of their shares pledged and the shares pledged out of all shares.
  - **Each event** has an id (`<source>:<its own id>`), kind, day, title, link, when the source published it, when it was first fetched (UTC), and a `detail`.
  - **The cache** is `data/lake/feeds/<source>/<security>.json`. An event is never forgotten and keeps the time it was first fetched. `FeedCache.events(…, as_of)` reads back what was known by a time.
  - **What gets fetched:**
    - A name not fetched before: its last 90 days.
    - Otherwise: from a week before its last fetch.
    - A name fetched in the last 6 hours: read from the cache.
  - **Output:** each name has its events dated from 90 days back on, as fetched by then. Each dossier in `--dossiers` gets those events and their time (`events_as_of`).
  - **A source that fails** stops for the rest of the fetch, keeps what it had and says why. The Feeds Step raises a To-do for it.
  - **A dry run** passes `--cached`: nothing is fetched and only the cache is read.
- **"A Decision record may cite only events fetched before its Run":**
  - What holds it: the Run's inputs (`feeds.json`, the dossiers) only hold events fetched by then, and `pd check` looks every cited figure up in the Run's inputs (issue 34). So a later-fetched event can't be cited.
  - What it doesn't do: no check compares an event's `fetched_at` with the Run. The dossiers include events fetched in this Run's Feeds Step, before the Portfolio Manager decides, so "before its Run" is read as "before its Decision record".
- **The dossier** (`pd plan --dossiers dossiers`, one file per security, `dossiers/IN_RELIANCE.json`; `contract/dossier.schema.json`):
  - its market's last 252 sessions: open, high, low, close, volume, the RS Rating that day and the close's distance from the highest high of the 252 sessions to it;
  - MarketSmith's snapshot entry on or before its last session, naming the snapshot (`snapshot_of`);
  - its key stats and its latest 8 quarters' and 3 years' sales, profit and EPS (with growth) and ROE, as public by then;
  - its events;
  - its orders, with the strategy (Sleeve), signal and cuts behind each.

  The review list names each name's dossier.
- **The Feeds Step** (`steps/stocks/feeds.ts`, after Plan):
  - runs `pd feeds`, keeps `feeds.json` and logs each source;
  - raises a To-do for each source that failed (asking for ash_new's reader to be checked), and for EDGAR without its contact;
  - skips itself when the Plan Step made no plan;
  - **the Plan Step** passes `--dossiers dossiers` and logs each reviewed name with its analysts.
- **The Brief:**
  - **"Coming events for the holdings"** follows the real Books: each holding's results and board meetings in the next 30 days, soonest first, with the Books holding it, its kind and its source's link.
  - **No event coming:** it says so.
  - **A source not fetched:** it is named, and its events are as last fetched.
  - **The Feeds Step failed:** it links its log.
- **The stand-in `pd`:** `plan.*.json` have a review list (`plan.normal.json`: two buys, one with results coming); `feeds.fetched.json`, `feeds.failed.json`, `dossier.india.json`.
- **On real data, 30 October 2026:**
  - `pd plan --on 2026-10-30 --dossiers …` runs on the real app database in 16 seconds, with an empty review list. Every plan is still `cant_plan` (the Lake has no prices for the Books' ETFs), and no Book holds anything.
  - `pd feeds` on a plan naming RELIANCE (reviewed), TCS and AAPL (held), on a scratch copy of the lake, fetched:
    - from NSE, 87 announcements, the 30 October results meeting and the pledges;
    - from BSE, 89 announcements;
    - from Yahoo, AAPL's 3 November earnings date;
    - EDGAR skipped itself without the contact.
  - BSE answered `pd`'s requests, though it refused curl's (403).
- **Tests:**
  - **ash_new:**
    - `tests/test_feeds.py`:
      - each source parsed from recorded responses: NSE's (recorded on 30 October), BSE's (in the shape its API answered);
      - a response in a changed shape fails its source;
      - the pacer;
      - through `fetch_feeds` on a fake HTTP: what each source fetched with browser headers; the cache reused within 6 hours, and asked again from a week back, keeping each event's first fetch time; what was known by a time; a failing source stopping and keeping what it had; a dry run; the dossiers brought up to date.
    - `tests/test_review_list.py`: each buy needs Chart; its Book needs Risk; a sale needs none; results in the next 5 sessions need Events, for a holding too; a new event since a view, or without one, in the 5 sessions before; only made paper plans; a quiet day.
    - `tests/test_plan.py`: `pd plan --dossiers` on the fixture lake gives the review list from a cached results date and the real Book's holding. The dossier is checked against its schema, with its bars, events, orders and MarketSmith's snapshot as of its last session.
  - **agents:**
    - `test/feeds.test.ts`: the Step's call and `feeds.json`, To-dos for a failed source and for EDGAR, the contact passed to `pd`, a dry run, the skip without a plan, a failing `pd`.
    - `test/plan.test.ts`: `--dossiers`, and the review logged.
    - `test/stocks-brief.test.ts`: coming events, none coming, a failed Feeds Step.
    - `test/stocks.test.ts` and `test/schedule.test.ts`: the Step in the Pipeline.
- **Code review** (Standards and Spec, in parallel sub-agents). Fixed:
  - EDGAR's contact is now read like MarketSmith's cookies, from the environment or ash_new's `.env`, not the environment alone.
  - EDGAR without its contact now skips itself even when every US name was fetched lately. Before, it reported `fetched` and raised no To-do.
  - A last view's time without an offset is read as UTC, not a crash.
  - The Brief's coming events are results and board meetings only. An announcement published on the Run's day had shown as coming.
  - One 90-day constant, not two.
  - ash_new's `docs/CONTEXT.md` defines Feed, Review list and Dossier.
  - The dossier test checks a MarketSmith copy.
  - Two comment wraps, and the skip test now checks the reason it logs.

  Left as judgement calls:
  - the parser, pacer and cache tests call their modules directly, since the issue asks for "parsing each source" and "the cache" to be tested;
  - `pdash.feeds` sits beside `pdash.marketsmith`, not under `sources/`;
  - the name-and-holders shape is spelled out in both the review list and the Feeds;
  - `rule_plans` builds the review list too, so `pd plan` prints it as the Plan Step asks.
- **Not done:**
  - **On real data:** no review list or dossier has been made. No strategy is in Paper (`in-super30-ok-tuned` waits for your approval as a Candidate), so no paper Book has a buy.
  - **The dossier's MarketSmith part:** it has what issue 22's snapshot keeps (ratings, red flags, estimates), not the shareholding, news or O'Neil checklist the PRD lists. Those are in the raw store but not in the dated snapshot, so adding them is a change to issue 22's snapshot.
  - **NSE's cookies:** nothing primes them. If NSE starts refusing requests without them, its sources fail with a To-do until `pdash.feeds` gets a cookie jar.
  - **For Saransh**, three choices made here:
    - Feeds after the plan, so the review list lags a Run behind a results date first fetched that day;
    - without a last view, "new" means dated in the 5 sessions before the Run's day;
    - the Brief shows the next 30 days.

    Say if any should change.
