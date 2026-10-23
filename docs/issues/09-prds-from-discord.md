# 09: PRDs from Discord

**What to build:** PRD files posted in the watched channels land in the PRD inbox on their own, and PRD links the Pipeline can't download (such as Google Docs) show up in the Brief as To-dos for Saransh to download and drop into the PRD inbox himself. See the PRD's Discord Step and "Discord and PRDs" stories.

**Blocked by:** 08: Discord Step

**Status:** done

- [x] Word, PDF and Markdown attachments in the watched channels are saved into the PRD inbox with the link of the message they came from.
- [x] A file already in the PRD inbox from an earlier Run isn't saved twice.
- [x] Links that need a login, such as Google Docs, are recorded and listed in the Brief's To-dos with the message they came from.
- [x] The PRD inbox lives in the git-ignored data area and Saransh can drop files into it by hand.
- [x] Step tests run against recorded API responses with attachments and links.

**Notes:**

- The inbox is `data/prd-inbox/`. Its `sources.json` maps each file the Discord Step saved, by its name in the inbox, to `{ message, attachment }`: the Discord message link and the attachment ID. A hand-dropped file has no entry.
- An attachment is saved once: one already in `sources.json` isn't downloaded again. Issue 11's Docs Agent must keep an entry when it moves a file to the done or skipped area, so a re-read never brings the file back.
- Login-only links are on each message in `discord.json` as `prdLinks`, and the PM Agent turns each into a To-do with the message link. The Brief shows them through the PM output, so they're missing from a Brief whose PM call failed.
- A dry run saves nothing into the inbox; each message's `prdFiles` still lists its PRD attachments.
