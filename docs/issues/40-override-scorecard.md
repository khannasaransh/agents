# 40: Override scorecard

**What to build:** Every Override is scored against what the Rule plan alone would have done, and the weekly review shows the tally. The Desk earns more say only on evidence. See the stocks Pipeline PRD's "Reviews".

**Repos:** ash_new, agents

**Blocked by:** 39: The Desk; 35: Weekly review, promotions and demotions

**Status:** ready-for-agent

- [ ] Each Override is scored against its counterfactual: the Rule plan's order, taken from the strategy's own track, until that track closes the position.
  - A veto scores the gain or loss avoided.
  - A trim scores the difference on the part trimmed.
  - An early exit scores what the track made after the exit.
- [ ] The scorecard tallies Overrides per analyst and per Lesson: their count, hit rate, and value in currency and in basis points of the Book.
- [ ] The weekly review shows the scorecard.
- [ ] Tests: a veto, a trim and an exit, each scored against a fixture track, and the tallies.
