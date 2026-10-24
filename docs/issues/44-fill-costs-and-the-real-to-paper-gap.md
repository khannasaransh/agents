# 44: Fill costs and the real-to-paper gap

**What to build:** The weekly review shows what Saransh's fills cost against the open price at each broker, and how far each real Book trails its paper Book. Real slippage then corrects the cost presets, and the cost of skips and Stages is visible. See the stocks Pipeline PRD's "Reviews".

**Repos:** ash_new, agents

**Blocked by:** 42: Real Books' Order lists and order states; 35: Weekly review, promotions and demotions

**Status:** ready-for-agent

- [ ] For each broker, the weekly review compares each fill with its session's open price, against the slippage the cost presets assume. It flags a broker whose fills cost more.
- [ ] It shows each real Book's gap to its paper Book, split into fills, skips and Stage scaling.
- [ ] Tests:
  - the cost of a fill against the open;
  - the flag;
  - a gap split that adds up.
