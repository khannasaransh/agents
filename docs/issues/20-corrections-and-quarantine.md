# 20: Corrections and Quarantine

**What to build:** A flagged security goes into Quarantine instead of freezing every Book. The Health Agent proposes a Correction for the bad corporate action behind the flag. Once Saransh approves it, the next refresh applies it and re-runs the backtests it affects. See the stocks Pipeline PRD's "Data, Corrections and Quarantine".

**Repos:** ash_new, agents

**Blocked by:** 19: Health Agent

**Status:** done

- [x] ash_new applies a Corrections file when it builds prices (decision 2a). A Correction can be:
  - a split or bonus, with its date and ratio;
  - a dividend dropped or corrected;
  - a demerger's ratio.

  Applying one changes the data version, so the backtests it affects go stale.
- [x] The refresh re-runs stale backtests after building the panels (decision 1b).
- [x] The Health Agent can propose Corrections in the file's format. The Pipeline records them in ash_new as waiting.
- [x] A `pd` command approves or rejects a waiting Correction. An approved Correction joins the file, and the next refresh applies it. Nothing unapproved is ever applied.
- [x] A security the Health report flags is Quarantined until its Correction is approved or its flag dismissed. A `pd` command dismisses a flag. The status JSON lists each Quarantine with its flag.
- [x] A flag on its own doesn't fail the Data gate.
- [x] The Brief lists each Quarantine, and each waiting Correction with what it would change.
- [x] The known data issues (Bhagyanagar India's −91% bar, New Fortress Energy's 150.00 dividend) come through as proposed Corrections.
- [x] Tests:
  - **ash_new:** a Correction fixes the total-return index and the panels; a waiting one changes nothing; approving one lifts its Quarantine.
  - **agents:** proposals are recorded, and the Brief lists them.

**Notes:**

- **The Corrections file** is ash_new's `config/corrections.yaml` (`src/pdash/lake/corrections.py` says what each kind does). Corrections are applied to what Yahoo gives as prices are built (`pd prices-backfill`, which `pd daily` runs), before the total-return index is computed.
  - **A split** gives a date and a ratio: shares after per share before. The prices and dividends before that date are divided by the ratio, and the split is stored among the actions, so ledgers and EPS follow it. Where Yahoo records a split that day, its prices are taken to reflect Yahoo's own ratio, so they move by the Correction's ratio over Yahoo's.
  - **A dividend** sets that ex-date's dividend, or drops it when its value is null.
  - **A demerger** gives the share of the value the company kept. The prices and dividends before it are multiplied by that share, and nothing is stored among the actions.
  - **A bar** (added by issue 49) leaves out Yahoo's bar on its date: a close many times the closes around it, or a fraction of them, back the next session. It has neither a ratio nor a value.
- **How an approved Correction gets applied:** the lake records which of each security's Corrections its stored history was built with (`corrections/region=*/built.json`). When that record no longer matches the file, the next refresh fetches the security's whole history again and builds it with the Correction. This holds even when the Lake is already current, so long as the security is active.
  - A top-up corrects only what Yahoo sends. The stored bars it keeps already carry their Corrections, and one dated before the top-up's first day is left to the stored history.
  - The new prices give the panels a new data version.
- **Decision 1b:** the refresh has a new `backtests` step, between `panels` and `live`. It backtests again each strategy whose newest run is stale: the panels have a new data version, or the engine is newer. A strategy that can't run is logged and the rest go on, so a broken one never stops the health checks.
- **Proposals:** the Health Agent's output now has `corrections`, in the file's format. Its instructions point it at the flags, at `docs/data/issues.md` and at the Corrections file.
  - The Step records them with `pd corrections propose <file> --by "the Health Agent, Run <id>"`. ash_new keeps them in its app database (migration 0013) as waiting. The same change proposed again isn't recorded twice, and an entry that isn't a Correction is refused with why, while the rest are recorded.
  - Once they are recorded, the Step reads `pd status` again into `health/status.json`, so the Brief lists them as waiting the same day.
  - A dry run records nothing. A recording that fails fails the Step and keeps the diagnosis, and a re-run records them again without asking the Agent again.
- **Deciding:**
  - `pd corrections approve <id>` adds a Correction to the file. It lifts the open Quarantines of its security that were flagged on the Correction's date.
  - `pd corrections reject <id>` drops it, and its Quarantines stay until dismissed.
  - `pd quarantines dismiss <id>` lifts one Quarantine.
  - Deciding something already decided changes nothing and says why, which the Answers Step (issue 21) needs.
  - Each command prints JSON, against a new schema in ash_new's `contract/`, and the stand-in `pd` has an example of each.
- **Quarantine:** the refresh's health step quarantines each flag, keyed by its security, check and date.
  - A flag quarantined once isn't quarantined again, even after it is lifted.
  - A dismissed `cross_source` gap stays dismissed even though each MarketSmith fetch dates it again.
  - `pd status` lists the open Quarantines and the waiting Corrections, each with what it would change: the close's move on that day for a split or demerger, and the total-return index's move for a dividend.
- **The Data gate:** a region the Health report fails on its flags alone (`dates`, `pit`) no longer fails the gate. Those flagged securities are quarantined instead.
  - The refresh no longer fails on them either: `DataHealthFailed` is gone, so one security with a duplicated date no longer fails `pd daily` and puts every Book in Hold.
  - The report itself still says `fail`, for the Data page.
  - Today every region failure comes from flags, so the gate's Health clause can't fire on today's report. It is kept for a failure that isn't one.
- **The Brief:** under the Health Agent's diagnosis it says what became of the Corrections it proposed. Then it lists the Corrections waiting for approval (what each changes, why, who proposed it) and the Quarantines by market, with the commands to answer them until issue 21's buttons.
- **Live run, 25 Oct (Run 2026-10-25-1552, on the real Lake):**
  - All three Steps succeeded.
  - `pd daily` quarantined 747 flags on 599 securities. It also ran 47 stale backtests again; the three CW2 plugins couldn't run, because their code changed since their version.
  - The Health Agent, on Claude Code, proposed 19 Corrections, and all 19 were recorded as waiting:
    - Bhagyanagar India: a split of 11 on 8 Oct 2026. It asks for the terms to be checked against the announcement, since the open gives 11.66.
    - New Fortress Energy: the 150.00 dividend of 3 Jan 2023, dropped.
    - Bansal Wire (5), Veranda (7) and Credit Suisse High Yield (0.1, a reverse split).
    - Fourteen pre-2011 dividends larger than the close.
  - The Brief listed them only once `health/status.json` existed. The first render read the Lake Step's status, from before they were proposed, which led to the status being read again.
  - Nothing is approved: that is Saransh's.
- **Not done:**
  - Hold or Quarantine in the Rule plan is issue 32's.
  - Answers from the Brief are issue 21's.
  - NFE's reverse split of 15 Sep 2026 (`docs/data/issues.md` in ash_new) has no Correction yet. It falls outside the jump check's 20 sessions, so nothing flags it and the Health Agent didn't propose one.
  - A Quarantine is lifted when its Correction is approved, as the issue asks. The refetch that applies it comes at the next refresh, and it retries while a fetch fails.
