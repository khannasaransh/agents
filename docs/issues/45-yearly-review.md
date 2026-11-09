# 45: Yearly review

**Decision, 9 November 2026:** Saransh chose the India/US split to be report-only: approving it changes nothing, and the split moves only by the new money he sets in ash_new's config/books.yaml.

**What to build:** On the first Saturday of April, the review chooses strategies again and re-weights the Sleeves. It also says where new money goes and revisits the India/US split. Each change is a proposal Saransh approves with an Answer. See the stocks Pipeline PRD's "Reviews".

**Repos:** ash_new, agents

**Blocked by:** 35: Weekly review, promotions and demotions; 30: The Candidate test

**Status:** done, but for its first April on real data: Saturday 3 April 2027 (see "Not done")

- [x] On the first Saturday of April, `pd review` adds the yearly figures:
  - the Candidate test re-run for every strategy;
  - new Sleeve weights;
  - where the year's new money goes;
  - the India/US split.
- [x] Each is a Brief item, applied only on an approving Answer.
- [x] Between yearly reviews, nothing re-weights Sleeves or chooses strategies again.
- [x] Tests:
  - the yearly figures appear only on that Saturday;
  - nothing applies without an Answer;
  - approved weights take effect in the next Rule plan.

**Notes:**

- **`pd review --year`** (ash_new's `pipeline.yearly`, `contract/review.schema.json`'s `yearly`, null without it) adds the yearly review after the weekly one's demotions, so a Sleeve the demotion rule Retired that day isn't weighted. The Review Step passes it on the first Saturday of April (`yearReviewed` in `src/schedule.ts`), with three hours to run, since it runs each Book's Candidate test. For each Book:
  - **The strategies chosen again:** the Candidate test (`pipeline.candidates`, over the ten years to the latest session) against the Book's Sleeves from Paper up: those it chose that the Book hasn't (`joining`) and the Sleeves it didn't choose (`leaving`). A test that can't run says why. A proposal is made only when the two differ.
  - **The new Sleeve weights:** each strategy's share by the inverse of its live track's volatility over the year to the last close, as the Book engine weights a Book (`book_engine.sleeve_weights`, the track run as `pd plan` runs it), gold at the Mandate's 10%; beside each Sleeve's share of the paper Book now, and its real Book's share (its Stage's part).
  - **Where the year's new money goes:** config/books.yaml's `new_money` for the Book, shared out at the new weights. None is set yet (0 for each Book), so none is proposed.
  - **The India/US split**, across the Books: each paper Book's value in rupees and its share, before and after the year's new money, beside the split their capitals set.
- **The proposals** (migration 0024 `yearly_proposals`; `pdash.stages.yearly`): one of each kind per Book a year (the split once), found rather than made again when the review runs again; none in a dry run. A failing Data gate doesn't hold one back, but its why says so. One waits while it is undecided and no later year's of its kind supersedes it. `pd stages check` lists those waiting (`yearly`), and `pd yearly approve ID` or `pd yearly reject ID` decides one (`contract/yearly-decide.schema.json`):
  - **strategies:** approving it records the strategies chosen as Candidates (`stages.service.record_report`, each then waiting on its own approval into Paper) and Retires each Sleeve not chosen, still in its Stage, which winds down through its strategy's exits.
  - **weights** and **new money:** approving them changes nothing there and then: the Book's next Rule plans apply them.
  - **split:** approving it changes nothing.
- **Nothing else weights the Sleeves.** The Book engine gains `BookCourse.by_calendar` (on for the Book backtest, which still weights each April) and `BookCourse.weighting`, an approved weighting for the first session after a run's start. `pd plan` never weights by the calendar: each Book's real, paper and rules-only plan applies the latest approved weights and the latest approved new money its state hasn't had (`pending_weighting`). With the weights, each Sleeve is resized to its share (its Stage's part in a real Book) with the new money in; with only the new money, each Sleeve takes its share of it and keeps what it holds. A strategy Retired since (as approving the strategies Retires those not chosen) has no share: its share goes to the other strategies', in proportion. A Book starting with a weighting approved starts at its shares and records it, its capital standing for the year's new money. The plan's `engine.weightings` names the proposals it applied, and the fill records them in the Book's state (`BookState.weightings`), so the plans after it don't weight again, and a plan whose list never filled leaves them for the next. A plan in Hold mode waits.
  - This is the ids of the proposals, not a date: with the Lake behind, a plan's session can fall before the day of the approval, and a date would weight again.
- **Answers:** a yearly proposal is the item `yearly:<id>`, with Approve (`pd yearly approve`) and Reject (`pd yearly reject`).
- **The Portfolio Manager** gets the yearly figures inside `review` and writes `yearly`, the commentary (null on other days). It proposes nothing here.
- **The Brief:** "The yearly review's proposals waiting for your Answer" comes after the promotions, each with what it proposes, why, and Approve and Reject buttons. "Yearly review: 2027" comes after the monthly review: the commentary, each Book's Candidate test (what it chose, joining and leaving, each strategy's result, the chosen Book's backtest against its objective), its new weights against now, its new money, and the split.
- **Tests:**
  - **ash_new:** `tests/test_book_engine.py` (a Book not weighted by the calendar isn't weighted in April; an approved weighting resizes the Sleeves at the next session with its new money, and the state keeps its ids; a Book starting after an approval starts at its shares, without its new money, once; new money alone shared out without resizing; a strategy Retired since gets no share, the others its share; Stage scaling in a real Book); `tests/test_yearly_review.py` (through `pd review --year` on the fixture Lake, its paper Books run on through January 2019: no `--year`, no yearly review; each Book's figures and the proposals, found again on a second run; a dry run records none; nothing applies without an Answer, and the Rule plan never weights by the calendar; approved weights and new money in the next Rule plan of the paper and rules-only paper Books, once; new money alone; approving the strategies records the chosen as Candidates and Retires the rest; a rejection or the split changes nothing; no such proposal; a Candidate test that can't run); `test_contract.py`'s list.
  - **agents:** `test/schedule.test.ts` (the first Saturday of April); `test/stocks-review.test.ts` (`--year` on that Saturday, none on others); `test/answers.test.ts` (yearly Answers through `pd yearly approve` and `reject`); `test/portfolio-manager.test.ts` (the yearly figures in, the commentary out); `test/stocks-brief.test.ts` (the yearly review and its proposals; none on other Saturdays); `test/pd/review.yearly.json`, `stages-check.yearly.json` and `yearly-decide.*.json`.
- **Code review** (Standards and Spec, in parallel sub-agents). Fixed: an approved weighting that named a Sleeve Retired since (the strategies proposal Retires those not chosen, and the weights proposal is made the same day) left its share in the cash fund for a year: it now goes to the other strategies; a Book whose state started after an approval would have been weighted the day after it started and taken that year's new money on top of its capital: it now starts at the approved shares; a `BookState` docstring, untyped `now` parameters, a reused name and a missing docstring in `pipeline.yearly`; ash_new's CONTEXT.md has a Yearly review entry, and its Book backtest entry says the Rule plan no longer weights each April. Left as judgement calls: `proposed` as a JSON object read by its kind's keys rather than a type per kind; the kind checked in `_record`, `decide`, `pending_weighting` and the Brief's `yearlyWhat`; `weightings` threaded through `Listed`, both `_listed`, `BookState`, `filling` and the plan's schema (it is how the state learns of a fill); `year` the flag beside the year the review reads from the first Book's day. A real Book's weighting is tested through the Book engine (Stage scaling) but not end to end through `pd plan` and a fill, since no real Book has an Order list filled yet; new money in a real Book's plan is assumed deposited, as the calendar weighting assumed before (latent while `new_money` is 0).
- **Not done:**
  - **The first yearly review on real data:** Saturday 3 April 2027. It runs the Candidate test for each Book on the real Lake for the first time inside a Run: if three hours isn't enough, the Step fails and says so.
  - The split is of the paper Books' values: the real Books aren't valued in the review until their Order lists trade (issue 42).
  - **For Saransh:** two choices made here. The Sleeves not chosen again are proposed to be Retired with the Candidates, in one Answer per Book; say if you'd rather answer them one by one. And the new weights are the Book engine's own (inverse volatility of each live track over the year, gold at 10%), so approving them is what the Book backtest does each April.
