# 29: Book backtest: Disaster stops and Stage scaling

**What to build:** The Book backtest tests the Disaster stops held at the broker, on daily bars. It also holds each Sleeve at its Stage's share, so both a real Book and a paper Book can be backtested. See the stocks Pipeline PRD's "The Book engine".

**Repos:** ash_new · **Mirrored in:** ash_new ticket 56 (keep both in step)

**Blocked by:** 27: Book backtest: Sleeves, gold and the cash fund

**Status:** ready-for-agent

- [ ] Every new position gets a Disaster stop at twice its strategy's stop distance, or 15% below entry where the strategy has no stop.
- [ ] Each week's last session raises the stop to the same distance below that session's close. A stop is never lowered.
- [ ] On daily bars, a low at or under the stop sells at the stop, or at the open when the price opens below it.
- [ ] Strategy exits stay end-of-day, as each strategy's spec says.
- [ ] Stage scaling:
  - in a real Book, a Paper strategy holds nothing, a Real-small one a quarter of its share and a Real-full one all of it, with the rest in the cash fund;
  - a paper Book holds every strategy from Paper up at its full share.
- [ ] Tests:
  - a stop is touched intraday;
  - the price gaps through a stop;
  - a stop is raised on the week's last session, and never lowered;
  - each Stage is scaled correctly in a real and in a paper Book.
