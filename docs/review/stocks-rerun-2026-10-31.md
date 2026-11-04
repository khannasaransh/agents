# Stocks rerun, 31 October 2026

## Scope confirmed in chat

- Approve every waiting Correction in run `2026-10-31-0034` whose event date is before `2016-01-01`: 135 (108 bars, 13 splits, 14 dividends). Quarantine dismissals and later Corrections are not included.
- Apply only explicitly confirmed decisions. Do not implement the proposed upper-tail gate change, scorecard/attribution relabeling, analyst input isolation or search-policy changes.
- Sash uses separate managed lists for each of IN, US and HK. Paper holdings project to watchlists; real executed trades project to portfolios. Existing lists and alarms are not targets.
- Saransh explicitly chose to **leave Sash sync disabled** after the connection permission question. No Supabase credential was copied and no remote write was attempted.

## Implementation

`pd sash-export` is a read-only export of filled paper holdings and the real Books' executed transaction ledger. The new Sash Step comes after Save state and before Brief. It skips when disabled or in a dry run. Configuration can reference an existing credential file without copying its key; only the deterministic Step reads it.

Managed IDs are stable across retries. Real trades use Sash's existing atomic transaction/trade RPC with an idempotency ID, then rebuild derived trades in ledger order (including backdated imports and interrupted runs). A changed/deleted source transaction or manual remote ledger edit stops synchronization for review. Paper membership is reconciled only within the managed watchlist, with US instruments in HK retaining their US identity.

Sash's current schema represents whole-share BUY/SELL transactions. Fractional trades and split entries stop synchronization before writes rather than silently changing holdings. Cash deposits, withdrawals, dividends and fees have no matching Sash ledger representation and are counted as omitted cash entries; ash_new remains the complete ledger. No prices or trades are invented from proposed orders.

## Validation and execution

- Focused Answers, Check and Desk tests passed outside the filesystem sandbox; the initial sandboxed run could not execute child processes successfully.
- Six new Sash tests passed, covering regional identity, paper/real separation, retry behavior, ownership protection, ledger divergence, pagination and credential redaction.
- Updated stocks integration tests and TypeScript checking passed.
- Live `pd sash-export` returned the three Books with no filled paper holdings or real transactions.
- The backend export test passed against an isolated SQLite database, verifying chronological real-ledger output, exclusion of the paper ledger/proposed orders, and no source mutation. Ruff checks passed for the exporter and its test.
- Live cycle `2026-10-31-2054` started at 20:54 Singapore time, with the 135 approvals in its normal Answers inbox. Completion and outcomes are recorded below when verified.

## First live attempt and fixes

All 135 Answers applied successfully, leaving 14 pending Corrections and none dated before 2016. The source Answers file is archived in that Run's `answers/` folder.

The refresh exposed a fractional-assignment bug: approved historical splits can turn integer vendor volumes/prices into fractional adjusted values, which pandas refuses to assign into integer columns. Two regression cases reproduced it; adjusted columns are now converted to floats. All 24 correction/bar-correction regression tests passed.

MarketSmith India's configured data path had double-quoted Windows backslashes in `.env`; dotenv decoded `\b` and `\a` into control characters. Changed only that path to forward slashes and verified it exists with no control characters. A one-symbol India authentication probe succeeded. US/HK MarketSmith rejected the Global session cookie as expired; it was not replaced.

The Health worker also exposed external runtime blockers: Codex's Windows restricted-token sandbox cannot enforce the configured deny-read rules and refuses to start; Claude Code reported its weekly usage limit, resetting 2 November at 23:00 Singapore time. Worker protections were not relaxed. The first cycle was stopped after these failures; saved approvals remain intact.

## Verification on 1 November

Run `2026-11-01-1106` ran from 11:06 to 12:06 Singapore time and finished **partial**. The lake refresh succeeded on its first attempt and all three regions' last sessions reached 30 October; the freshness gate passed. Health remained unavailable (Codex sandbox, Claude quota, and the newly configured Cursor adversary's shell-wrapper restriction). Sunday produced no Rule plans, so Desk and Portfolio Manager skipped; Check recorded no new orders. Sash skipped as requested. Sunday scheduling also skips MarketSmith and weekly review, so the previous Saturday cookie failure remains unresolved.

The completed report showed 734 health flags and 658 quarantined securities. HK coverage was only 0.3% despite its latest date being current. The updater used the maximum date of any security to skip the entire region. A regression fixture reproduced a stale peer being skipped when one security was current. The updater now checks active securities at the expected session and retries missing peers alongside new listings and changed Corrections. This changes fetch recovery, not the Data gate or strategy policy. All 40 price-update and correction tests passed, as did Ruff.

Recovery verification run `2026-11-01-1901` ran from 19:01 to 19:40 Singapore time and finished **partial**. Both dashboards answered HTTP 200, and the API verified risk-free rates IN 0.06 / US 0.03 / HK 0.03 and the corrected data path.

The lake refresh succeeded. It retried missing securities and topped up 48 IN, 38 US and 2,772 HK securities; 6 IN, 127 US and 72 HK fetches failed and retained their earlier rows. Final data health was **ok**, with price coverage IN 99.8%, US 97.3%, HK 96.8% on 30 October, and the freshness gate passed. This fixes the earlier 0.3% HK coverage. Individual data issues remain: 739 flags and 661 quarantined securities. There are still 14 pending Corrections, none before 2016.

Health's worker calls still failed under the existing runtime restrictions/quota; the deterministic data-health report did complete. Portfolio Manager and Desk skipped because Sunday had no Rule plans/names to review. Check succeeded without recording orders. MarketSmith and weekly review were skipped by the Sunday schedule; Sash remained disabled. The completed Brief is served at `http://127.0.0.1:4310/runs/2026-11-01-1901/brief.html`.
