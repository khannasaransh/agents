# 37: India Feeds and the dossiers

**What to build:** For the names the Desk will review, the Pipeline fetches India's company events and builds a dossier per name, covering everything the Desk may read. The Brief shows coming events for the holdings. See the stocks Pipeline PRD's Feeds Step and "Feeds and dossiers".

**Repos:** ash_new, agents

**Blocked by:** 32: Rule plan for the paper Books

**Status:** ready-for-agent

- [ ] `pd plan` lists the names the Desk reviews: the Rule plan's buys and sales, plus the holdings with results or another event in the next 5 sessions.
- [ ] `pd feeds` fetches, for those names and the holdings in India:
  - NSE's and BSE's corporate announcements;
  - board meetings, which give results dates;
  - pledges.

  It caches what it has fetched before. Each event has a date, a kind and a link to its source.
- [ ] A source that fails skips itself with a To-do, since these endpoints need browser-like headers and change without notice.
- [ ] `pd plan` writes a dossier for each name the Desk reviews:
  - about a year of daily bars, with volume, RS and the distance from its 52-week high;
  - MarketSmith's snapshot;
  - fundamentals;
  - its events;
  - the strategy and signal behind its order.
- [ ] A Feeds Step runs after the Plan Step, and the Brief shows coming events for the holdings.
- [ ] Tests run on recorded responses, never the network:
  - parsing each source;
  - the cache;
  - a failing source;
  - the review list.
