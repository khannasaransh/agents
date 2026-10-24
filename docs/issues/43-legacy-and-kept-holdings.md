# 43: Legacy and Kept holdings

**What to build:** What Saransh already holds comes into the Books. Anything he marks kept stays outside them, and the rest is wound down as the Sleeves need the cash, at as little tax as possible. See the stocks Pipeline PRD's "Legacy and kept holdings" and "The Book engine".

**Repos:** ash_new, agents

**Blocked by:** 42: Real Books' Order lists and order states

**Status:** ready-for-agent

- [ ] On a real Book's first import, every holding no strategy bought becomes a Legacy holding. The Brief asks whether to keep each one.
- [ ] A keep Answer makes it a Kept holding. A Kept holding is outside the Book and never sold, but it counts toward the 15% position cap when a strategy buys the same stock.
- [ ] Legacy holdings are sold to pay for the Sleeves' buys: losses first, then gains. A winner within two months of turning long-term (12 months in India, 24 in the US) is held until it has.
- [ ] Tests:
  - the first import marks Legacy holdings;
  - a Kept holding is never sold, and is counted toward the cap;
  - Legacy holdings are sold in the right order;
  - a winner near long-term waits.
