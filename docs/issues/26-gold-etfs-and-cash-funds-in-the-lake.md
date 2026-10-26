# 26: Gold ETFs and cash funds in the Lake

**What to build:** The Lake has what the Books hold besides stocks: a gold ETF in each market, a liquid ETF as India's cash fund and a T-bill ETF as the US's. The daily chain refreshes them, and backtests can hold them. See the stocks Pipeline PRD's "The Book engine".

**Repos:** ash_new · **Mirrored in:** ash_new ticket 53 (keep both in step)

**Blocked by:** 15: Fix the stuck refresh and the dying process pool

**Status:** ready-for-agent

**The Hong Kong Book holds the US Book's gold ETF and cash fund** (Saransh, 26 October 2026; issue 48), in dollars: nothing is chosen for Hong Kong. Its backtest values them in Hong Kong dollars at each day's rate (the peg keeps the rate within 7.75–7.85), and its cash fund earns the US's risk-free rate.

- [ ] Each Book's gold ETF and cash fund are chosen for the longest clean price history, and the choices are recorded in ash_new's config.
- [ ] Their prices are in the Lake, and the daily chain refreshes them.
- [ ] A backtest can hold them. In a backtest the cash fund earns the region's risk-free rate, since a liquid ETF's price doesn't show its return.
- [ ] Tests: the instruments are refreshed with the rest, and a backtest holding the cash fund earns the risk-free rate.
