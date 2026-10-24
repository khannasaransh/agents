# 36: Monthly review with attribution

**What to build:** On the first Saturday of each month, the review says where each Book's return came from and reviews its risk. See the stocks Pipeline PRD's "Reviews".

**Repos:** ash_new, agents

**Blocked by:** 35: Weekly review, promotions and demotions

**Status:** ready-for-agent

- [ ] `pd review` attributes each Book's return over the month to its sources, which add up to the total:
  - Sleeve weights;
  - picks within Sleeves;
  - gold;
  - cash;
  - costs;
  - Overrides;
  - for the US Book in INR, the currency.
- [ ] It also reports:
  - the correlation between Sleeves;
  - each Book's drawdown against its limits;
  - the promotions due.
- [ ] The Portfolio Manager writes the monthly commentary in that Saturday's Brief.
- [ ] Tests:
  - attribution adds up to the Book's return;
  - a month with no Overrides attributes nothing to them;
  - the US Book's currency part matches the dollar's move.
