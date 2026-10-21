# 11: Docs Agent: PRD inbox

**What to build:** Every file in the PRD inbox, whether it came from Discord or Saransh dropped it in, becomes a PRD page on the docs branch through the wiki's PRD skill, and leaves the inbox once handled. See the PRD's Docs Step.

**Blocked by:** 10: Docs Agent: wiki updates from commits

**Status:** ready-for-agent

- [ ] The Docs Agent takes every file in the PRD inbox each Run.
- [ ] For each file it decides whether it is a PRD and which Codebase it belongs to, copies it into that Codebase's PRD sources on the docs branch, and writes the PRD page with the wiki's PRD skill.
- [ ] A PRD that came from Discord cites the Discord message link in its page's sources.
- [ ] Processed files move to a done area and files that aren't PRDs to a skipped area, so the inbox shows only what's waiting.
- [ ] PRD pages follow the same wiki rules, commit trailers and check gate as ticket 10.
- [ ] The Brief lists the PRDs processed and the files skipped.
- [ ] Step tests cover a PRD, a file that isn't a PRD, and an empty inbox.
