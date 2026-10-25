# 37: India Feeds and the dossiers

**What to build:** For the names the Desk will review, the Pipeline fetches India's company events and builds a dossier per name, covering everything the Desk may read. The Brief shows coming events for the holdings. See the stocks Pipeline PRD's Feeds Step and "Feeds and dossiers".

**Repos:** ash_new, agents

**Blocked by:** 32: Rule plan for the paper Books

**Status:** ready-for-agent

- [ ] `pd plan` lists the names the Desk reviews: the Rule plan's buys and sales, plus the holdings with results or another event in the next 5 sessions. For each name it says which analysts it needs, and why:
  - Events, for a name with results or another event in the next 5 sessions, or with a new event since its last view;
  - Chart, for each buy;
  - Risk, for each Book with buys, over all of them.

  A sale needs no analyst, since the Desk can't stop one.
- [ ] `pd feeds` fetches, for those names and the holdings in India:
  - NSE's and BSE's corporate announcements;
  - board meetings, which give results dates;
  - pledges.

  It caches what it has fetched before. Each event has its date, its kind, the time it was fetched and a link to its source. A Decision record may cite only events fetched before its Run.
- [ ] A source that fails skips itself with a To-do, since these endpoints need browser-like headers and change without notice.
- [ ] `pd plan` writes a dossier for each name the Desk reviews:
  - about a year of daily bars, with volume, RS and the distance from its 52-week high;
  - MarketSmith's snapshot;
  - fundamentals;
  - its events;
  - the strategy and signal behind its order.

  The dossier holds a copy of what it read, not a pointer to MarketSmith's latest fetch, so a Decision record can be checked against it later. Issue 22 keeps each MarketSmith fetch as a dated snapshot; `pdash.marketsmith.snapshots.snapshot_of` gives a name's entry with the snapshot's id, for the dossier to name.
- [ ] A Feeds Step runs after the Plan Step, and the Brief shows coming events for the holdings.
- [ ] Tests run on recorded responses, never the network:
  - parsing each source;
  - the cache;
  - a failing source;
  - the review list, and the analysts each name needs.
