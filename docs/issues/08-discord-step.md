# 08: Discord Step

**What to build:** Once Saransh adds a bot token, channel list and his Discord user ID to the local env file, each Run reads the watched channels and threads through a read-only bot and the Brief shows the messages that mention him. Until then the Step is skipped cleanly. See the PRD's Discord Step.

**Blocked by:** 01: Run skeleton: fetch and list new commits

**Status:** done

- [x] The local, git-ignored env file holds the bot token, the channel list and Saransh's Discord user ID.
- [x] Without that configuration the Discord Step is recorded as skipped, not failed, and the Run is otherwise unaffected.
- [x] The Step reads the configured channels and their threads over Discord's REST API with a bot token, waiting out rate limits.
- [x] It covers messages since the last successful Discord read, or the last 24 hours on the first Run, and records the new read time only on success.
- [x] Messages are written to the Run folder with mentions of Saransh flagged.
- [x] It never uses Saransh's own account, so it never sees his DMs. DMs with the bot are read and shown in the Brief unless `DISCORD_READ_DMS=false`.
- [x] The Brief has a Discord section listing messages that mention Saransh, and the PM Agent receives the messages as input when it exists.
- [x] Step tests run against recorded API responses, never the network.

Still waiting on Saransh: the bot itself, its installation on the company server by someone with Manage Server, the Message Content intent, and the list of channels.
