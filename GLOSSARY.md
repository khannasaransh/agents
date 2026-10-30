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
When a Pipeline runs on its own, such as Tuesday to Saturday at 03:30 IST.
_Avoid_: cron, trigger

### Sources

**Repo**:
A company repository (NewsInShorts on GitHub) that the Pipeline watches for new commits on its production branch. Personal repos, repos with no remote and SDK clones are not Repos.
_Avoid_: project, codebase (the wiki's Codebase is a group of Repos)

**PRD inbox**:
Where PRD files wait until the Docs Agent turns them into wiki pages, whether they came from Discord or from Saransh.
_Avoid_: drop folder, queue

**APK inbox**:
Where the APKs attached on Discord wait to be tested, for the QA Agent to come. Every other file attached there that is neither a PRD nor an APK goes into the **other folder**.
_Avoid_: downloads, builds folder

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

**Frozen backtest**:
A strategy version's backtest over 2006-01-01 to 2016-08-15, on data built once from the Lake and pinned, worked out once and kept (issue 49). Its result never changes, whatever the Lake learns later. A strategy that changes is a new version, with a frozen backtest of its own.
_Avoid_: holdout (the 2013–2016 window the studies test on, on the current Lake)

**Portfolio Manager**:
The Agent that manages Saransh's portfolios, real and paper, end to end: starting from the Rule plan, what to buy, sell and hold, and at what size, within the Mandate and its Book's Playbook. It advises; Saransh places every order.
_Avoid_: PM (that is the daily Pipeline's PM Agent), fund manager, advisor, trader

**Book**:
The real money in one market, managed as one: the India Book in INR at ICICI Direct, the US Book in USD at moomoo and the Hong Kong Book in HKD at moomoo (issue 48). Each has its own Mandate, objective, benchmark and gold Sleeve; the Hong Kong Book's gold ETF and cash fund are the US Book's, in dollars. Their combined value in INR is shown but limits nothing. Beside each is a **paper Book**, run exactly like it but filled automatically at the next open, holding every strategy from Paper up at its full share; the real Book's gap to it is what Saransh's fills, skips, expired orders and the Stages cost, which the weekly review splits out. Beside each paper Book is a **rules-only paper Book**, which trades the Rule plan unchanged from the same start; the paper Book's gap to it is what the Portfolio Manager's judgement added.
_Avoid_: account, fund, portfolio (ash_new's Portfolio is one ledger)

**Book state**:
What a Book holds as each Rule plan starts from it: holdings and cash replayed from its ledger, Reconciliation's open differences, open orders and the cash they reserve, its Disaster stops, and which holdings are Legacy. Each has an id. A decision made from a state that is no longer current is refused, and a security with an open Reconciliation difference is neither bought nor sold on a signal until it is settled.
_Avoid_: snapshot, positions (ash_new's), portfolio

**Legacy holding**:
A holding from before the Books that Saransh hasn't marked kept. It sits in its Book and is sold as the Sleeves need the cash: losses first, and a winner close to turning long-term only once it has.
_Avoid_: old holding, inherited position

**Kept holding**:
A holding Saransh marks to stay outside the Books. The Portfolio Manager never sells it, but a strategy buying the same stock counts it toward the position cap.
_Avoid_: core holding, frozen holding

**Mandate**:
The hard limits the Portfolio Manager works within in each Book, and the objective its strategies are chosen by: the benchmark, the drawdown limits, the most in one position and in one sector, how much cash it may hold, and how tax counts. It caps what the strategies buy but never sizes it. The risk per trade is a warning: a position whose stop would lose more than that is flagged. Each change to it makes a new version, and every plan and decision names the version it was made under.
_Avoid_: policy, risk settings, constraints

**Sleeve**:
One strategy's share of a Book, or gold's. A strategy's Sleeve is larger the calmer the strategy is and is scaled by its Stage; gold's is fixed. Sleeves are set at each yearly review and drift between them.
_Avoid_: bucket, allocation, member (a Composite's members are ash_new's)

**Stage**:
Where a strategy stands on its way to real money: Candidate, Paper (held only in the paper Book), Real-small (a quarter of its target capital), Real-full, or Retired. A Candidate need not meet the objective alone: its holdout beats the benchmark, its deflated Sharpe clears the bar, and adding it improves its Book's backtest. A **promotion** moves it up a Stage (Paper to Real-small after 3 months, Real-small to Real-full after 6) when its record is inside its tested range, the Portfolio Manager proposes it and Saransh approves; a **demotion** moves it down a Stage (Real-full to Real-small to Paper to Retired) by itself when its live record breaks the demotion rule: its live drawdown past 1.5 times its backtest's worst, or after 12 months its rolling 12-month return under its backtest's 5th percentile. Its live record is measured against its backtest over the ten years before the record began. A strategy's version is its rules, parameters and code hash; a strategy whose version changes is a new strategy and starts again as a Candidate, the old version keeping its Stage until the new one replaces it, and the Candidate test chooses only from versions Saransh approved. Entering Paper launches the strategy in ash_new, so its live track starts that day. A **Retired** strategy's Sleeve buys nothing new and winds down through the strategy's own exits. ash_new keeps each Book's Sleeves and their Stages, with every change's day and who approved it, and only `pd stages` changes them.
_Avoid_: status, tier, level

**Rule plan**:
The Order list as code makes it from the Book state, before any Agent sees it: what the strategies trade, sized and capped by the Mandate, with the Data gate, Quarantines, breakers, the exposure level and Stages applied. It is where the Portfolio Manager starts, and what every Override is scored against.
_Avoid_: draft, signals, Strategy plan

**Market condition**:
A market's state as code reads it from the Lake each Run: Uptrend, Under pressure or Correction, from the index against its 50- and 200-day averages, breadth and distribution days, at thresholds Saransh sets. It sets each Book's **exposure level**, the most of the Book held in stocks, with the rest in the cash fund. MarketSmith's own outlook is shown beside it but decides nothing.
_Avoid_: regime, market direction (MarketSmith's), market-trend filter (a strategy's own, in ash_new)

**Playbook**:
The judgements the Portfolio Manager may make in one Book beyond the Rule plan. Each is a **Lever** with the data it must read and a range Saransh approves: exposure (cut below the exposure level, never above it), selection (swap a buy for another name in the Pool), size (down, and up only once the override scorecard shows it adds), timing (wait a few sessions before a buy), trim, and rebalance (skip small drifts). The Book's **Judgement mode** says how much of it applies: *plan only* (the Rule plan goes out as is), *subtract only* (cuts, vetoes, trims and waits), or *Playbook*. Real Books start in subtract only and paper Books in Playbook. A mode or a range changes only by Saransh's Answer.
_Avoid_: policy, rulebook, strategy (a strategy is ash_new's)

**Pool**:
The names the Portfolio Manager may buy in a Book: those a strategy with a Sleeve in that Book bought or signalled to buy in the last 2 months. So every position traces back to a strategy Saransh approved.
_Avoid_: universe (a strategy's), watchlist, candidates (a Candidate is a Stage)

**Decision record**:
What the Portfolio Manager writes for each difference from the Rule plan, and for each Run's exposure level: the Rule plan's order, what went out instead, the Lever and Playbook line that allowed it, the figures it read with their sources, what it expects and when to judge it. A difference without one, or citing a figure that isn't in the Run's inputs, fails the final check.
_Avoid_: rationale, explanation, reason (a sale's reason is ash_new's)

**Desk**:
The analyst Agents, one each for events, the chart and risk, that read what rules can't (results, news and announcements, pledges and governance, the chart) in the Lake and the Feeds, and argue over the Rule plan. Each name is reviewed only by the analysts it needs, and a view is reused while nothing it read has changed. They search the web only to check one item, and cite what they find. They can only subtract: veto a new position, trim a size, or propose an early exit for Saransh to approve. They never add size or break the Mandate. Their views are evidence in the Portfolio Manager's Decision records.
_Avoid_: committee, analysts' team (a Team is a Repo's discipline), advisors

**View**:
One analyst's verdict on one name the Desk reviews: none, a veto, a trim to a given size, or an early exit, with its reasons, the evidence it cites and when it was made. A view reused from an earlier Run keeps its date. A buy whose required view is missing, because the Desk or the Portfolio Manager failed, waits a session.
_Avoid_: opinion, rating, recommendation

**Early exit**:
A sale of a holding before its strategy sells it, which an analyst of the Desk proposes and Saransh approves with an Answer. Once approved, the sale goes out on the paper Book's next Rule plan. The rules-only paper Book never takes one.
_Avoid_: stop-out (that is a Disaster stop), manual sale

**Override**:
One difference from the Rule plan that the final check accepted, made under a Lever and carried by its Decision record, scored afterwards against what the Rule plan alone would have done. The **override scorecard** is their running tally by Lever, by analyst and by Lesson, which decides whether a Lever's range widens or narrows. The scores interact, so whether a real Book moves to Playbook mode is decided instead by its paper Book's gap to the rules-only paper Book.
_Avoid_: exception, manual change

**Journal**:
The Portfolio Manager's Memory: its Decision records, the Desk's views, what each was expected to do, and what is still open.
_Avoid_: log, history

**Lesson**:
A rule of thumb the Portfolio Manager draws from its Journal and proposes in the Stocks Brief, such as a narrower range for a Lever. It applies to later decisions only once Saransh approves it, and a Lesson that widens a range needs the override scorecard's support.
_Avoid_: learning, insight, rule (a rule is a strategy's)

**Review**:
The Portfolio Manager's look back at the Books, in Saturday's Stocks Brief: the **weekly review** every Saturday, the **monthly review** with attribution on the first Saturday of each month, and the **yearly review**, the only time strategies are chosen again, Sleeves are re-weighted, new money goes in and the India/US split is revisited.
_Avoid_: retro, report

**Disaster stop**:
The stop each holding keeps at the broker, wider than its strategy's own exit, for what happens between Runs. It is set at entry and raised only on Saturdays. A strategy's own exits are end-of-day and come through the Order list. A real Book's is proposed with its Order list until Saransh marks it placed, and every Saturday's Brief lists those not yet marked.
_Avoid_: stop-loss (ash_new's Stop-loss is end-of-day), GTT (a broker's order type), trailing stop

**Feed**:
A fixed outside source of company events that the stocks Pipeline fetches only for the names the Desk reviews and the Books' holdings: NSE's announcements, board meetings and pledges, BSE's announcements, SEC EDGAR filings, and the earnings calendar (NSE's board meetings, Yahoo's earnings dates). Each event keeps its link and the time it was first fetched, and what was fetched before is kept, so a Decision record may cite only events fetched before its Run.
_Avoid_: news feed, data source

**Dossier**:
Everything the Desk may read of one name it reviews, which `pd plan` writes into the Run folder: about a year of daily bars with volume, RS and the distance from the 52-week high, MarketSmith's snapshot, fundamentals, its events from the Feeds, and the strategy and signal behind its order. It holds a copy of what it read, not a pointer to the latest fetch, so a Decision record can be checked against it later.
_Avoid_: profile, factsheet

**Order list**:
What the Portfolio Manager advises Saransh to do at the next session: each buy and sale, and each Disaster stop to place or raise. A buy carries a limit price, and a buy that needs a sale's cash is listed under that sale. An order is valid only for its own session. It is **proposed** until Saransh marks it **placed** or **skipped**, and a placed order is **filled**, **partly filled** or **expired** once a tradebook covering its session shows it; an order its session passes unplaced is expired too, and so is the unfilled part of a partial fill. An Answer saved after an order's session is recorded but never revives it. A fill that matches no order is an **own trade**: Saransh's, recorded in the ledger and flagged in the Brief.
_Avoid_: trade list (ash_new's Trade is a holding from its buy to its sale), recommendations, signals

**Fill cost**:
What one of Saransh's fills cost against its session's open price, the price the backtests and the paper Books fill at: a buy above the open, or a sale below it, in basis points of its value. The weekly review weighs each broker's against the slippage the cost presets assume, and flags a broker whose fills cost more.
_Avoid_: slippage (that is what the cost presets assume), execution cost

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
The daily summary written for Saransh alone at the end of a Run: an HTML page that opens with a summary at a glance, where each part of the details, such as the code review of each Repo, opens with a tap, and the same in Markdown beside it. The stocks Pipeline's is the **Stocks Brief**: an HTML page read at the Windows machine, never a notification, and where Saransh answers whatever waits on him.
_Avoid_: status update, report, digest

**Sprint post**:
The task list a lead posts in the sprint channel at the start of each sprint, often as a few messages sent minutes apart, one per Team: each assignee with their tasks and each task's PM. The Discord Step reads the latest one every Run, however long ago it was posted.
_Avoid_: sprint message, assignments, tickets

**Task status report**:
The PM Agent's account, in the Brief, of how each task of the latest Sprint post stands (blocked, in progress, in testing, done, or no signal), judged from every message since the post, the bot's DMs and the updates Saransh forwards it among them, and the commits since it, merged or still on another branch, with the evidence it rests on. Each Run starts from the last report on the same post.
_Avoid_: sprint report, standup, task tracker

**To-do**:
Something pending on Saransh, such as a PRD link he has to download by hand. The full rules for what counts are not settled yet.
_Avoid_: task, action item

**Answer**:
Saransh's reply, given in the Stocks Brief, to one item waiting on him: an order placed or skipped, an approval or a rejection, a holding kept, a flag dismissed. An Answer never expires, and an item without one appears again in the next Brief. An order's validity still ends with its session, and a later Answer never revives it.
_Avoid_: response, approval (an approval is one kind of Answer), feedback
