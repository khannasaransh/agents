# 48: The Hong Kong Book at moomoo

**What to build:** Hong Kong is a Book, like India and the US: a real portfolio in HKD at moomoo, its fills and holdings recorded and reconciled from moomoo's exports, strategy versions it can trade, backtested and approved, its data checked by the Data gate and its MarketSmith data fetched each Saturday. See the stocks Pipeline PRD's "Books and the Mandate", changed for this on 26 October 2026: Hong Kong had been left out of the Books.

**Repos:** ash_new · **Mirrored in:** ash_new ticket 59 (keep both in step)

**Blocked by:** 24: moomoo into the US real Book; 25: CW2's selected variant and the ash ports

**Waiting on Saransh:** nothing.

**Status:** done

- [x] The Hong Kong Book has a real portfolio in ash_new for moomoo, in HKD.
- [x] moomoo's trade history and positions exports are read for the Hong Kong Book as well as the US Book: each file once for each, its other markets' rows set aside.
- [x] `pd` hands both Books' results back for one file, and the Broker inbox Step moves each file once.
- [x] Reconciliation works for the Hong Kong Book as for the US Book, dated in Hong Kong's time zone.
- [x] Each Hong Kong port has a version that fills at the next open, and a tuned or selected one where the cross-market study changed something. Both are backtested on the current Lake.
- [x] The approved versions, Hong Kong's among them, are recorded in ash_new's config.
- [x] The Data gate checks Hong Kong, and the MarketSmith Step fetches it on Saturdays.
- [x] The Stocks Brief shows the Hong Kong Book after the US Book, in Hong Kong dollars.
- [x] Tests: the moomoo files become both Books' ledgers and positions; a file one Book recorded and the other couldn't; Hong Kong failing the gate; the Brief's Hong Kong Book.

**Notes:**

- **One file, two Books.** moomoo's exports cover the whole margin account: its US, Hong Kong and Singapore markets.
  - ash_new reads each file through `moomoo_trades` and `moomoo_trades_hk` (`moomoo_positions` and `moomoo_positions_hk` for the positions). These are one layout, each reading only its own market's rows.
  - `pd broker import` gives a result for each Book, with the same `file` and `sha256`, in the order of the Books (India, the US, Hong Kong) among the files of their day or time.
  - A tradebook is "seen" only by a Book that recorded it before. Each Book records its own part of the same file once.
  - The Broker inbox Step moves a file into the Run when any Book recorded, saw or reconciled it, and sets it aside only when none could read it.
  - A Book that couldn't record a file another Book recorded gets a To-do. The file is in the Run's folder, and the next download of moomoo's cumulative trade history is a new file, so it is retried then.
- **Hong Kong's codes:** moomoo writes them with five digits (`00700`). The securities table matches them however many leading zeros they have (`HK:0700`).
- **Reconciliation** is dated in Hong Kong's time zone. Positions downloaded on a Saturday morning in Singapore are as of Saturday there, where the US Book's are as of Friday in New York. A position holds a trade from its day, as in the US Book.
- **Saransh's account today:** the Hong Kong rows are all of one ETF, CSOP Hang Seng TECH Index ETF (03033). His positions hold 10,600 shares of it. The securities table has no ETFs (issue 24 says so too), so its fills are set aside and Reconciliation names it as `unknown_security` while it is held.
- **Strategy versions,** in ash_new's plugins, as issue 25 made them for India and the US:
  - each port's `hk-<plugin>-next-open`: ash's settings, at the next open;
  - `-tuned` where the cross-market study of 20 October changed Hong Kong:
    - HAMA: weekly EMAs of 8 and 16 weeks, an 11.25% stop;
    - Investor: the SuperTrend gate and up-day ranking;
    - Swing: the up-day ranking.
  - CW2's `hk-cw2-selected`: the gate, the ranking and the 5% regime buffer.
  - Every figure reproduces the cross-market study's. For example, `hk-cw2-selected` makes 10.07% a year in 2016–2026 and −2.62% in the 2013–2016 holdout.
- **The approvals,** in ash_new's `config/approved_versions.yaml`: 21 versions, approved on 26 October at Saransh's word by one rule. A version qualifies when a Book can trade it (it fills at the next open) and its CAGR beat its benchmark's in both 2016–2026 and the 2013–2016 holdout.
  - **India (12):** `in-aim-shoot-next-open`, `in-cw2-next-open`, `in-cw2-selected`, `in-momentum-tuned`, `in-rs-rating-next-open`, `in-rs-rating-tuned`, `in-super30-tuned`, `in-super30-almost-next-open`, `in-super30-almost-tuned`, `in-super30-ok-next-open`, `in-super30-ok-tuned`, `in-swing-v1-tuned`.
  - **The US (6):** `us-cw2-next-open`, `us-cw2-selected`, `us-investor-v1-next-open`, `us-momentum-tuned`, `us-rs-rating-next-open`, `us-swing-v1-tuned`.
  - **Hong Kong (3):** `hk-gfs-next-open` (7.47% and 0.39%, against the Hang Seng's 0.92% and −0.45%), `hk-swing-v1-next-open` and `hk-swing-v1-tuned`. The Hang Seng was flat over the decade, so beating it is a low bar: Hong Kong's approved versions have Sharpes of 0.15 to 0.35. The Candidate test decides.
  - **Not approved:** ash's versions on the close, which are the audit's baseline, and the 23 versions a Book can trade that fell short of the rule. The built-in templates weren't audited, so they aren't approved either.
  - **To approve another:** run `pd versions` in ash_new, then add the strategy's id and version to the approvals file, with the day and a note. A plugin or engine change is a new version, which needs approving again.
- **The Data gate** checks Hong Kong now (`data_gate: true` in ash_new's `config/regions.yaml`, which keeps the gate for markets with a Book). Hong Kong's data was healthy and current on 25 October. A region without it still never fails the gate.
- **MarketSmith:** the Step asks `pd marketsmith` for each Book's market (`--region IN --region US --region HK`), and on a rerun only for the regions not yet fetched. Hong Kong uses the global cookie, as the US does. ash_new's own default stays India and the US. The approved Hong Kong GFS reads fundamentals, so they must stay fresh.
- **What the versions cost:** the plugins make 73 strategies, up from 61. Backtesting Hong Kong's 12 new versions over 2016–2026 took about 11 minutes (eight at a time, as issue 25 measured). All 71 India, US and Hong Kong versions together take about 80 minutes. A `pd daily` that reruns every stale one still fits within the Lake Step's 3-hour timeout, but with less room. The fix issue 25 named is still open: rerun only approved and launched strategies daily.
- **Not done here:**
  - Hong Kong's gold ETF and cash fund: the US Book's (Saransh, 26 October), in dollars, valued in Hong Kong dollars at each day's rate. Issue 26 adds them for the US Book, and issue 27's backtest holds them in the Hong Kong Book too;
  - the ETF in the Lake;
  - the later issues' Hong Kong parts. Each Book-level issue (the Book backtest, the Rule plan, paper Books, reviews) now covers three Books where it names two.
