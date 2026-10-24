# 22: MarketSmith on Saturdays

**What to build:** Each Saturday's Run fetches MarketSmith's India and US data through ash_backend before the Lake refresh, so fundamentals are never more than a week old. An expired cookie costs a To-do, never a failed Run. ash_backend's Portfolio Manager and Sash's `PM_BUY` alerts are turned off. See the stocks Pipeline PRD's MarketSmith Step and "ash_backend".

**Repos:** ash_backend, agents

**Blocked by:** 17: Stocks Pipeline skeleton: the Lake Step and a data-status Stocks Brief

**Status:** ready-for-agent

- [ ] ash_backend gets a command that runs its `fetch` job kind outside the API for India and the US. It writes to the raw store as the job does, and exits 78 when MarketSmith rejects a cookie.
- [ ] A MarketSmith Step runs before the Lake Step on Saturdays, and skips itself on other days.
- [ ] An expired cookie skips the Step and gives a To-do naming the cookie. Only ash_backend reads MarketSmith's cookies, from its own env file.
- [ ] The Saturday refresh builds fundamentals from the new fetch.
- [ ] ash_backend's Portfolio Manager agent and Sash's `PM_BUY` alerts are turned off.
- [ ] Step tests:
  - it skips itself on a weekday;
  - a stand-in fetch that exits 78 becomes a skip with a To-do;
  - a successful fetch is recorded.
