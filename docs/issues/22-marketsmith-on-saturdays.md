# 22: MarketSmith on Saturdays

**What to build:** MarketSmith's fetch moves from ash_backend into ash_new, and each Saturday's Run uses it before the Lake refresh, so fundamentals are never more than a week old. Each fetch is kept as a dated snapshot, so a Decision record that cites a rating can be checked later. An expired cookie costs a To-do, never a failed Run. ash_backend's Portfolio Manager and Sash's `PM_BUY` alerts are turned off. See the stocks Pipeline PRD's MarketSmith Step and "ash_backend".

**Repos:** ash_new, ash_backend, agents · **Mirror:** not yet in ash_new's tickets

**Blocked by:** 17: Stocks Pipeline skeleton: the Lake Step and a data-status Stocks Brief

**Status:** ready-for-agent

- [ ] `pd marketsmith` fetches MarketSmith's India and US data, as ash_backend's `fetch` job kind does, and writes the raw store that ash_new already reads. It exits 78 when MarketSmith rejects a cookie.
- [ ] Each fetch is also kept as a dated snapshot of the ratings, flags and estimates, and a dossier names the snapshot its figures came from. This takes up what ash_new's parked ticket 49 deferred.
- [ ] MarketSmith's cookies move to ash_new's env file. Only `pd marketsmith` reads them.
- [ ] A MarketSmith Step runs before the Lake Step on Saturdays, and skips itself on other days.
- [ ] An expired cookie skips the Step and gives a To-do naming the cookie.
- [ ] The Saturday refresh builds fundamentals from the new fetch.
- [ ] ash_backend's Portfolio Manager agent and Sash's `PM_BUY` alerts are turned off. ash_backend's own timer keeps running for the Sash app until Saransh decides on the app; then ash_backend is archived.
- [ ] Tests:
  - **ash_new:** a fetch parsed from recorded responses, never the network, writes the raw store and a dated snapshot; a rejected cookie exits 78.
  - **agents:** the Step skips itself on a weekday; a stand-in `pd marketsmith` that exits 78 becomes a skip with a To-do; a successful fetch is recorded.
