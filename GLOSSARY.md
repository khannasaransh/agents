# Agents

Saransh's local agent system: Pipelines that run on his own machine, call coding-agent CLIs as Workers, and keep him up to date on repos, Discord and the org wiki.

## Language

### Agents

**Agent**:
A folder that defines one job for a Worker to do: its instructions, its config, and what it may read and write.
_Avoid_: bot, assistant, orchestrator

**Worker**:
The coding-agent CLI that runs an Agent: Claude Code, Codex or Antigravity.
_Avoid_: engine, provider, harness, model (a Worker runs a model; it is not one)

**Tool**:
A command an Agent may run during its call, and the only commands it may run beyond its Worker's built-in reading and searching.
_Avoid_: function, plugin

**Memory**:
An Agent's notes carried from one Run to the next.
_Avoid_: context, history, state (state is the Pipeline's own bookkeeping)

### Running

**Pipeline**:
An ordered list of Steps that runs as one unit, such as the daily Pipeline.
_Avoid_: orchestrator, workflow, DAG

**Step**:
One unit of a Pipeline: either a command or one Agent call.
_Avoid_: job, task, stage

**Run**:
One execution of a Pipeline, with its own folder of inputs and outputs.
_Avoid_: execution, session, job

**Schedule**:
When a Pipeline runs on its own, such as weekdays at 03:00 IST.
_Avoid_: cron, trigger

### Sources

**Repo**:
A company repository (NewsInShorts on GitHub) that the Pipeline watches for new commits on its production branch. Personal repos, repos with no remote and SDK clones are not Repos.
_Avoid_: project, codebase (the wiki's Codebase is a group of Repos)

**PRD inbox**:
Where PRD files wait until the Docs Agent turns them into wiki pages, whether they came from Discord or from Saransh.
_Avoid_: drop folder, queue

**Team**:
The discipline a Repo belongs to: flutter, android, ios, backend, data, frontend or other.
_Avoid_: category, group, stack

### Outputs

**Brief**:
The daily summary written for Saransh alone at the end of a Run.
_Avoid_: status update, report, digest

**To-do**:
Something pending on Saransh, such as a PRD link he has to download by hand. The full rules for what counts are not settled yet.
_Avoid_: task, action item
