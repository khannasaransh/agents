# 11: Docs Agent: PRD inbox

**What to build:** Every file in the PRD inbox, whether it came from Discord or Saransh dropped it in, becomes a PRD page on the docs branch through the wiki's PRD skill, and leaves the inbox once handled. See the PRD's Docs Step.

**Blocked by:** 10: Docs Agent: wiki updates from commits

**Status:** done

- [x] The Docs Agent takes every file in the PRD inbox each Run.
- [x] For each file it decides whether it is a PRD and which Codebase it belongs to, copies it into that Codebase's PRD sources on the docs branch, and writes the PRD page with the wiki's PRD skill.
- [x] A PRD that came from Discord cites the Discord message link in its page's sources: the inbox's `sources.json` has it, by file name (see ticket 09).
- [x] Processed files move to a done area and files that aren't PRDs to a skipped area, so the inbox shows only what's waiting. Their `sources.json` entries stay, with where the file went, so the Discord Step never saves them again.
- [x] PRD pages follow the same wiki rules, commit trailers and check gate as ticket 10.
- [x] The Brief lists the PRDs processed and the files skipped.
- [x] Step tests cover a PRD, a file that isn't a PRD, and an empty inbox.

**Notes:**

- The Step stages the inbox's waiting files (every top-level file but `sources.json` and hidden files) in the Agent's worktree at `_runs/prds/inbox/`, and removes them before committing. It pins every Repo fetched in the Run at its head in a pins file in the Run folder, out of the Agent's reach and off the docs branch.
- The Agent can't copy a binary file or run `docx2md` under Claude Code, so its `prd` Tool does both: `prd convert` renders a Word file as Markdown for reading, and `prd add` copies the file into `_sources/<codebase>/PRD/` and converts it into `_runs/prds/<feature>/`.
- The Agent follows the wiki's `prd-to-wiki` skill with its Saransh checkpoints, fetching, subagents, viewer sweep and accept step left out; the instructions say how.
- The Step rejects the Agent's edits, committing nothing, if the Agent deletes anything, adds files outside the PRD pages, their folder indexes and `_runs/prds/`, or writes a PRD copy that isn't a waiting inbox file, byte for byte, in a Codebase with a `_sources/` folder. With nothing waiting, it may add nothing, as before.
- The Step adds the Discord message link to each PRD page's `sources`. It commits the copies first, in their own commit, since the wiki's stamp sets a `wiki@` source's commit only for a committed file. Then it runs the regions tool, stamps and checks PRD pages at the PRD pins and other pages at the Run's pins, and commits the rest.
- A PRD counts as done only when its page and its copy are both in the Agent's edits. A PRD the Agent names without them stays in the inbox.
- Files move only once the Run's wiki work is committed, or when the Agent changed no page: into `data/prd-inbox/done/` or `skipped/`, under a free name there. A dry run moves nothing. Each file's `sources.json` entry moves to the key `done/<name>` or `skipped/<name>`, so a later file with the same name can't overwrite it.
- `skipped/` holds every file the Agent didn't turn into a PRD page: files that aren't PRDs, PRDs whose Codebase the wiki lacks, and old `.doc` files. The Brief gives each one's reason. Saransh moves a file back into the inbox to have it tried again.
