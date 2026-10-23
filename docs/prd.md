# Local agent Pipeline

Status: ready-for-agent

## Problem Statement

Saransh tracks 29 company Repos across seven Teams, a busy company Discord server, a stream of PRDs, and an org wiki he maintains alone. Keeping up means pulling each Repo by hand, reading new commits, scrolling Discord for anything aimed at him, and remembering which wiki pages the new code or PRDs have made stale. None of that happens reliably every day, so reviews get skipped, requests in Discord get missed, and the wiki drifts from the code.

He already pays for three coding-agent CLIs (Claude Code, Codex and Antigravity) that can do the judgment-heavy parts headlessly, but nothing ties them together. Existing tools don't fit. Vercel Eve can't use those CLIs on his subscriptions or reach his local Repos. Multi-agent session managers (Conductor, claude-squad, Superset) are for steering sessions by hand. Dagu would work but adds a daemon he doesn't need yet.

## Solution

A local agent system in its own repo, run by one command or by a Schedule. Every weekday at 03:00 IST a daily Pipeline runs on his Mac:

1. It fetches every Repo, without ever touching his working copies.
2. It reviews each Repo's new commits with a Reviewer Agent.
3. It collects Discord messages and any PRD files posted there.
4. It runs a PM Agent that sums up the day.
5. It runs a Docs Agent that updates the org wiki on a branch from the new commits and PRDs.
6. It writes a Brief: one Markdown file, for Saransh alone, waiting for him when he starts his day.

Each Agent is a folder laid out like an Eve agent, with instructions, config, Tools, skills and Memory. Its config names the Worker (Claude Code, Codex or Antigravity) that runs it on his own subscription. The Pipeline itself is plain code, because its order never changes. Agents are used only at the Steps that need judgment. Every Step is a standalone command with files in and files out, so Dagu can take over scheduling later without rewriting any Step.

The same repo also sets up a new machine, Mac or Windows. It clones the Repos by Team and installs the Workers' config.

## User Stories

### Running the Pipeline

1. As Saransh, I want the daily Pipeline to run by itself every weekday at 03:00 IST, so that the Brief is ready before I start work.
2. As Saransh, I want a missed Run to happen when the Mac next wakes, so that a sleeping laptop costs me a delay, not a day.
3. As Saransh, I want to start the daily Pipeline by hand with one command, so that I can get a fresh Brief whenever I want.
4. As Saransh, I want to run a single Step inside an existing Run, so that I can retry or tune one part without redoing the rest.
5. As Saransh, I want a dry run that exercises every Step with a fake Worker, so that I can check the Pipeline without spending any quota.
6. As Saransh, I want a second Run to refuse to start while one is already running, so that two Runs never fight over the same Repos or wiki branch.
7. As Saransh, I want each Run to have its own folder named by date and start time, so that I can find any day's inputs and outputs at a glance.
8. As Saransh, I want Run folders never to be deleted automatically, so that I decide when to prune them by month or year.
9. As Saransh, I want a failed Step not to stop the other Steps, so that one broken source still leaves me a useful Brief.
10. As Saransh, I want a Run with failed Steps to be marked partial, so that I can tell a complete day from an incomplete one.
11. As Saransh, I want every Step to write its own log in the Run folder, so that I can see why something failed without rerunning it.
12. As Saransh, I want re-running a Step to skip work whose output already exists unless I force it, so that retries are cheap and safe.

### Repos and Teams

13. As Saransh, I want one Repo list that names every Repo with its Team, remote, local folder and production branch, so that the Pipeline and machine setup share one source of truth.
14. As Saransh, I want only company Repos in that list, with personal repos, repos without a remote and SDK clones left out, so that reviews cover the work that matters.
15. As Saransh, I want each Repo's production branch recorded explicitly, so that reviews follow what ships even when my checkout is on another branch.
16. As Saransh, I want the Pipeline to fetch Repos and never pull, so that my uncommitted changes and feature branches are never disturbed.
17. As Saransh, I want a Repo that fails to fetch to be reported and skipped, so that one bad remote doesn't block the other Repos.
18. As Saransh, I want git never to prompt for credentials during a Run, so that an unattended Run can't hang waiting for input.
19. As Saransh, I want the Brief grouped by Team, so that I read the mobile, backend and data changes as separate blocks.

### Reviews

20. As Saransh, I want each Repo with new commits on its production branch to get one review per Run, so that I see every change exactly once.
21. As Saransh, I want a review to cover all commits since the last reviewed commit for that Repo, so that nothing slips between Runs.
22. As Saransh, I want the Reviewer to read a clean copy of the production branch at the new commit, never my working files, so that its findings match what actually shipped.
23. As Saransh, I want the clean copy removed after the review, so that my clones carry no leftovers.
24. As Saransh, I want the Reviewer to run read-only, so that a review can never change a Repo.
25. As Saransh, I want each finding to carry severity, file, line, commit, author and a one-line summary, so that I can triage findings without opening the diff.
26. As Saransh, I want findings on commits I wrote to be marked, so that I see my own fixes first.
27. As Saransh, I want reviews to run on a different model from the one that usually writes the code, so that the review is a genuine second opinion.
28. As Saransh, I want the last reviewed commit to advance only for Repos whose review succeeded, so that a failed review is retried in the next Run.
29. As Saransh, I want the Reviewer to remember each Repo's conventions and the findings I've waved off, so that it stops repeating noise.
30. As Saransh, I want the first Run to record each Repo's current head without reviewing its whole history, so that day one doesn't review years of commits.

### Discord and PRDs

31. As Saransh, I want the Pipeline to read the Discord channels I choose through a read-only bot, so that I keep up without scrolling.
32. As Saransh, I want the Discord Step to be skipped cleanly until the bot is set up, so that the rest of the Pipeline works from day one.
33. As Saransh, I want messages that mention me to be flagged, so that requests aimed at me surface first.
34. As Saransh, I want PRD files attached in the watched channels saved to the PRD inbox, so that new PRDs reach the wiki without me copying them.
35. As Saransh, I want PRD links I have to download by hand (such as Google Docs) to show up as To-dos, so that I know exactly what to fetch.
36. As Saransh, I want to drop PRD files I downloaded into the PRD inbox, so that they go through the same path as Discord attachments.
37. As Saransh, I want processed PRD files moved out of the inbox, and files that aren't PRDs set aside, so that the inbox shows only what's still waiting.
38. As Saransh, I want the Pipeline never to use my own account or read my own DMs, so that nothing breaks Discord's terms or risks my account. DMs people send to the bot are read, and appear in the Brief, unless I turn that off.

### PM Agent and the Brief

39. As Saransh, I want a PM Agent to turn reviews, commits and Discord messages into a line per Repo, Discord highlights and To-dos, so that I get the day's meaning, not raw data.
40. As Saransh, I want the PM Agent to carry open items from earlier Runs in its Memory, so that unfinished things don't vanish after one day.
41. As Saransh, I want the Brief written by a fixed command from the Agents' outputs, so that it looks the same every day and still gets written when an Agent fails.
42. As Saransh, I want the Brief to list which Steps failed or were skipped, so that I know which parts of the day are missing.
43. As Saransh, I want the Brief to list wiki drafts and the docs branch waiting for my review, so that wiki work doesn't pile up unseen.
44. As Saransh, I want the Brief to list undocumented Repos that changed a lot, so that I can decide when to document them.
45. As Saransh, I want the Brief to show how many Repos were reviewed, so that I can see what each Run costs.
46. As Saransh, I want no notification or posting anywhere, so that the Brief stays a private file I open when I choose.

### Docs Agent and the wiki

47. As Saransh, I want a Docs Agent to update existing wiki pages whose sources cite files changed by new commits, so that the wiki keeps up with the code.
48. As Saransh, I want the Docs Agent to turn each PRD in the inbox into a PRD page with the wiki's PRD skill, so that PRDs are documented the same way every time.
49. As Saransh, I want a PRD page made from a Discord attachment to cite the Discord message as where the copy came from, so that its origin is traceable.
50. As Saransh, I want the Docs Agent never to use Discord messages as a source of wiki facts, so that the wiki rests only on code and PRDs.
51. As Saransh, I want the Docs Agent never to document a Repo for the first time, so that first-time documentation stays a deliberate job I run myself.
52. As Saransh, I want the Docs Agent to work in its own copy of the wiki, so that my checkout and any edits in progress are never touched.
53. As Saransh, I want its work on one rolling branch that it keeps adding to until I merge, so that each day builds on the last instead of conflicting with it.
54. As Saransh, I want the Docs Agent to bring in my latest wiki changes before it starts, and to stop and tell me on a conflict, so that it never overwrites my work.
55. As Saransh, I want its commits made under my identity with trailers naming the Agent and the Run, so that I can trace every change back to its Run.
56. As Saransh, I want its pages left as drafts and the wiki's own stamp, region and check tools run until they report no errors, so that its work meets the wiki's rules before I review it.
57. As Saransh, I want the Docs Agent never to push or merge, so that nothing reaches the wiki's main line without my review.

### Agents, Workers, Tools, Memory

58. As Saransh, I want each Agent to be a folder with its instructions, config, Tools, skills and Memory, so that I can read or change one Agent without touching code.
59. As Saransh, I want an Agent's config to name its Worker, model, effort, permissions, inputs, outputs and output schema, so that its behavior is declared, not buried in code.
60. As Saransh, I want each Agent to name a fallback Worker, so that a quota limit or outage on one subscription doesn't cost me the Step.
61. As Saransh, I want Antigravity used only as a fallback for now, so that its known headless bugs can't break a normal Run.
62. As Saransh, I want the same instructions to run on any of the three Workers, so that I can move an Agent to another Worker by changing one setting.
63. As Saransh, I want Agents that return data to have their answers checked against a schema, so that later Steps can rely on the shape.
64. As Saransh, I want every Agent call capped by a timeout and a maximum number of turns, so that a stuck Worker can't hold up the Run.
65. As Saransh, I want an Agent to run only the Tools it declares, plus its Worker's built-in reading and searching, so that I know exactly what each Agent can do.
66. As Saransh, I want an Agent's skills given to its Worker without copying anything into the Repo or wiki it works in, so that those folders stay untouched.
67. As Saransh, I want Agents to propose Memory changes in their output, and the Step to apply them, or, for an Agent I set that way, to wait for me to accept or reject each one, so that every change to Memory is logged with its Run and I choose how much to trust each Agent with its own Memory.

### Setup on a new machine

68. As Saransh, I want one setup command that works on Mac and Windows, so that a new machine matches this one without following a long manual guide.
69. As Saransh, I want setup to clone each Repo into a folder named for its Team, on its production branch, so that a new machine has the same layout.
70. As Saransh, I want to set up only some Teams, so that a machine for one kind of work doesn't carry every Repo.
71. As Saransh, I want setup to install the Workers' config from this repo, so that Claude Code, Codex and Antigravity behave the same on every machine.
72. As Saransh, I want setup to check that the tools the Pipeline needs are installed, so that missing pieces show up before the first Run.
73. As Saransh, I want setup to print a checklist of what it can't do (SDKs, IDEs, secrets, non-Repo folders), so that nothing manual is forgotten.
74. As Saransh, I want setup to install the Schedule on the Mac from the Schedule definition, so that the launchd entry is never hand-edited.

### Secrets and identity

75. As Saransh, I want the Discord bot token, my Discord user ID and my git author emails kept in a local env file that is never committed, so that secrets and identity stay on my machine.
76. As Saransh, I want all Run data, Memory, state and the PRD inbox kept in an area git ignores, so that Discord messages and findings about company code never leave the machine through this repo.

### Moving to Dagu later

77. As Saransh, I want every Step callable as a standalone command that reads and writes only the Run folder, so that a Dagu pipeline can call the same commands later.
78. As Saransh, I want Steps to signal failure only through their exit code, so that any runner can tell success from failure.

## Implementation Decisions

### Language and shape

- TypeScript run directly by Node 25's built-in type stripping. There is no build step and, at first, no npm dependencies.
- The Pipeline is plain code, not an agent and not a workflow engine (ADR 0001). It declares an ordered list of Steps and runs them one at a time. The Discord Step could later run alongside the reviews; for now it runs after them.
- The repo holds:
  - the Agents, one folder each;
  - the Pipeline definitions;
  - the command Steps;
  - the Schedule definitions;
  - the Repo list;
  - the setup command and the Workers' config;
  - a git-ignored data area;
  - the glossary, ADRs and this PRD.
- A single `agents` command, linked as a bin, is the only entry point:
  - `agents run <pipeline>` starts a Run. `--dry-run` uses the fake Worker for every Agent Step.
  - `agents step <name> --run <id>` runs one Step inside an existing Run. `--force` redoes work whose output exists.
  - `agents memory` lists the Memory changes waiting for Saransh's review; `agents memory accept|reject <agent> <name>` settles one.
  - `agents setup` prepares a machine. `--team` limits it to the named Teams.
  - `agents schedule install` writes the launchd entry from the Schedule definitions.

### The Step contract (ADR 0001)

- Every Step is a standalone command that takes a Run id.
- A Step reads its inputs only from the Run folder and from state, writes its outputs only to the Run folder, and passes nothing in memory.
- A Step exits zero on success, 78 when it skips itself (such as Discord before the bot is set up), and any other non-zero code on failure.
- A Step is safe to re-run: it skips work whose output already exists unless forced.
- Each Run keeps a record of the Pipeline, each Step's status, start and end times, and the path of its log.
- A Run is succeeded, partial (some Steps failed or never finished) or failed (the Run couldn't start or record itself). A Step that skipped itself doesn't count against the Run, though the Brief's Run health still lists it.
- A lock stops a second Run from starting while one is active. If a Run's process dies, the next Run first stops every Step and Worker process it left running, and records the dead Run as failed.
- A Run's folder name starts with its local start date (year-month-day) followed by hour and minute. Run data is never deleted automatically.

### Daily Pipeline Steps

1. **Fetch** (command): for each Repo, it fetches the production branch from the remote, with credential prompts disabled and a timeout. It never pulls, checks out, or touches the working tree. It records, per Repo, the previous reviewed commit and the new head. On a Repo's first Run it records the current head as the baseline without reviewing history. A fetch failure is recorded for that Repo and doesn't fail the others.
2. **Review** (Agent, one call per Repo with new commits, a few at a time):
   - It runs on a temporary clean worktree of the production branch at the new head, made from Saransh's clone and removed afterwards.
   - The Reviewer runs on Codex in read-only mode, with Claude Code as its fallback.
   - Input: the commit range and the Repo's Memory.
   - Output, checked against a schema: a list of findings (severity, file, line, commit, author, summary, whether Saransh authored it) plus a short summary of what changed.
3. **Discord** (command, after Review): it reads the configured channels and their threads through a read-only bot over Discord's REST API, waiting out rate limits.
   - Threads are the channel's active threads and its public threads archived since the last read.
   - It covers messages from where the last successful read ended to when this one began, or the last 24 hours on the first Run. It records the new read time itself, only on success and never in a dry run. A forced re-read covers the Run's window again.
   - A bot sees only its own DMs, never Saransh's, and can't list them, so a DM with the bot is read only when its channel ID is in the channel list. `DISCORD_READ_DMS` (on by default) decides whether it is read; when it's off, such a channel fails the Step before any of its messages are read.
   - It writes the messages to the Run folder and flags mentions of Saransh.
   - It saves attached PRD-type files (Word, PDF, Markdown), in channels, threads and DMs with the bot, into the PRD inbox, downloading them from Discord's CDN without the bot token.
     - The inbox's `sources.json` records, by file name in the inbox, the Discord message link and attachment ID of each file it saved. Files Saransh drops in by hand have no entry.
     - An attachment already in `sources.json` isn't saved again. The Docs Agent keeps an entry when it moves the file out of the inbox, so a re-read never brings back a handled file.
     - A file whose name is taken in the inbox is saved as `name (2).ext`, and so on, so nothing there is overwritten.
     - A dry run saves nothing into the inbox; each message in the Run folder still lists its PRD files.
   - It records, on each message, links it can't download because they need a login, as To-do candidates for the PM Agent: Google Docs and Drive, Notion, Confluence (`atlassian.net`), SharePoint and OneDrive, and Dropbox, with their subdomains.
   - It is skipped, not failed, while the bot isn't configured.
4. **PM** (Agent): runs on Claude Code, with Codex as its fallback. It has no Repo to read, so it runs read-only in the Run folder.
   - Input: the reviews that cover the commits Fetch found, commit summaries, the Discord messages read in the Run (null when Discord wasn't read), the Run's health so far (the earlier Steps that didn't succeed and the Repos that failed to fetch), and its Memory of open items.
   - Output, checked against a schema and written to the Run folder as `pm.json`: a line per Repo, Discord highlights, To-dos, and its proposed Memory. A failed call is recorded there too, and the Step fails.
   - The rules for what counts as a To-do are open (see Further Notes). The candidates are Discord requests aimed at Saransh with no reply from him, findings on his commits, wiki drafts waiting for him, and PRD links he has to download.
5. **Docs** (Agent): runs on Claude Code in its own worktree of the wiki, on a single rolling docs branch.
   - **Branch:** it continues an unmerged branch, starts fresh from the wiki's main line once the branch has been merged, and merges main in first if main has moved. On a conflict it stops and reports.
   - **Scope:** existing pages whose sources cite files changed by new commits, and every file in the PRD inbox. It uses the wiki's own skills: the PRD skill for PRDs and the update procedure for code changes.
   - **PRD files:** it decides whether each one is a PRD and which Codebase it belongs to, copies it into that Codebase's PRD sources, and writes the PRD page. A copy from Discord cites the Discord message link in the page's sources. It moves processed files out of the inbox, and files that aren't PRDs to a separate holding area.
   - **Never:** it doesn't use Discord messages as wiki sources, doesn't document a Repo for the first time, and doesn't push or merge.
   - **Wiki rules:** it follows them throughout. It reads code only at pinned commits, leaves pages as drafts, and runs the wiki's stamp, region and check tools until the check reports no errors. It commits under Saransh's git identity with trailers naming the Agent and the Run.
   - **Output:** the pages changed, the PRDs processed, and undocumented Repos with large changes, for the Brief.
6. **Save state** (command): advances the last reviewed commit only for Repos whose review succeeded, and applies the Memory edits the Agents proposed, logging each in the Run. For an Agent whose config says its Memory changes wait for review, it queues them for Saransh instead (see Agents).
7. **Brief** (command): the last Step, so its Run health covers every other Step. It renders the Brief as Markdown in the Run folder. Sections, in order:
   - To-dos;
   - Discord highlights;
   - the Discord messages that mention Saransh and the DMs with the bot, straight from the Discord Step, so they show even without the PM output;
   - by Team, per Repo: one line on what changed, its new commits, and its findings by severity, with Saransh's own first;
   - wiki drafts and the docs branch waiting for review;
   - undocumented Repos with large changes;
   - Memory changes waiting for Saransh;
   - Run health, with the number of Repos reviewed.

   It runs even when earlier Steps failed. When the PM output is missing, because the PM Agent failed or hasn't run, the Brief says so at the top and is written from the reviews and Run health alone. A Repo's review is shown only when it covers exactly the commits Fetch found in the Run; otherwise the Brief says the commits have no review. There is no notification.

### Agents

- An Agent is a folder laid out like an Eve agent. It holds:
  - a config module;
  - an instructions file;
  - skills;
  - Tools;
  - subagents;
  - Memory.

  Eve's channels, connections, sandbox, hooks, instrumentation and lib slots are left out.
- An Agent's config declares:
  - its Worker and one fallback Worker, plus model and effort;
  - its permissions, either read-only or the folders it may write;
  - its Tools, inputs and outputs;
  - an optional output schema;
  - whether Save state applies its Memory changes (the default) or queues them for Saransh's review;
  - a timeout and a maximum number of turns.
- Tools are small commands owned by the Agent: executable files in its tools folder, each declared in its config with its usage. The Step allows exactly those commands, plus the Worker's built-in read and search tools, and lists them by full path with their usage in the prompt. Tools exposed over MCP come later.
  - Claude Code allows each one by its path and denies any other command that isn't read-only.
  - Codex's sandbox can't read or run another Agent's Tools, or the Agent's own undeclared ones. Codex's extra tools, such as ChatGPT apps, web search and image generation, are turned off.
  - Codex has no list of allowed commands. Its shell runs any other command inside the sandbox, which can read anything, write only the Agent's write folders, and reach no network. Its subagent tools stay, since no setting found turns them off.
  - Antigravity runs any command inside its sandbox and none outside it. Its sandbox reads only the folder the call runs in, that folder's git data, the Agent's Tools and its skills. It writes only the Agent's write folders, not even the folder it runs in, and reaches no network. No rule allows a command, since print mode lets the model run any command a rule allows outside the sandbox. Each call runs as a custom agent with only the tools to read files, run commands, write files when the Agent may, and finish, so its other tools, such as web search and subagents, are gone.
  - On Codex and Antigravity a Tool runs inside the sandbox too; on Claude Code it runs outside any sandbox. So a Tool must need no more than the sandbox allows.
  - A skill can't allow itself commands through its own settings. Every Tool is declared in the config.
- Skills are the folders in the Agent's skills folder, each holding a SKILL.md. They reach the Worker without being written into the target folder, and the Worker gets no others:
  - Claude Code loads a copy of them as a session-only plugin. Restricted mode already leaves out Saransh's skills and the Repo's; Claude Code's own bundled skills remain.
  - Codex and Antigravity get the skill text in the prompt, with each skill's folder for its other files, until it's confirmed they can load skills from outside their working folder. Codex's own skills, Saransh's and the Repo's are turned off.
  - On Antigravity, that custom agent takes on no skills, rules, plugins or MCP servers: not Antigravity's own, not Saransh's and not the Repo's.
- Subagents: the slot exists, but none ship in v1. When one is added, it is handed to the Worker's own subagent feature, so the parent Agent decides when to call it. Such an Agent can run only on Workers that support this.
- Memory is Markdown notes per Agent, in the data area's `memory/<agent>/<name>.md`: for the Reviewer one file per Repo, and for the PM Agent one file of open items, `memory/pm/notes.md`. Saransh may edit a file by hand, and nothing deletes one. It is read fresh at the start of a call.
  - The Agent proposes edits in its output: the whole new file, or null for no change.
  - By default Save state applies them (`memoryChanges: 'apply'` in the Agent's config) and records each in the Run that proposed it, with the Memory before and after.
  - With `memoryChanges: 'review'`, Save state queues them instead, a newer proposal for a file replacing an older one still waiting. `agents memory` shows each as a diff against the Memory Saransh has now, and `agents memory accept|reject <agent> <name>` settles it, recorded the same way. The Brief lists those still waiting.
  - A dry run's proposals came from the fake Worker, so they are never applied or queued.

### Workers

- One interface, "call this Agent with these inputs and return its result", with implementations for Claude Code (headless print mode), Codex (non-interactive exec) and Antigravity (print mode), plus a fake Worker for tests and dry runs.
- Each implementation:
  - builds its CLI's command line;
  - requests JSON output and, where the Agent has a schema, the CLI's schema-checked final answer;
  - maps the Agent's permissions onto the CLI's sandbox or allowlist;
  - enforces the timeout by ending the process, and ends whatever the CLI left running once it exits;
  - parses the result.
- If a call fails, times out or hits a quota limit, it is retried once on the fallback Worker. Both attempts are logged.
- Claude Code runs on Saransh's logged-in subscription, so it is never run in the minimal mode that ignores that login.
- Codex skips its check that it runs inside a git repo, since an Agent with no Repo, such as the PM, runs in its Run folder.
- Antigravity is only a fallback Worker. Config validation rejects it as an Agent's main Worker until its headless bugs are fixed.
  - Its rules and tools can only come from files, so it runs on the Pipeline's own Antigravity home in the data area, which Saransh logs in to once. His own Antigravity config never reaches a call.
  - Each call writes its custom agent into that home, with the rules of every call running at that moment, so calls running at once can read each other's git data. Calls run at once only within one Step, so they are the same Agent's. Two Steps started by hand at the same time would overwrite each other's rules, so a call could lose access it needs or gain the other's.
  - Its prompt goes in `--print`, since print mode doesn't read stdin. On macOS, a prompt over about 1 MB fails the call.
  - It ends a call at the first thing it refuses and still reports success. Such a call fails, naming what was refused, and the prompt tells the Agent to stay inside the sandbox.
  - Run as a custom agent, it adds its finish tool's fields to the answer, and the Worker drops them.
  - Its model is named without an effort, such as `gemini-3.8-flash`, since the effort is passed on its own. Its Claude models take no effort, so an Agent can't use them on Antigravity.
- Nothing runs with permission checks disabled.

### Repo list and Teams

- Each Repo entry has a name, Team, remote, local folder on this Mac, and production branch.
- 29 Repos are seeded from the local clones. The production branch defaults to each remote's default branch, with exceptions recorded: skill-up uses main, inshortsapp uses master, and flutter_payment uses main.
- Left out: personal repos, repos without a remote, the Flutter SDK clone, and autopay-android.
- Teams are flutter, android, ios, backend, data, frontend and other.
  - On this Mac, existing folders stay as they are.
  - On a new machine, the Team is the folder a Repo is cloned into.

### Schedule

- The daily Schedule runs Monday to Friday at 05:30 on the Mac's local clock (Singapore), which is 03:00 IST.
- The launchd entry is generated from the Schedule definition. It sets its own PATH, since launchd doesn't load the shell profile.
- launchd runs a missed time once when the Mac wakes. Saransh keeps the Mac awake, so there is no scheduled wake.

### Setup

- Setup runs on Mac or Windows and uses no bash.
  - It creates the Team folders and clones each selected Repo onto its production branch, with an optional Team filter.
  - It installs the Workers' config held in this repo: Claude Code settings, status line and plugins; Codex config; Antigravity config.
  - It checks that the tools are present: git, Node, and the three Worker CLIs.
  - It prints a checklist of the manual steps: SDKs and IDEs, secrets and env files, folders that aren't Repos, and logging in once to the Pipeline's Antigravity home.
- The Pipeline itself runs only on the Mac for now.

### Secrets, identity and data

- A local, git-ignored env file holds the Discord bot token, the channel list, Saransh's Discord user ID and his git author emails.
- A git-ignored data area holds Runs, state (the last reviewed commit per Repo, and the time of the last successful Discord read), Memory, the PRD inbox and temporary worktrees.

## Testing Decisions

- **One test boundary: the Step command.** A test prepares a Run folder and state as inputs, runs one Step with the fake Worker standing in for the real ones, and checks only the files the Step wrote and its exit code. Tests never reach into a Step's internals.
- **Real Workers behind stand-in CLIs.** Some behavior only a real Worker has: reading its CLI's output, falling back, and ending a CLI at its timeout. It is tested through the Step on a Run that isn't a dry run, with stand-in `codex`, `claude` and `agy` executables first on PATH. The stand-ins answer the way the real CLIs do and record what they were called with, what the folder they run in and their plugin folder hold, and the settings in their home, since that is the Worker's outer boundary. No test starts a real CLI.
- **Using real git, never the network.** Steps that touch git (Fetch, Review's worktree, Docs' branch handling, Save state) run against temporary git repos created by the test, including a local "remote" to fetch from.
- **Behavior covered:**
  - Fetch: never changes the working tree or the checked-out branch; records baselines on the first Run; reports one failing Repo without failing the others.
  - Review: runs only for Repos with new commits; removes its worktree even when the call fails.
  - Save state: advances state only for successful reviews; applies the Reviewer's and the PM Agent's Memory edits, or queues them when the Agent's config asks for review.
  - Memory: Review gives the Worker the current Memory; accepting or rejecting a queued edit changes the Memory accordingly and records the decision in the Run.
  - Discord: is skipped cleanly without configuration; reads channels and threads within its window, page by page, waiting out rate limits; reads a DM with the bot, or refuses it when DMs are turned off; advances the read time only on a real, successful read; routes attachments to the PRD inbox. It is tested against a local server replaying recorded API responses.
  - Docs: continues, restarts or merges the rolling branch correctly; stops on conflict; moves PRD inbox files.
  - PM: gets the Run's reviews, commits, health and Memory on Claude Code; records a failure after its fallback fails too.
  - Brief: is written, with Run health, when earlier Steps failed; is complete with the PM output; says the PM output is missing after a PM failure; says when no Discord messages were read.
  - Re-runs: skip completed work unless forced.
  - Lock: blocks a second Run.
- **Whole-Pipeline test:** the dry run (`agents run daily --dry-run`) covers the Pipeline end to end, including Step order and a partial Run.
- **Command-line tests:** a small separate set checks that each real Worker builds the right command line for a given Agent config: permissions, schema, Tools, skills and timeout. These are pure checks that never start a CLI.
- **What makes a good test:** it asserts on files, exit codes and git state that Saransh would notice. It doesn't assert on how a Step is written inside.
- **Prior art:** none. The repo is new, and the wiki's tools have no tests. Use Node's built-in test runner, so tests add no dependencies.

## Out of Scope

- Dagu, and any runner other than launchd. The Step contract keeps that move open.
- Running the Pipeline on Windows. Windows gets setup only.
- Pulling Repos, or reviewing working copies or branches other than production.
- Commenting on GitHub PRs, reviewing open PRs, or anything that needs the GitHub CLI.
- Posting the Brief anywhere, and notifications of any kind.
- Reading Saransh's own Discord DMs, using his own Discord account, or using Discord content as a wiki source.
- Downloading Google Docs or other links that need a login.
- First-time documentation of a Repo, and pushing or merging the docs branch.
- Personal repos, repos without a remote, SDK clones, and autopay-android.
- Subagents and MCP-based Tools in v1.
- A hosted team bot, which is where Vercel Eve would fit.
- Deleting Run data automatically.

## Further Notes

- **Open decision, To-dos:** what counts as a To-do, beyond PRD links to download by hand. The PM Agent's schema reserves the field, and its rules are settled before the PM Agent ships.
- **Waiting on Saransh, Discord:** the bot, its installation on the company server by someone with Manage Server, and the list of channels. The Discord Step is skipped until then.
- **Unconfirmed:** whether Codex and Antigravity can load skills from outside their working folder. Codex finds skills only in fixed folders: its own home, Saransh's `~/.agents/skills`, `/etc/codex/skills`, and `.agents/skills` in the folders from where it runs up. A temporary Codex home is untried. Antigravity's custom agent could name the Agent's skill folders, now that it lives in the Pipeline's own Antigravity home; that is untried too. If either can, its inlined skill text goes away.
- **Antigravity headless bugs**, as checked on agy 1.4.4:
  - print mode ignores command rules that name a command, such as `command(git log)`, but honours `command(*)` and `regex:` rules. It also lets the model run any command such a rule allows outside the sandbox (antigravity-cli #548). The Worker writes no command rule, so commands run only in the sandbox;
  - it ends a call at the first thing it refuses and still reports success (#794);
  - it can report success while a command it started is still running (#1044). The Worker ends whatever it left running in its process group once it exits; a command that starts its own process group would escape.

  A live fallback review on this Mac took about three minutes on `gemini-3.8-flash`. It stays a fallback until these are fixed.
- **Billing:** every Run draws on Saransh's plans. Claude Code headless calls count against plan limits, and Max and Team plans also get a monthly API credit. Codex has 5-hour and weekly limits. Antigravity's quota refreshes every 5 hours up to a weekly cap. The Brief's review count is the cost signal.
- **Versions:** codex-cli 0.154.0 and agy 1.4.4 are installed, while 0.163.0 and 1.4.5 are current. agy updates itself. Setup should flag outdated Workers.
- **Defaults chosen while writing this PRD, not discussed:**
  - the Discord window runs from the last successful Discord read, so Monday's Run covers the weekend;
  - the first Run records baselines instead of reviewing history;
  - reviews run a few at a time.
- **Build order:**
  1. Reviews only, run by hand.
  2. The PM Agent and the Brief.
  3. Discord, once the bot exists.
  4. The Docs Agent.
  5. The Schedule.
- **Seed Repo list by Team:**
  - **flutter:** crux_flutter, customcard_flutter, flutter_payment, inpix_flutter, skill-up, tangy_tv_flutter
  - **android:** Public-Messenger-Module, android-core-dependencies, autopay-alerts-android, drama-android, inshortsapp, video-shorts
  - **ios:** inshortsapp_swift_uikit
  - **backend:** inpix-parse-service, inpix-read-service, inpix-user-service, inpix-write-service, inshorts-write-go, news-read-go, nis-payments-platform, nis-payments-service, nis-search-go
  - **data:** inpix-analytics, inpix-recommendation, inpix-share-dashboard
  - **frontend:** cards-autogen, inpix-panel, inpix-website, video-shorts-webapp
- **References:**
  - the glossary and ADR 0001 in this repo;
  - the org wiki's AGENTS.md, for the rules the Docs Agent follows;
  - the build-or-buy research page: https://claude.ai/artifact/9ZXjixmpvTgeL5oGziTYEW
