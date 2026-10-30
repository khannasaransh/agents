# 35: Weekly review, promotions and demotions

**What to build:** Every Saturday the Stocks Brief carries the weekly review. Each Sleeve and Book is measured against its backtest's range and its benchmark. A strategy that breaks the demotion rule is demoted. The Portfolio Manager proposes promotions, which Saransh approves with an Answer. See the stocks Pipeline PRD's Review Step and "Reviews".

**Repos:** ash_new, agents

**Blocked by:** 34: The Portfolio Manager, the Playbook and the final check

**Status:** done, but for a review on real data: no strategy is in Paper yet (see "Not done")

- [x] On Saturdays, a Review Step gets the weekly figures from `pd review`:
  - each Sleeve's and Book's live return and drawdown, against its backtest's range and its benchmark;
  - Reconciliation's differences.

  On other days the Step skips itself.
- [x] The demotion rule is applied by itself, and the Brief reports each demotion. A strategy is demoted when:
  - its live drawdown passes 1.5 times its backtest's worst; or
  - after 12 months live, its rolling 12-month return falls below its backtest's 5th percentile.
- [x] On Saturdays the Portfolio Manager gets the figures, writes the review's commentary, and proposes a promotion when a Stage's time is up (3 months of Paper, 6 of Real-small) and the strategy's record is inside its tested range.
- [x] An approving Answer moves a promotion's Stage, and the next Rule plan uses it.
- [x] Tests:
  - live within range and outside it;
  - each half of the demotion rule;
  - a promotion is proposed and approved;
  - the Step skips itself on weekdays.

**Notes:**

- **`pd review [--dry-run]`** (ash_new's `pipeline.review`, `contract/review.schema.json`) measures each Book's paper Book and each Sleeve from Paper up (not Retired):
  - **A Sleeve's live record** is its strategy's live track (the total-return index in `lake/live/`) while the track follows the Sleeve's version, from its launch, or from its last demotion when it has had one: a demoted Sleeve is judged again only on what came after, so one bad fall doesn't demote it all the way down on successive Saturdays. Its benchmark is the track's own.
  - **A paper Book's** is its value per unit on each close filled; its benchmark is the Book's, over the same sessions.
  - **The backtest's range** is the ten years before the live record began, so none of the live record is in it (a backtest over the latest ten years would simulate the live fall too and never demote): the strategy's own backtest (`run_backtest`, stored and read back) for a Sleeve, and a Book backtest of the paper Book's Sleeves (`book_backtest.run_window`) for the paper Book. It gives the worst drawdown, the distribution of rolling 12-month returns, and that of returns over as many whole months as the live record has.
  - **Inside the tested range** means a drawdown no deeper than the backtest's worst, and a return over the record's whole months between the backtest's 5th and 95th percentiles of the same windows. So a three-month record is compared with every three-month window of the backtest, not with 12-month figures it can't have yet.
  - It also gives each real Book's latest Reconciliation, with its differences, and names each Book's broker for the Brief's wording.
- **The demotion rule** is applied by `pd review` itself: Real-full to Real-small, Real-small to Paper, Paper to Retired (a Paper strategy has nowhere lower in the Book, and a Retired one winds down through its own exits), recorded as a Stage change by "the demotion rule" with which half broke and its figures. A demotion replaces no other version (`StageStore.enter(replace=False)`). It is held, and said, while the Data gate fails (a bad bar would demote on nothing) and in a dry run.
- **Promotions** (`pdash.stages.promotions`, migration 0018 `stage_proposals`): `pd stages propose SLEEVE --why … [--by]` records one only while it is due: its time in its Stage up (3 calendar months of Paper, 6 of Real-small, from its `since`), its record inside its tested range and breaking no demotion rule; else it says why and records nothing. One Sleeve has one waiting at a time. `pd stages check` lists those waiting (each Sleeve still in the Stage it was proposed from). `pd stages promote ID` moves the Sleeve that day, replacing an older version of its strategy at that Stage or below (as issue 31's notes foresaw), and the next `pd plan` holds it at its new Stage; `pd stages reject ID` changes nothing else. One whose Sleeve has left its Stage since (a demotion) no longer waits, and approving it changes nothing.
- **The Review Step** (`steps/stocks/review.ts`) runs on Saturdays only, keeping what `pd review` printed as `review.json` (`--dry-run` in a dry run). **It comes after the Lake Step and before Stages**, not after Plan as the PRD's Step list has it, so its demotions count in the same Run's Stages and Rule plans: on a Saturday a demotion after Plan would wait until Tuesday's plan. Pipeline order: answers, broker-inbox, marketsmith, lake, **review**, stages, health, plan, portfolio-manager, check, save-state, brief.
- **The Portfolio Manager** gets `review` (`review.json`; null on other days) among its inputs, and a Decision record may cite it. Its output adds `review` (the review's commentary, null on other days) and `promotions` (each by its Sleeve's id, with why). On a Saturday whose Plan Step failed it still runs, for the review, with `plans` null. **Save state** records each promotion with `pd stages propose … --by "the Portfolio Manager"` and keeps what became of each as `promotions.json`.
- **Answers:** a promotion is the item `promotion:<id>`, with Approve (`pd stages promote`) and Reject (`pd stages reject`).
- **The Brief:** "Promotions waiting for your approval" comes after the Candidates, with Approve and Reject buttons (those the Stages Step read, and those Save state recorded in this Run). The "Weekly review" comes after "Sleeves and Stages": the Portfolio Manager's commentary, each demotion and why (or that none), each Book's paper Book and Sleeves with their live return, drawdown now and at worst, the benchmark's, the backtest's worst, the return against the range of the same windows and whether it is inside, Reconciliation's differences, and the promotions due. A Book with nothing to show is left out.
- **Shared:** `runWeekday` moved from the MarketSmith Step to `src/schedule.ts`; ash_new's `book_backtest.quantiles`, `stages.service.tracked_at` and `today_in` are public now, for the review.
- **On a copy of the real app database, 30 October 2026:** `pd review --dry-run` runs and prints its schema's shape: the Data gate fails (the Lake is 3 to 4 sessions behind), no Sleeve is in Paper and no paper Book has started, so there is nothing to measure, demote or promote.
- **Tests:**
  - **ash_new:** `tests/test_review_rules.py` (the pure rules on hand-made series: a record inside its range; a drawdown past the backtest's worst outside it but not demoted; a return under the 5th percentile outside it; each half of the demotion rule, the rolling one only after 12 months; a backtest too short for the window; when a Stage's time is up); `tests/test_review.py` (through `pd review` on the fixture Lake with a written live track: inside its range with its promotion due; a drawdown past the worst outside it and its promotion refused; past 1.5 times the worst demoted by itself, held in a dry run and while the Data gate fails, then not reviewed once Retired; judged again only after a demotion; a promotion proposed, refused twice, approved, and the next Rule plan holding it at Real-small; one before its time refused; a rejected one and a stale one; the paper Book measured against a Book backtest and its benchmark); `test_contract.py`'s list.
  - **agents:** `test/stocks-review.test.ts` (skips on a weekday; on a Saturday keeps `pd review`'s figures; a demotion in the log; a dry run; a failing `pd review`); `test/portfolio-manager.test.ts` (the review among its inputs, its commentary and promotions, Save state recording them; the review commented on when the Plan Step failed); `test/answers.test.ts` (promotion Answers through `pd stages promote` and `reject`); `test/stocks-brief.test.ts` (the weekly review, a demotion, a failed Review Step, promotions waiting); the Pipeline's tests.
- **Code review** (Standards and Spec, done inline: the review sub-agents stopped on a usage limit). Fixed: the review's own copy of the Book engine's Stage mapping is gone (it uses `plan.engine_stage`); a missing type annotation in `promotions.py`; the Portfolio Manager's `plans` input now says it is null on a Saturday whose Plan Step failed. Left as judgement calls: `promotions.Decided` sharing its name with `judgement.service.Decided` (separate modules, the same role); a Sleeve demoted in a review still in that review's Book backtest of the paper Book.
- **ash_new's full suite** passes but for `test_backtest_engine.py::test_what_happens_after_a_signal_day_never_changes_its_picks`, which fails the same way without this change (a Hypothesis case: a pandas dtype mismatch in `security_id`).
- **Not done:**
  - No strategy is in Paper on the real Lake yet (India Super 30 OK, tuned waits as a Candidate), so no review has measured a real record.
  - The real Books aren't reviewed: they have no Order lists until issue 42, so their records are Legacy holdings, not the Sleeves'. A real Book's Sleeves are reviewed through the paper Book's (the same strategies' live tracks).
  - The PRD's other weekly figures come with their issues: fill costs and the real-to-paper gap (44), Disaster stops not marked placed (42), the override scorecard (40), and each paper Book's gap to its rules-only paper Book (already in the Brief's paper Books section, issue 33).
  - **For Saransh:** two choices made here. A Paper strategy demoted is Retired (the PRD says "demoted", not where to); and a record above the backtest's 95th percentile counts as outside its tested range, so it isn't promoted until it comes back inside. Say if either should change.
