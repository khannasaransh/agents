# 40: Override scorecard

**What to build:** Every Override is scored against what the Rule plan alone would have done, and the weekly review shows the tally by Lever. A Lever's range and the Desk's say widen only on evidence, and a Lever that keeps losing is proposed for a narrower range. Whether a real Book moves to Playbook mode is decided by its paper Book's gap to its rules-only paper Book, since the Overrides' own scores interact and don't add up (ADR 0004). See the stocks Pipeline PRD's "Reviews".

**Repos:** ash_new, agents

**Blocked by:** 39: The Desk; 35: Weekly review, promotions and demotions

**Status:** done, but for a scorecard on real data: no paper Book has started, so there is no Override yet (see "Not done")

**Waiting on Saransh:** what counts as a paper Book matching its rules-only paper Book. Until then the placeholder is at least its return over the 3 months, with no deeper max drawdown.

- [x] Each Override is scored against its counterfactual: the Rule plan's order, taken from the strategy's own track, until that track closes the position.
  - A veto scores the gain or loss avoided.
  - A trim scores the difference on the part trimmed.
  - An early exit scores what the track made after the exit.
  - A wait scores the price it bought at, or the move it avoided if dropped, against buying on the Rule plan's session.
  - A swap scores the name bought against the one dropped.
  - An exposure cut scores the stocks it sold or didn't buy against the Rule plan's.
  - A size change scores the difference on the part added or cut.
- [x] Each Override is judged on the session its Decision record named when it was made, never a later one.
- [x] The scorecard tallies Overrides per Lever, per analyst and per Lesson: their count, hit rate, and value in currency and in basis points of the Book. It also says whether each Decision record's expectation came true by its review session.
- [x] The weekly review shows the scorecard. When a Lever's Overrides have lost to the Rule plan over the last 3 months, the Portfolio Manager proposes a narrower range for it.
- [x] The scorecard shows the sum of the Overrides' scores beside the paper Book's gap to its rules-only paper Book, and says that the two differ because the Overrides interact.
- [x] Every Saturday the scorecard says whether each paper Book has matched its rules-only paper Book over the last 3 months, on return and on max drawdown. That is the gate for moving its real Book to Playbook mode. The bar is fixed before the 3 months start and isn't moved afterwards.
- [x] Tests: a veto, a trim, an exit, a wait, a swap, an exposure cut and a size change, each scored against a fixture track; the tallies; the gate, from a fixture pair of paper Books.

**Notes:**

- **Scoring** (ash_new's `pdash.judgement.scorecard`, the rules; `pdash.pipeline.scorecard`, reading the app database and the Lake):
  - Each Override is a set of **legs** on each side: shares of a security in a Sleeve that one side held and the other didn't, from the open of the session they traded on (a sale: less than none). A leg ends when its Sleeve's strategy's live track sells the name (a `drop` in the track's trades), at that session's open, as the paper Book's Sleeve would; else on the session the Override is judged on, at its close. Its score is what the legs that went out made less what the Rule plan's would have, in the Book's currency, and in basis points of the paper Book's value when the plan was made.
  - So a veto scores the gain or loss avoided, a trim and a size change the difference on the part cut, a skipped rebalance the trade left out, a swap the name bought against the one dropped, and an exposure cut the stocks it sold or didn't buy. A wait's buys are the releases that bought it (each at its own session's open), so it scores the price it bought at, or the move it avoided if none came by the session it is judged on; a release isn't scored on its own.
  - A buy whose open is over its limit isn't filled on either side. Prices are as traded, before dividends and costs, to the paper Book's last close filled, so the scores and its gap to the rules-only paper Book cover the same closes.
  - A hit is an Override that beat the Rule plan: a tie (a score of exactly nothing) isn't one.
  - A strategy with no stored live track never sells a name, so its legs run to the session they are judged on. So does a swapped-in name the track doesn't hold.
  - **Judged on its own session:** until the data has the session its Decision record named, an Override is `open`, valued to the last close; then it is `judged`, and nothing after counts. An early exit has no Decision record: it is judged once the track has sold the name. One whose strategy has no stored live track stays open, valued to the last close.
  - **"Whether each Decision record's expectation came true":** the expectation is in words, so code reads it as whether the Override beat the Rule plan by its review session (`came_true`), and shows the words beside it. Say if it should be the Portfolio Manager's own reading instead.
- **Recorded for it** (`pd check`): each Override keeps the paper Book's value (migration 0021, `overrides.book_value`), and an exposure cut keeps the Rule plan's orders it cut or dropped (`rule_order.orders`), not only their ids. For these, `pd check` hands the Overrides each paper Book's own plan, where it used to hand them the list as it went out.
- **The scorecard** is in `pd review`'s each Book (`scorecard`, `contract/review.schema.json`), so it comes every Saturday with the weekly review:
  - `overrides`: each one open, or judged in the last 3 months, with its session, kind, Lever, name, the analysts whose views it followed, its Lessons, what it expected, when it is judged, its value and basis points, and whether it came true. An early exit is among them, under `early_exit` (no Lever allows it) and the analyst that proposed it.
  - `tallies`: every Override so far by Lever, by analyst (`none`: the Portfolio Manager's alone) and by Lesson: those judged and open, the hits, the hit rate, and the value in money and basis points.
  - `lost_levers`: each Lever's Overrides judged over the last 3 months, and whether they `lost` to the Rule plan.
  - `sum_and_gap`: the sum of the scores of the Overrides made over the last 3 months beside the paper Book's gap to its rules-only paper Book over the same closes (from their start when they began since), with the note that they differ because the Overrides interact.
  - `gate`: see below.
- **Per Lesson:** Decision records cite no Lessons yet (issue 41). The tally reads a Decision record's `lessons` once it has them, and is empty till then.
- **A narrower range** (agents): the Portfolio Manager gets the scorecard in `review`, and its output has `narrower`: for each Lever that lost, the Book, the Lever, each range narrowed by its name with its new value, and why. Save state proposes each with `pd judgement propose BOOK --playbook NAME=VALUE --why --by "the Portfolio Manager"` (one naming another Lever's range isn't proposed, and says why), keeping what became of it as `narrower.json`; it waits for Saransh's Answer with the other judgement proposals (`judgement:<id>`). Selection and trim have no range to narrow; the instructions say to write what changes instead.
- **Widening only on evidence** (ash_new's `pd judgement propose`): a change of ranges that widens a Lever (a lower exposure floor or least size, a higher most size, a longer wait, a larger rebalance skipped) is refused unless that Lever's Overrides judged over the last 3 months in the Book's paper Book beat the Rule plan. That holds Saransh's own proposals through `pd` too; he can still edit config/books.yaml. The Desk's say has no range to widen yet (the analysts only subtract), so its evidence is the per-analyst tally.
- **The gate:** `config/books.yaml`'s `playbook_gate` holds the bars, each with the day it was fixed (`fixed_on`), a `return_gap` and a `drawdown_gap`. Each Saturday the scorecard takes the 3 calendar months to the two paper Books' last close together, from their last close together on or before the 3 months began, and judges them by the last bar fixed before they began (before that close): the paper Book's return at least the rules-only one's plus `return_gap`, and its max drawdown no deeper than the rules-only one's by more than `drawdown_gap`. A bar fixed after the 3 months began can't judge them (`no_bar`), so a bar is never moved once they start: a new one is added with its own day. Two paper Books younger than 3 months are `too_soon`.
  - **The placeholder bar**, until Saransh sets it, as the issue has it: fixed on 30 October 2026, a return at least the rules-only one's and a max drawdown no deeper (both gaps 0).
  - **It gates the move:** `pd judgement propose BOOK --mode playbook` for a real Book is refused until the gate has judged and passed; the move is still a proposal for Saransh's Answer, which nothing proposes by itself yet. A paper Book's mode isn't gated.
  - Which bar judged is given with the verdict (`bar`, with its `fixed_on`). Nothing stops an existing bar in config/books.yaml being edited in place; adding a new one with its own day is the convention.
- **The Brief:** each paper Book in the weekly review gets an "Override scorecard": the gate, the sum beside the gap with why they differ, each Override open or judged recently, the tallies, and each Lever that lost with the narrower range proposed for it (or why not). The judgement proposals waiting include those Save state made in this Run. The Review Step logs each Book's count, the Levers that lost and the gate.
- **On a copy of the real app database, 30 October 2026:** `pd review --dry-run` runs and validates against its schema; no paper Book has started, so each Book's scorecard is `not_started`.
- **Tests:**
  - **ash_new:**
    - `tests/test_scorecard_rules.py`, against a fixture track and hand-made prices: a veto (a gain given up until the track sold; a loss avoided to the session it is judged on), judged on its own session and open before it, a buy over its limit, a trim, an early exit (judged once the track sold, open while it holds), a wait bought later or dropped (a release after its session left out), a swap, a size change, an exposure cut, a skipped rebalance, a release scored with its wait; the tallies by Lever, analyst and Lesson; a Lever that lost over 3 months; the sum beside the gap; the gate from a fixture pair of paper Books (passed, failed on drawdown, too soon, a bar fixed too late, the last bar fixed before); which Levers a Playbook change widens.
    - `tests/test_scorecard.py`, through `pd check`, the fills and `pd review` on the fixture Lake run on through January 2019: a veto of a falling name scored on its session and tallied beside the gap, the gate too soon, an unstarted Book; an Override open before its session; an exposure cut recorded with the Rule plan's order it cut; a wider size range proposed on a resize that beat the Rule plan, a longer wait refused, a narrower one made; a real Book's move to Playbook mode refused before the gate passes, a paper Book's not.
    - `tests/test_judgement.py`: its Playbook proposal now narrows (a wider one needs the scorecard).
  - **agents:** `test/stocks-brief.test.ts` (the scorecard in the weekly review, a Lever that lost with its narrower range, the proposal waiting for an Answer and saved with the Answers); `test/portfolio-manager.test.ts` (the narrower ranges proposed through `pd judgement propose`, one refused by ash_new and one naming another Lever's range); the review examples in `test/pd` with a scorecard, and `judgement-propose.narrower.json` and `.refused.json`.
- **Code review** (Standards and Spec, in parallel). Fixed:
  - **Spec:** a real Book's move to Playbook mode now needs the gate passed; the bar must be fixed before the 3 months' first close, not only before their calendar start; the scores run to the paper Book's last close filled, as its gap does; this Run's narrower proposals were left out of the saved Answers when the Check Step read no proposals; a narrower proposal naming another Lever's range is refused; these notes said `pd check` had read a leftover variable, which was only true of a draft.
  - **Standards:** a second copy of `EARLY_EXIT` and of the analysts' names (now `judgement.exits`' and `pipeline.dossiers`'); kinds and Levers written as strings beside `final_check`'s constants; an inline plural in the Review Step's log; the Books named by code in logs; unwrapped docstrings; `months_before` without a docstring; `_made` naming two things in two modules (`_leg_made`, `_recorded`); `_row` and `_by` (`_tally_row`, `_tallied_by`); the track's sale looked up twice for an early exit.

  Left as judgement calls:
  - the narrower loop in Save state repeating the promotions loop's shape;
  - the Brief's `overrideKind`, `gateText` and `bp` in the Brief rather than `src/judgement.ts`;
  - a tally's `key` as a string (a Lever, an analyst or a Lesson), and the analyst read from an early exit's proposer (`by`), as the Desk Step words it;
  - the Desk's say: the analysts only subtract, so there is nothing of theirs to widen; the per-analyst tally is its evidence.
- **Not done:**
  - **On real data:** no strategy is in Paper, so no paper Book has started and there is no Override to score.
  - **For Saransh:**
    - the bar for the gate (the placeholder above), and whether one bar serves all three Books;
    - "came true" read as beating the Rule plan by the review session;
    - a widening refused for Saransh's own `pd judgement propose` too, unless the scorecard supports it.
