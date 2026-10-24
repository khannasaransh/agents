# 38: US Feeds

**What to build:** US names get Feeds too: SEC EDGAR filings and Yahoo's earnings dates, in the same shape as India's. Their dossiers carry them. See the stocks Pipeline PRD's "Feeds and dossiers".

**Repos:** ash_new · **Mirrored in:** ash_new ticket 58 (keep both in step)

**Blocked by:** 37: India Feeds and the dossiers

**Waiting on Saransh:** the contact for the SEC's required User-Agent.

**Status:** ready-for-agent

- [ ] `pd feeds` fetches SEC EDGAR filings (8-K, 10-Q, 10-K, Form 4) for the US names.
  - It sends the User-Agent contact Saransh sets. The agents repo's env file passes it to `pd`, and it isn't filled in by default.
  - It stays within the SEC's fair-access rate.
- [ ] It fetches Yahoo's earnings dates for the US names.
- [ ] The events have the same shape and caching as India's, and the dossiers include them.
- [ ] Without the User-Agent contact, EDGAR skips itself with a To-do.
- [ ] Tests run on recorded responses, never the network: parsing, the cache, and the skip when the contact is missing.
