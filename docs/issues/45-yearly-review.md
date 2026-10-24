# 45: Yearly review

**What to build:** On the first Saturday of April, the review chooses strategies again and re-weights the Sleeves. It also says where new money goes and revisits the India/US split. Each change is a proposal Saransh approves with an Answer. See the stocks Pipeline PRD's "Reviews".

**Repos:** ash_new, agents

**Blocked by:** 35: Weekly review, promotions and demotions; 30: The Candidate test

**Status:** ready-for-agent

- [ ] On the first Saturday of April, `pd review` adds the yearly figures:
  - the Candidate test re-run for every strategy;
  - new Sleeve weights;
  - where the year's new money goes;
  - the India/US split.
- [ ] Each is a Brief item, applied only on an approving Answer.
- [ ] Between yearly reviews, nothing re-weights Sleeves or chooses strategies again.
- [ ] Tests:
  - the yearly figures appear only on that Saturday;
  - nothing applies without an Answer;
  - approved weights take effect in the next Rule plan.
