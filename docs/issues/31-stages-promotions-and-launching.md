# 31: Stages, promotions and launching

**What to build:** Each Book's Sleeves and their Stages are recorded, and Saransh moves Candidates into Paper with an Answer. Entering Paper launches the strategy in ash_new, so its live track starts that day. See the stocks Pipeline PRD's "Strategies and Stages" and "The Book engine".

**Repos:** ash_new, agents

**Blocked by:** 30: The Candidate test; 21: Answers in the Brief

**Status:** ready-for-agent

- [ ] ash_new's app database keeps each Book's Sleeves and their Stages, with every change's date and who approved it. Only `pd` commands change them.
- [ ] The Candidate report's Candidates appear in the Brief as items, and an Answer approves a Candidate into Paper.
- [ ] Entering Paper launches the strategy in ash_new, starting its live track that day.
- [ ] Each Sleeve names its strategy's version. A strategy whose rules, parameters or code hash change is a new version, and starts as a Candidate. The old one keeps its Stage until the new one replaces it.
- [ ] A Retired strategy's Sleeve buys nothing new and winds down through the strategy's own exits.
- [ ] The Brief shows each Book's Sleeves with their Stages and how long each has been in its Stage.
- [ ] Tests:
  - approving a Candidate records the Stage and launches the strategy;
  - a changed strategy starts as a Candidate;
  - a Retired Sleeve only sells.
