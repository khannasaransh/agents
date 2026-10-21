# 09: PRDs from Discord

**What to build:** PRD files posted in the watched channels land in the PRD inbox on their own, and PRD links the Pipeline can't download (such as Google Docs) show up in the Brief as To-dos for Saransh to download and drop into the PRD inbox himself. See the PRD's Discord Step and "Discord and PRDs" stories.

**Blocked by:** 08: Discord Step

**Status:** ready-for-agent

- [ ] Word, PDF and Markdown attachments in the watched channels are saved into the PRD inbox with the link of the message they came from.
- [ ] A file already in the PRD inbox from an earlier Run isn't saved twice.
- [ ] Links that need a login, such as Google Docs, are recorded and listed in the Brief's To-dos with the message they came from.
- [ ] The PRD inbox lives in the git-ignored data area and Saransh can drop files into it by hand.
- [ ] Step tests run against recorded API responses with attachments and links.
