# Agents

Saransh's local agent system: Pipelines that run on Saransh's own machines (the daily Pipeline on the Mac, the stocks Pipeline on the Windows machine that holds the Lake), call coding-agent CLIs as Workers, keep him up to date on repos, Discord and the org wiki, and manage his portfolios.

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
An ordered list of Steps that runs as one unit, such as the daily Pipeline or the stocks Pipeline.
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

### Stocks

Portfolio, Strategy, Security, Health report and every other market term mean what [ash_new's glossary](../backend/portfolio-dashboard/docs/CONTEXT.md) says they mean; they are not redefined here.

**ash_new**:
Saransh's own strategy and portfolio platform for India, the US and Hong Kong. It holds the Lake, the strategies and the portfolios. It is a personal repo, so it is not a Repo.
_Avoid_: portfolio-dashboard, pdash, the dashboard

**Lake**:
ash_new's market data (prices, fundamentals, index members) and everything built from it, which the stocks Pipeline brings up to date each day.
_Avoid_: database, data store

**Backtest**:
One simulated run of a strategy over past data in ash_new, which ash_new itself calls a Run.
_Avoid_: Run (here, a Run is a Pipeline's), simulation

**Portfolio Manager**:
The Agent that manages Saransh's portfolios, real and paper, end to end: what to buy, sell and hold, and at what size, within the Mandate. It advises; Saransh places every order.
_Avoid_: PM (that is the daily Pipeline's PM Agent), fund manager, advisor, trader

**Book**:
The real money in one market, managed as one: the India Book in INR at ICICI Direct, the US Book in USD at moomoo. Each has its own Mandate, objective, benchmark and gold Sleeve. Their combined value in INR is shown but limits nothing. Beside each is a **paper Book**, run exactly like it but filled automatically at the next open, holding every strategy from Paper up at its full share; the real Book's gap to it is what Saransh's fills, skips and the Stages cost.
_Avoid_: account, fund, portfolio (ash_new's Portfolio is one ledger)

**Legacy holding**:
A holding from before the Books that Saransh hasn't marked kept. It sits in its Book and is sold as the Sleeves need the cash: losses first, and a winner close to turning long-term only once it has.
_Avoid_: old holding, inherited position

**Kept holding**:
A holding Saransh marks to stay outside the Books. The Portfolio Manager never sells it, but a strategy buying the same stock counts it toward the position cap.
_Avoid_: core holding, frozen holding

**Mandate**:
The hard limits the Portfolio Manager works within in each Book, and the objective its strategies are chosen by: the benchmark, the drawdown limits, the most in one position and in one sector, how much cash it may hold, and how tax counts. It caps what the strategies buy but never sizes it. The risk per trade is a warning: a position whose stop would lose more than that is flagged.
_Avoid_: policy, risk settings, constraints

**Sleeve**:
One strategy's share of a Book, or gold's. A strategy's Sleeve is larger the calmer the strategy is and is scaled by its Stage; gold's is fixed. Sleeves are set at each yearly review and drift between them.
_Avoid_: bucket, allocation, member (a Composite's members are ash_new's)

**Stage**:
Where a strategy stands on its way to real money: Candidate, Paper (held only in the paper Book), Real-small (a quarter of its target capital), Real-full, or Retired. A Candidate need not meet the objective alone: its holdout beats the benchmark, its deflated Sharpe clears the bar, and adding it improves its Book's backtest. A **promotion** moves it up a Stage when the Portfolio Manager proposes it and Saransh approves; a **demotion** moves it down when its live record breaks the demotion rule. A strategy whose rules change is a new strategy and starts again as a Candidate.
_Avoid_: status, tier, level

**Rule plan**:
The Order list as code makes it, before any Agent sees it: what the strategies trade, sized and capped by the Mandate, with the Data gate, Quarantines, breakers and Stages applied. The Agents may only subtract from it, and a last check holds them to that.
_Avoid_: draft, signals

**Desk**:
The analyst Agents, one each for events, the chart and risk, that read what rules can't (results, news and announcements, pledges and governance, the chart) in the Lake and the Feeds, and argue over the Rule plan. They search the web only to check one item, and cite what they find. They can only subtract: veto a new position, trim a size, or propose an early exit for Saransh to approve. They never add size or break the Mandate.
_Avoid_: committee, analysts' team (a Team is a Repo's discipline), advisors

**Override**:
One subtraction the Desk made from the Rule plan, scored afterwards against what the Rule plan alone would have done. The **override scorecard** is their running tally, which decides whether the Desk earns more say.
_Avoid_: exception, manual change

**Journal**:
The Portfolio Manager's Memory: why each order and each subtraction was made, the Desk's views, what each was expected to do, and what is still open.
_Avoid_: log, history

**Lesson**:
A rule of thumb the Portfolio Manager draws from its Journal and proposes in the Stocks Brief. It applies to later decisions only once Saransh approves it, and like every judgement here it can only subtract.
_Avoid_: learning, insight, rule (a rule is a strategy's)

**Review**:
The Portfolio Manager's look back at the Books, in Saturday's Stocks Brief: the **weekly review** every Saturday, the **monthly review** with attribution on the first Saturday of each month, and the **yearly review**, the only time strategies are chosen again, Sleeves are re-weighted, new money goes in and the India/US split is revisited.
_Avoid_: retro, report

**Disaster stop**:
The stop each holding keeps at the broker, wider than its strategy's own exit, for what happens between Runs. It is set at entry and raised only on Saturdays. A strategy's own exits are end-of-day and come through the Order list.
_Avoid_: stop-loss (ash_new's Stop-loss is end-of-day), GTT (a broker's order type), trailing stop

**Feed**:
A fixed outside source of company events that the stocks Pipeline fetches only for the securities held and those the rules want to buy: NSE and BSE announcements, SEC EDGAR filings, the earnings calendar.
_Avoid_: news feed, data source

**Order list**:
What the Portfolio Manager advises Saransh to do at the next session: each buy and sale, and each Disaster stop to place or raise. An order is **proposed** until Saransh marks it **placed** or **skipped**, and a placed order is **filled** once a tradebook shows it.
_Avoid_: trade list (ash_new's Trade is a holding from its buy to its sale), recommendations, signals

**Broker inbox**:
Where the brokers' exports wait until the stocks Pipeline records them in ash_new's real portfolios: each tradebook, and every Saturday's holdings, from ICICI Direct for India and moomoo for the US. Saransh downloads and drops them in by hand.
_Avoid_: tradebook inbox (it holds holdings too), drop folder, upload, import queue

**Reconciliation**:
Saturday's check of the real portfolios against the brokers' holdings exports. Each difference becomes a To-do.
_Avoid_: sync, audit

**Data gate**:
The check made before the Portfolio Manager decides anything: the Lake is as of each market's last finished session and its Health report has no failure. One security's flag doesn't fail it; that security goes into Quarantine.
_Avoid_: health check (that is the report the gate reads), sanity check

**Hold mode**:
What the Portfolio Manager does on a day the Data gate fails: it opens nothing new, and exits happen only through Disaster stops.
_Avoid_: safe mode, pause

**Quarantine**:
What happens to one security whose data is flagged: the Portfolio Manager neither buys it nor sells it on a signal, and its Disaster stop stays. Saransh lifts it by approving its Correction or dismissing the flag.
_Avoid_: untradeable (ash_new's Untradeable holding has had no price for over five sessions), frozen, blocked

**Correction**:
A fix to one security's data in the Lake, such as a missing split, a wrong dividend or a bad bar. The Health Agent proposes it, and it applies only once Saransh approves it.
_Avoid_: patch, adjustment (ash_new adjusts every price for splits and dividends)

**Health Agent**:
The read-only Agent that works out what went wrong when the stocks Pipeline's data work fails or its Health report flags something. It writes a diagnosis, a proposed fix and any Corrections for Saransh, and changes nothing itself.
_Avoid_: doctor, debugger, monitor

### Outputs

**Brief**:
The daily summary written for Saransh alone at the end of a Run. The stocks Pipeline's is the **Stocks Brief**: an HTML page read at the Windows machine, never a notification, and where Saransh answers whatever waits on him.
_Avoid_: status update, report, digest

**To-do**:
Something pending on Saransh, such as a PRD link he has to download by hand. The full rules for what counts are not settled yet.
_Avoid_: task, action item

**Answer**:
Saransh's reply, given in the Stocks Brief, to one item waiting on him: an order placed or skipped, an approval or a rejection, a holding kept, a flag dismissed. An Answer never expires, and an item without one appears again in the next Brief.
_Avoid_: response, approval (an approval is one kind of Answer), feedback
