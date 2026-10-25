# 40: Override scorecard

**What to build:** Every Override is scored against what the Rule plan alone would have done, and the weekly review shows the tally by Lever. A Lever's range and the Desk's say widen only on evidence, and a Lever that keeps losing is proposed for a narrower range. See the stocks Pipeline PRD's "Reviews".

**Repos:** ash_new, agents

**Blocked by:** 39: The Desk; 35: Weekly review, promotions and demotions

**Status:** ready-for-agent

- [ ] Each Override is scored against its counterfactual: the Rule plan's order, taken from the strategy's own track, until that track closes the position.
  - A veto scores the gain or loss avoided.
  - A trim scores the difference on the part trimmed.
  - An early exit scores what the track made after the exit.
  - A wait scores the price it bought at, or the move it avoided if dropped, against buying on the Rule plan's session.
  - A swap scores the name bought against the one dropped.
  - An exposure cut scores the stocks it sold or didn't buy against the Rule plan's.
  - A size change scores the difference on the part added or cut.
- [ ] The scorecard tallies Overrides per Lever, per analyst and per Lesson: their count, hit rate, and value in currency and in basis points of the Book. It also says whether each Decision record's expectation came true by its review session.
- [ ] The weekly review shows the scorecard. When a Lever's Overrides have lost to the Rule plan over the last 3 months, the Portfolio Manager proposes a narrower range for it.
- [ ] Every Saturday the scorecard says whether each paper Book's Overrides have at least matched the Rule plan over the last 3 months, which is the gate for moving its real Book to Playbook mode.
- [ ] Tests: a veto, a trim, an exit, a wait, a swap, an exposure cut and a size change, each scored against a fixture track; the tallies; the gate.
