# Stocks Pipeline and the Portfolio Manager

Status: ready-for-agent

## Problem Statement

Saransh has built ash_new, his own strategy and portfolio platform. Its Lake holds more than ten years of prices and fundamentals for India, the US and Hong Kong, and some of its backtests are strong. After costs, CW2 India's best variant made 29.95% a year from 2016 to 2026; the Nifty 500 made about 11.5%. None of that reaches his money:

- **Nothing keeps the Lake current, or says when it isn't.** The refresh started on 18 Oct 2026 is still marked running. The one on 16 Oct died with `BrokenProcessPool`. The Lake is six days old, and nothing reported it.
- **Nothing trades the evidence.** None of the 50 strategies is launched, and his real portfolios have no transactions. His money at ICICI Direct and at moomoo is managed outside ash_new.
- **Each backtest tests one strategy, not what he would hold.** The strongest strategies have drawdowns of 28% to 38%, more than he accepts. No backtest covers what a book actually is: several strategies held together, with gold, caps on positions and sectors, drawdown breakers and stops at the broker.
- **Rules can't read what moves a stock on a given day:** results dates, pledges, governance, announcements. When he overrides a rule on instinct, nothing records whether it helped.
- **There is no broker API.** What he bought, skipped or forgot to protect is known only from exports he downloads by hand.
- **The old Portfolio Manager in ash_backend** (8 CANSLIM slots, a −8% stop and `PM_BUY` alerts to the Sash app) uses other data and has never been backtested as a whole.

He wants the highest CAGR he can get, with 30% as the aim and as little drawdown as possible. He wants it run with a professional desk's discipline: every day, checked and accountable, without him watching it.

## Solution

A stocks Pipeline in the agents repo, run on the Windows machine that holds the Lake. It runs Tuesday to Saturday at 07:00 IST, so each Run has both markets' previous closes. Each Run:

1. **Records what Saransh did:** his Answers from the last Stocks Brief, and the tradebooks and holdings exports he dropped in the Broker inbox.
2. **Fetches MarketSmith's data** through ash_backend, on Saturdays.
3. **Brings the Lake up to date** with ash_new's daily chain. It clears a stuck refresh and retries a failed one once. If something still breaks, the Health Agent works out why. The Data gate decides whether the Portfolio Manager may act at all (Hold mode otherwise), and a single flagged security goes into Quarantine.
4. **Makes the Rule plan in code** for each Book: India and the US, each real and paper. It uses the same engine that backtests the Book, so live trades what was tested.
5. **Puts the plan to the Desk.** The Events, Chart and Risk analysts read the Feeds and the Lake for the Rule plan's names and argue over it. The Portfolio Manager decides what to subtract and why. A final check holds it to subtractions inside the Mandate.
6. **Reviews the Books** on Saturdays: weekly, monthly with attribution, and yearly, when strategies are chosen again.
7. **Writes the Stocks Brief:** an HTML page holding the Order list for India's open and the US's evening open, everything waiting on Saransh, and buttons to answer.

The Portfolio Manager only advises; Saransh places every order. A strategy reaches real money only through the Stages. Each Book's objective is checked on its own backtest: the highest CAGR with a backtested max drawdown of at most 25% and a holdout CAGR of at least 20%.

## User Stories

### Running the stocks Pipeline

1. As Saransh, I want the stocks Pipeline to run by itself Tuesday to Saturday at 07:00 IST, so that the Stocks Brief is ready with both markets' previous closes before India opens.
2. As Saransh, I want the Windows machine woken from sleep for a Run, so that a sleeping PC doesn't cost me a trading day.
3. As Saransh, I want a Run missed while the machine was off to start as soon as it is back, so that the worst case is a late Brief, not a missing one.
4. As Saransh, I want `agents schedule install` to write the stocks Schedule into Windows Task Scheduler from its Schedule definition, so that the task is never hand-edited.
5. As Saransh, I want each machine to install only its own Schedules (the daily Pipeline's on the Mac, the stocks Pipeline's on Windows), so that neither machine runs the other's Pipeline.
6. As Saransh, I want to start the stocks Pipeline by hand, or one Step inside a Run, with the same commands as the daily Pipeline, so that I can retry or tune one part.
7. As Saransh, I want a dry run that uses the fake Worker for every Agent and records nothing in ash_new, so that I can check the Pipeline without spending quota or touching my Books.
8. As Saransh, I want the stocks Pipeline to be the only thing that refreshes the Lake on a Schedule, with ash_new's own schedule off, so that the Portfolio Manager never decides on data some other job refreshed.
9. As Saransh, I want a Run to tell me if ash_new's own schedule has been turned back on, so that two schedulers never fight over the Lake.
10. As Saransh, I want a Book whose market was shut the session before to get no orders, so that a holiday in one market never produces stale orders.
11. As Saransh, I want the Saturday Run to add the MarketSmith fetch and the reviews, so that weekday Runs stay short.
12. As Saransh, I want a failed Step not to stop the others, and the Brief always written, so that one broken source still leaves me a Brief that says what's missing.
13. As Saransh, I want each Run's inputs, outputs and logs in its own Run folder, as the daily Pipeline does, so that I can see what any day decided and why.

### The Lake and its health

14. As Saransh, I want each Run to bring the Lake up to date with ash_new's daily chain, so that every decision uses the latest closes, fundamentals and index members.
15. As Saransh, I want a refresh left marked running by a dead process to be cleared automatically, so that one crash doesn't block every later refresh.
16. As Saransh, I want a failed refresh retried once, so that a passing Yahoo or network fault doesn't cost me the day.
17. As Saransh, I want stale backtests re-run after each refresh, so that every strategy's figures are on the latest data without my clicking.
18. As Saransh, I want the Data gate to check that the Lake is as of each market's last finished session and that its Health report has no failure, so that nothing is decided on stale or broken data.
19. As Saransh, I want a failed Data gate to put the Portfolio Manager in Hold mode, which opens nothing new and exits only through Disaster stops, so that bad data can't produce trades.
20. As Saransh, I want a single flagged security put into Quarantine instead, so that one bad bar doesn't freeze every other name.
21. As Saransh, I want a Quarantined security neither bought nor sold on a signal while its Disaster stop stays in place, so that it stays protected without trading on doubtful data.
22. As Saransh, I want the Health Agent to diagnose a failed refresh or a flag and propose a fix, so that I start from a diagnosis rather than a log.
23. As Saransh, I want the Health Agent to propose Corrections for corporate actions Yahoo got wrong, so that bad splits and dividends get fixed, not just flagged.
24. As Saransh, I want a Correction applied only once I approve it, and the backtests it affects re-run, so that no data changes without me.
25. As Saransh, I want to lift a Quarantine by approving its Correction or by dismissing the flag, so that a false alarm ends with one Answer.
26. As Saransh, I want the Health Agent to change nothing itself, so that a diagnosis can never damage the Lake or the code.
27. As Saransh, I want the Brief to say what the Data gate decided and why, so that I know whether today's Order list can be trusted.

### MarketSmith

28. As Saransh, I want the Saturday Run to fetch MarketSmith's India and US data through ash_backend, so that fundamentals and MarketSmith's snapshot are never more than a week old.
29. As Saransh, I want an expired MarketSmith cookie to skip the fetch and give me a To-do naming the cookie, so that a login problem never fails the Run.
30. As Saransh, I want ash_backend's Portfolio Manager and Sash's `PM_BUY` alerts turned off, so that two systems never give me conflicting advice.

### Books and the Mandate

31. As Saransh, I want an India Book in INR at ICICI Direct and a US Book in USD at moomoo, each managed on its own, so that one market's losses never force sales in the other.
32. As Saransh, I want each Book to have its own Mandate, objective and benchmark (the Nifty 500 TRI; the S&P 500 total return), so that each is judged against its own market.
33. As Saransh, I want no more than 15% of a Book in one position and 30% in one sector, so that no single name or sector can sink it.
34. As Saransh, I want a Book that falls 10% from its high to stop new buys, and one that falls 18% to halve its exposure, so that drawdowns are cut before they reach the 25% I won't accept.
35. As Saransh, I want a Book's idle cash held in its cash fund (a liquid ETF in India, a T-bill ETF in the US), so that money waiting for a strategy still earns.
36. As Saransh, I want tax to decide only between otherwise equal choices, so that it never overrides what the strategies say.
37. As Saransh, I want a position flagged when its Disaster stop would lose more than 1% of its Book, so that I see oversized risk without the strategies' sizing being changed.
38. As Saransh, I want the Books' combined value shown in INR with no limit on it, so that I see my whole wealth but the dollar's moves never trip a breaker.
39. As Saransh, I want each Book's capital to be a setting, with ash_new's preset capital used in backtests until I set it, so that the work can start before I decide the amounts.
40. As Saransh, I want Hong Kong left out of the Books, so that a market with no real money and weak evidence takes none of the Portfolio Manager's attention.

### Strategies and Stages

41. As Saransh, I want a strategy to become a Candidate when its holdout beats the benchmark, its deflated Sharpe clears the bar and adding it improves its Book's backtest, so that strategies earn a place by what they add, not by their own drawdown.
42. As Saransh, I want a Candidate to go through Paper for 3 months and Real-small (a quarter of its share) for 6 months before Real-full, so that real money follows proof.
43. As Saransh, I want the Portfolio Manager to propose each promotion and me to approve it, so that no strategy gets more money without my say.
44. As Saransh, I want a strategy demoted when its live drawdown passes 1.5 times its backtest's worst, or its rolling 12-month return falls below its backtest's 5th percentile, so that a broken strategy loses its money without waiting for me.
45. As Saransh, I want a strategy whose rules change to be a new strategy that starts again as a Candidate, while the old one keeps its Stage until replaced, so that no tweak inherits a live record it didn't earn.
46. As Saransh, I want a strategy entering Paper to be launched in ash_new, so that its live track starts the day its Paper Stage does.
47. As Saransh, I want CW2's selected variant activated and the ash ports loaded before Candidates are picked, so that the selection sees the best versions of the strategies I have.
48. As Saransh, I want a Retired strategy's Sleeve wound down through the strategy's own exits, so that retiring it doesn't dump positions on one day.

### The Book backtest

49. As Saransh, I want a backtest of each whole Book, so that the objective is checked on what I would actually hold.
50. As Saransh, I want the Book backtest and the daily Rule plan to use the same engine, so that live trades exactly what was tested.
51. As Saransh, I want the Book backtest to include every layer, so that none goes untested. That means:
    - Sleeves weighted by inverse volatility and set yearly;
    - gold at 10%;
    - the position and sector caps;
    - the breakers;
    - Disaster stops;
    - Stage scaling;
    - the order-size guard;
    - yearly new money;
    - the costs.
52. As Saransh, I want Disaster stops tested on daily bars, filling at the stop or at the open when the price gaps through it, so that their cost is in the evidence.
53. As Saransh, I want the part of a buy that a cap cuts to wait in the cash fund, so that capped money is never quietly handed to another strategy.
54. As Saransh, I want each Book backtest to report its CAGR, max drawdown, holdout CAGR and deflated Sharpe, plus the range of its rolling returns and drawdowns, so that promotions, demotions and the weekly review have a tested range to compare with.
55. As Saransh, I want a Book backtested with and without each strategy, so that the Candidate test is a number, not a judgement.

### The Rule plan

56. As Saransh, I want code to make each Book's Rule plan from its strategies' live tracks, so that the same data always gives the same plan.
57. As Saransh, I want each strategy sized by its own rules within its Sleeve, with the Mandate only capping, so that live sizes match the backtests.
58. As Saransh, I want a second strategy's buy of a stock the Book already holds cut to fit under the caps, so that two strategies agreeing never breaks the 15% limit.
59. As Saransh, I want no order bigger than 1% of the stock's 20-day average traded value, with any cut stated in the Brief, so that my own orders don't move the price.
60. As Saransh, I want strategy exits to stay end-of-day and come through the Order list, so that I sell exactly when the backtests did.
61. As Saransh, I want a Disaster stop proposed with every new position, at twice its strategy's stop distance or 15% below entry where the strategy has none, so that a collapse between Runs is limited.
62. As Saransh, I want Disaster stops raised only on Saturdays, so that I have few stop changes to make.
63. As Saransh, I want the Rule plan to apply the Data gate, Quarantines, the breakers, the Stages and my approved early exits, so that everything decided before the Desk sits in one place.

### The Desk

64. As Saransh, I want three analysts (Events, Chart and Risk) each to write their own view of the Rule plan's names, independently, so that I get the judgement rules can't make.
65. As Saransh, I want the Desk to review only the Rule plan's buys and sales and the holdings with results or another event in the next 5 sessions, so that it doesn't make Overrides out of noise.
66. As Saransh, I want the Events analyst to read results dates, guidance, pledges, promoter selling, governance and filings, so that I don't buy into an avoidable event.
67. As Saransh, I want the Chart analyst to judge how far a stock is extended from its base, its distribution days and its gaps down on volume, so that entries aren't made at the worst point.
68. As Saransh, I want the Risk analyst to find concentrations that sectors miss, such as one theme, one promoter group or five names reporting in one week, and to flag thin liquidity, so that a Book isn't one bet in disguise.
69. As Saransh, I want the Desk to read only the Lake, MarketSmith's snapshot and the Feeds, and to search the web only to check one item and cite its source, so that its views are reproducible and auditable.
70. As Saransh, I want the analysts on different Workers, so that they don't share one model's blind spots.
71. As Saransh, I want the Desk only to veto a new position, trim a size or propose an early exit, never to add, so that judgement can only make a Book safer than the rules.
72. As Saransh, I want an early exit the Desk proposes to wait for my approval, so that no position is sold on an opinion without me.
73. As Saransh, I want the Desk's web searches never to mention my holdings' sizes or amounts, so that nothing about my money leaves the machine.

### The Portfolio Manager

74. As Saransh, I want the Portfolio Manager to chair the Desk, decide each subtraction and write why, so that every difference from the rules has a reason I can read.
75. As Saransh, I want a final check that every change from the Rule plan is a subtraction and that everything stays inside the Mandate, with the Rule plan sent out unchanged if not, so that an Agent's mistake can only make the Order list smaller.
76. As Saransh, I want the Rule plan sent out as the Order list, with a note, when the Agents fail, so that a Worker outage still leaves me the tested plan.
77. As Saransh, I want the Portfolio Manager to propose a promotion when a Stage's time is up and its record passes, so that I don't have to track the calendars.
78. As Saransh, I want the Portfolio Manager to write each Book's commentary in the Brief, so that I read the day's meaning, not raw tables.

### Orders and stops

79. As Saransh, I want each Book's Order list to give each buy and sale in whole shares, and each Disaster stop to place or raise, so that I can place them without working anything out.
80. As Saransh, I want India's orders as market orders for the pre-open auction and the US's for that evening's open, so that my fills are the open prices the backtests assume.
81. As Saransh, I want every order to stay proposed until I mark it placed or skipped, and placed until a tradebook shows it filled, so that the Portfolio Manager never assumes what I did.
82. As Saransh, I want every Saturday's Brief to list each Disaster stop I haven't marked placed, so that an unprotected position can't go unnoticed.

### What comes back

83. As Saransh, I want to drop ICICI Direct's and moomoo's tradebooks in the Broker inbox and have them recorded in my real Books, so that ash_new's ledger matches the brokers' without my typing.
84. As Saransh, I want import presets for ICICI Direct's and moomoo's exports, so that their files are read without my mapping columns.
85. As Saransh, I want each fill matched to the order it filled, so that every order's state is known.
86. As Saransh, I want a To-do when the next Run finds no tradebook for orders I marked placed, so that I know which file to drop.
87. As Saransh, I want the Broker inbox to move processed files out and set aside files it can't read, so that it shows only what's still waiting.
88. As Saransh, I want each Saturday's holdings exports reconciled against my real Books, with each difference a To-do, so that a missed fill, a corporate action or a trade I made myself is caught within a week.
89. As Saransh, I want what my fills cost against the open price measured each Saturday for each broker, so that the cost presets change if real slippage is worse than assumed.

### Answers in the Brief

90. As Saransh, I want to answer everything waiting on me in the Stocks Brief itself, with buttons, so that I don't have to go anywhere else.
91. As Saransh, I want a Save answers button that saves my Answers to a file the next Run picks up, so that nothing has to be running for my clicks to count.
92. As Saransh, I want an Answer never to expire, and an unanswered item shown again in each Brief, so that nothing is decided by my silence.
93. As Saransh, I want an Answer to an item that's already settled ignored and logged, so that an old file can't undo a newer decision.

### Paper Books

94. As Saransh, I want a paper Book beside each real Book, run exactly like it, so that the whole process is proven before real money depends on it.
95. As Saransh, I want a paper Book's orders filled automatically at the next open with the backtests' costs, so that it runs without me.
96. As Saransh, I want a paper Book to hold every strategy from Paper up at its full share, so that it is the model my real Book is measured against.
97. As Saransh, I want the gap between each real Book and its paper Book shown, so that I see what my fills, my skips and the Stages cost.

### Legacy and kept holdings

98. As Saransh, I want holdings I had before the Books recorded as Legacy holdings on the first import, so that the Portfolio Manager knows everything I own.
99. As Saransh, I want Legacy holdings sold as the Sleeves need cash, losses first, and a winner close to turning long-term only once it has, so that the switch costs as little tax as possible.
100. As Saransh, I want to mark any holding kept, so that something I hold for my own reasons is never sold.
101. As Saransh, I want a Kept holding counted toward the position cap when a strategy buys the same stock, so that a name I keep plus a strategy's buy can't exceed 15%.

### Journal and Lessons

102. As Saransh, I want the Portfolio Manager to keep a Journal of why each order and each subtraction was made, what the Desk said and what each was expected to do, so that the reviews can judge decisions against their reasons.
103. As Saransh, I want the Journal to carry what's still open (orders not yet filled, Quarantines, pending promotions), so that nothing open vanishes between Runs.
104. As Saransh, I want the Portfolio Manager to propose Lessons in the Brief, with each applied only once I approve it, so that it learns from its record without changing its behaviour on its own.
105. As Saransh, I want a Lesson I reject never proposed again, so that I answer each idea once.
106. As Saransh, I want a Lesson only ever to subtract, so that no approved Lesson can add untested risk.

### Reviews

107. As Saransh, I want a weekly review each Saturday comparing each Sleeve and each Book with its backtest's range and its benchmark, so that I see early whether live matches what was tested.
108. As Saransh, I want the weekly review to include fill costs, Reconciliation, stops not marked placed, the override scorecard and the demotion checks, so that every week ends with the Books checked.
109. As Saransh, I want a monthly review on the first Saturday of each month, so that I know where returns came from. It attributes each Book's return to:
     - Sleeve weights;
     - the picks within Sleeves;
     - gold;
     - cash;
     - costs;
     - Overrides;
     - for the US Book in INR, the dollar.
110. As Saransh, I want the monthly review to show the correlation between Sleeves, each Book's drawdown against its limits and the promotions due, so that risk is reviewed as well as return.
111. As Saransh, I want the yearly review to be the only time strategies are chosen again, Sleeves re-weighted, new money put in and the India/US split revisited, so that backtest overfitting doesn't creep into live money.
112. As Saransh, I want each Override scored against what the Rule plan alone would have done, so that the Desk earns more say only on evidence.

### The Stocks Brief

113. As Saransh, I want the Stocks Brief to be an HTML page I open on this machine, never a notification, so that it stays private and waits for me.
114. As Saransh, I want it to open with the Data gate's verdict, then the Order lists by Book in the order I place them, then what waits on me, so that I can act within minutes.
115. As Saransh, I want it to show each Book's value, its drawdown against its breakers, its Sleeves and their Stages, so that I see each Book's state at a glance.
116. As Saransh, I want it to list the Desk's subtractions with their reasons, and the Quarantines, Corrections, Lessons and promotions waiting on me, so that I see every judgement made on my behalf.
117. As Saransh, I want it to list failed and skipped Steps, so that I know which parts of the day are missing.
118. As Saransh, I want the page to load nothing from the internet, so that opening it sends nothing anywhere.

### Agents and Workers

119. As Saransh, I want the Portfolio Manager on Claude Code with Codex as fallback, and the Health Agent on Codex with Claude Code as fallback, so that one subscription's outage doesn't cost a Run.
120. As Saransh, I want every stocks Agent to run read-only, with a schema-checked output, a timeout and a turn limit, so that no Agent can change my data or hold up a Run.

### Secrets and data

121. As Saransh, I want no broker credentials anywhere in the system, so that nothing can trade or read my accounts on its own.
122. As Saransh, I want Run data, the Journal, Lessons, the Broker inbox and Answers kept in git-ignored areas, so that my holdings never leave the machine through a repo.
123. As Saransh, I want MarketSmith's cookies kept only in ash_backend's env file, so that the stocks Pipeline never handles them.

## Implementation Decisions

### Shape

- Three repos each own one part. They are joined only by commands with files in and out (ADR 0001's Step contract).
  - **The agents repo** owns the stocks Pipeline and its Schedule, the Agents (Portfolio Manager, Health Agent and the Desk's three analysts), the Answers round trip and the Stocks Brief.
  - **ash_new** owns everything about markets: the Lake, Corrections, Books, the Book engine (both the backtest and the Rule plan), the final check, paper and real Books, orders, imports, Reconciliation, Feeds, dossiers and review figures. Each is reached through a `pd` command that writes JSON.
  - **ash_backend** keeps only the MarketSmith fetch.
- The Pipeline reaches ash_new only through `pd` commands. It never reads ash_new's database or Lake files directly. The JSON those commands write is the contract between the two repos.
- The stocks Pipeline owns the Lake's Schedule, and ash_new's own schedule and Task Scheduler task are off (ADR 0002).
- The stocks Pipeline is plain TypeScript, like the daily Pipeline, with the same Run folders, lock, Step records, logs and `agents run|step` commands. It runs on Windows.

### Schedule on Windows

- A Schedule definition now names its machine, as well as its Pipeline, days and time. `agents schedule install` installs only the current machine's Schedules: launchd on the Mac, Task Scheduler on Windows.
- The stocks Schedule runs Tuesday to Saturday at 09:30 on this machine's clock (Singapore time), which is 07:00 IST.
- The Task Scheduler entry is generated from the Schedule definition, and installing again replaces it rather than adding a second. The entry:
  - wakes the machine to run;
  - starts a missed time as soon as the machine is available;
  - sets its own PATH, so Node, uv, git and the Worker CLIs are found.
- A scheduled start while a Run is active is refused by the lock and recorded.

### Stocks Pipeline Steps

1. **Answers** (command). It reads every Answers file in Downloads and in the Broker inbox and applies each Answer once through `pd`:
   - marks on orders;
   - approvals or rejections of Corrections, promotions, early exits and Lessons;
   - dismissed Quarantines;
   - kept marks.

   It logs an Answer to an item that's already settled as ignored, then moves the files into the Run. An Answer on a Lesson settles the Portfolio Manager's queued Memory change for it.
2. **Broker inbox** (command). It records each tradebook in its real Book and matches fills to orders. When a holdings export is present, it runs Reconciliation.
   - Processed files move out of the inbox. A file it can't read is set aside, with a To-do.
   - On a Book's first import, every holding no strategy bought becomes a Legacy holding, and the Brief asks whether to keep each one.
3. **MarketSmith** (command, Saturdays only; it skips itself otherwise). It runs ash_backend's fetch for India and the US through a new ash_backend command. An expired cookie skips the Step, with a To-do naming the cookie.
4. **Lake** (command):
   - It checks that ash_new's own schedule is off, and raises a To-do if it isn't.
   - It clears a refresh left running by a dead process.
   - It runs `pd daily`, retrying once on failure, and fails if the retry fails too.
   - It records each market's latest session and the Health report.
5. **Health** (Agent: the Health Agent). It skips itself when the Lake Step succeeded and the Health report flags nothing. It reads, read-only, the Lake Step's log, the Health report, ash_new's code and its job records. Its output:
   - a diagnosis;
   - a proposed fix, as text, never applied;
   - proposed Corrections in the Corrections file's format, recorded in ash_new to wait for approval.
6. **Plan** (command, through `pd`). It applies the Data gate, then makes the Rule plan for each Book, real and paper (see The Book engine). It writes the Rule plans and the names the Desk must review, with a dossier for each name.
7. **Feeds** (command, through `pd`). It fetches the Feeds for the Rule plan's names and the holdings, reusing what it has cached.
8. **Review** (command, through `pd`, Saturdays only). It computes the weekly figures, adds the monthly ones on the first Saturday of a month, and the yearly ones at the yearly review.
9. **Desk** (Agents: three calls at once, one per analyst). Each analyst gets the Rule plan's names with their dossiers and Feeds, and writes a view of each name.
10. **Portfolio Manager** (Agent).
    - **Its inputs:**
      - the Rule plans and the Desk's views;
      - the Data gate's verdict and the Health Agent's diagnosis;
      - on Saturdays, the review figures;
      - the Stages;
      - its Journal and its approved Lessons.
    - **Its output, checked against a schema:**
      - for each Book, the subtractions from the Rule plan, each with a reason and the analysts' views it follows;
      - the early exits, promotions and Lessons it proposes;
      - the Journal's new entries;
      - the Brief's commentary.
11. **Check** (command, through `pd`). It makes the final Order lists.
    - It accepts the Portfolio Manager's output only if every change from the Rule plan is a subtraction (a veto, a trim or a dropped buy) and everything stays inside the Mandate.
    - Otherwise, or when the Portfolio Manager failed, the Rule plan goes out unchanged, and the Brief says why.
    - It records the Order lists in ash_new: a paper Book's orders to fill at the next open, a real Book's orders as proposed.
    - It records each subtraction as an Override, with the Rule plan's order beside it.
12. **Save state** (command). It applies the Journal's entries and queues each proposed Lesson for Saransh's Answer, as the daily Pipeline's Save state does for Memory.
13. **Brief** (command). It writes the Stocks Brief as a single self-contained HTML file in the Run folder.

A dry run changes nothing in ash_new:
- the fake Worker stands in for every Agent;
- the Lake is read as it is, without refreshing it;
- no Answers file or inbox file is consumed;
- every `pd` command runs with its option that records nothing.

### The Book engine (ash_new)

- **A Book** is declared in ash_new's config: its market, currency, broker, benchmark, capital, cash fund, gold ETF and the numbers in its Mandate. Its Sleeves and their Stages are kept in the app database, along with every Stage change, its date and who approved it. They change only through `pd` commands.
- **One engine serves both the Book backtest and the daily Rule plan.** Unlike a Composite, it doesn't blend return series. It trades securities across the Sleeves, because caps on positions and sectors only exist at the level of holdings.
- **Each Sleeve follows its strategy's own track unchanged.** The strategy runs on its own (simulated in a backtest, live-tracked in the Rule plan), and the Book lays its rules over it. A strategy's orders become the Book's at the Sleeve's weight, and then these rules apply, in order:
  1. Quarantines and the Data gate;
  2. Stage scaling: in a real Book, a Paper strategy holds nothing, a Real-small one a quarter of its share and a Real-full one all of it. A paper Book holds every strategy from Paper up at its full share;
  3. the breakers, on the Book's drawdown from its high-water mark;
  4. the position and sector caps across the whole Book, Kept holdings included. A buy is cut to fit, and the part cut waits in the cash fund;
  5. the order-size guard, at 1% of the stock's 20-day average traded value;
  6. whole shares, and lot sizes where a market has them.

  The strategy's own track never sees these rules. So every Override's counterfactual is always at hand.
- **Sleeve weights:** each strategy's weight is proportional to the inverse of its volatility over the past year, then scaled by its Stage. Gold is fixed at 10%. Whatever no Sleeve uses waits in the cash fund. Weights are set at each yearly review and drift in between.
- **Disaster stops** are set at entry, at twice the strategy's stop distance, or 15% below the entry for a strategy without a stop. They are raised only on Saturdays. On daily bars, a low under the stop fills at the stop, or at the open when the price opens below it.
- **Strategy exits** stay end-of-day, as each strategy's spec says.
- **Legacy holdings** are sold to pay for the Sleeves' buys: losses first, then gains. A winner within two months of turning long-term (12 months in India, 24 in the US) is held until it has. Kept holdings are never sold.
- **Costs** come from the cost presets, with brokerage at ₹0 for ICICI Direct and $0 for moomoo for now. In the backtest, the cash fund earns the region's risk-free rate.
- **The Book backtest reports:**
  - CAGR, max drawdown, holdout CAGR and deflated Sharpe;
  - the range of rolling 12-month returns and drawdowns, which the demotion rule and the weekly review compare against.

  The deflated Sharpe counts every variant tried in a strategy's family as a trial. The Candidate test runs the Book with and without the strategy.
- **Parity:** the Rule plan is the Book engine's next session, run from the Book's actual holdings and cash. Started from the backtest's own holdings, it gives exactly the backtest's next session.

### Data, Corrections and Quarantine (ash_new)

- **ash_new's open decisions:**
  - 1 is b: the refresh re-runs stale backtests after it builds the panels.
  - 2 is a: a Corrections file is applied when prices are built. It can hold a split or bonus with its date and ratio, a dropped or corrected dividend, or a demerger's ratio.
  - 3, 4 and 5 are a.

  These answers are recorded in ash_new's decisions file, and its tickets carry them.
- **Corrections:** a proposed Correction waits in the app database until Saransh approves it. Approving it adds it to the Corrections file, and the next refresh applies it.
- **Quarantine:** a security flagged by the Health report is quarantined in every Book until its Correction is approved or its flag dismissed.
- **The Data gate fails** on a problem across the whole Lake: no refresh, a failed Health report, or a market not at its last finished session.
- **Stuck refreshes:** a `pd` command clears a refresh job marked running whose process no longer exists. It marks the job failed and frees the refresh lock. The `BrokenProcessPool` failure is diagnosed and fixed before the stocks Pipeline relies on the Lake.
- **New securities:** the gold ETFs and cash funds are added to the Lake, with their prices.

### Real Books, paper Books and orders (ash_new)

- **Real Books:** each real Book is one of ash_new's real portfolios. New import presets read ICICI Direct's and moomoo's tradebooks and holdings exports, built from sample files Saransh provides.
- **Orders:** each item on an Order list has an id and a state: proposed, placed, skipped, filled or partly filled.
  - A fill matches an open order for the same security and side, on that order's session.
  - A fill that matches no order is recorded as a trade Saransh made himself, and flagged in the Brief.
- **Reconciliation** compares each real Book's positions, replayed from its ledger, with the holdings export, one security at a time. Each difference becomes a To-do.
- **Paper Books** are paper portfolios fed by Order lists. Each order fills at the next session's open with the strategies' costs: sales first, then buys cut to the cash available, as a manual paper portfolio's applied rebalance does today.
- ash_new's Portfolios inbox is not extended to real portfolios. Answers come through the Brief.

### Feeds and dossiers (ash_new)

- **Feeds are fetched only for the Rule plan's names and the holdings**, and keep each event's link:
  - India: NSE and BSE corporate announcements, board meetings (which give results dates) and pledges.
  - US: SEC EDGAR filings (8-K, 10-Q, 10-K, Form 4).
  - An earnings calendar: from NSE's board meetings for India, and from Yahoo's earnings dates for the US.
- **A dossier per name** holds what the Desk reads:
  - about a year of daily bars with volume, RS, and the distance from its 52-week high;
  - MarketSmith's snapshot: shareholding, estimates, news, the O'Neil checklist;
  - fundamentals;
  - its recent and coming events from the Feeds;
  - the strategy and signal behind its order.

### Reviews (figures from ash_new, words from the Portfolio Manager)

Code computes the review figures, and the Portfolio Manager writes what they mean.

- **Weekly:**
  - each Sleeve's and Book's live return and drawdown, against its backtest's range and its benchmark;
  - fill costs against the open price, per broker;
  - Reconciliation's differences;
  - Disaster stops not yet marked placed;
  - the override scorecard;
  - the demotion checks;
  - each real Book's gap to its paper Book.
- **Monthly:**
  - attribution of each Book's return to Sleeve weights, the picks within Sleeves, gold, cash, costs, Overrides and, for the US Book in INR, the currency;
  - the correlation between Sleeves;
  - drawdown against the limits;
  - promotions due.
- **Yearly**, all as proposals for Saransh:
  - the Candidate test re-run for every strategy;
  - new Sleeve weights;
  - where new money goes;
  - the India/US split.
- **The override scorecard** scores each Override against its counterfactual: what the Rule plan's order would have made, taken from the strategy's own track, until that track closed the position. It is tallied per analyst and per Lesson.

### Agents

- **Portfolio Manager:** Claude Code, with Codex as fallback, read-only in the Run folder. Its Memory has two parts:
  - the Journal, which Save state applies;
  - Lessons, which wait for Saransh's Answer. That Answer can now come from the Brief as well as from `agents memory`.

  So an Agent's Memory changes can now be set per Memory file rather than per Agent.
- **Health Agent:** Codex, with Claude Code as fallback. It reads ash_new's repo, its logs and the Lake's Health reports, read-only.
- **The Desk:**
  - **Workers:** Events and Risk run on Claude Code, Chart on Codex. Each falls back to the other Worker.
  - **Access:** all three are read-only in the Run folder. Events and Risk may use their Worker's web search, only to check one item and citing its source. Chart has no web access.
  - **Output**, checked against a schema, for each name: no view, a veto, a trim to a given size, or a proposed exit, with reasons and the evidence cited.
- **Instructions** tell each analyst what it may and may not do, and state the Mandate. What enforces subtractions only is the final check, not the instructions.

### Answers

- The Brief shows each item waiting on Saransh with its id. The Save answers button downloads one Answers file, naming the Run and each item's Answer: placed, skipped, approve, reject, keep or dismiss, with an optional note.
- The Answers Step reads every Answers file it finds and applies them oldest first. A later Answer to the same item applies only while that item is still open.

### ash_backend

- A new command runs the `fetch` job kind outside the API for India and the US, writing to the raw store as the job does. It exits with 78 when MarketSmith rejects a cookie.
- Its Portfolio Manager agent and Sash's `PM_BUY` alerts are turned off.

### Secrets and data

- **Credentials:**
  - No broker credentials exist anywhere.
  - MarketSmith's cookies stay in ash_backend's env file.
  - Saransh sets the contact for the SEC's required User-Agent in the agents repo's env file.
- **Where data lives:** the Broker inbox, Answers files, Run data, the Journal and Lessons live in the agents repo's git-ignored data area. ash_new's app database and Lake stay where they are.
- **Web searches:** the Desk's searches name securities and events only, never Saransh's holdings, sizes or amounts.

## Testing Decisions

### Seams

There are two seams, and both are a command with files in and files out.

- **The Step command** (agents repo), as for the daily Pipeline:
  1. A test prepares a Run folder and state.
  2. It puts stand-in `pd` and ash_backend commands first on PATH, beside the stand-in Worker CLIs.
  3. It runs one Step with the fake Worker.
  4. It checks only the files the Step wrote, what the stand-ins were called with, and the exit code.
- **The `pd` command** (ash_new):
  1. A test builds a small Lake and app database with the existing fixture builders.
  2. It runs one `pd` command.
  3. It checks the JSON written and what was recorded.

**The contract between them:** each new `pd` command's JSON has a JSON Schema kept in ash_new.
- ash_new's tests check each command's output against its schema.
- The agents repo's stand-in `pd` answers with example files that validate against the same schemas.
- One test checks the agents repo's copies against ash_new's schemas when ash_new is present on the machine.

### Behavior covered, agents repo

- **Schedule:**
  - the Task Scheduler entry for the stocks Schedule has the right days, local time, wake, start-when-available and PATH, generated without registering it;
  - each machine installs only its own Schedules.
- **Answers:**
  - applies each Answer once;
  - ignores an Answer to a settled item;
  - consumes nothing in a dry run.
- **Broker inbox:**
  - hands each file to the right import;
  - sets an unreadable file aside, with a To-do;
  - raises a To-do for placed orders that have no tradebook.
- **MarketSmith:** skips itself on weekdays, and with a To-do on an expired cookie.
- **Lake:**
  - clears a stuck refresh;
  - retries once, and fails when the retry fails;
  - raises a To-do when ash_new's schedule is on.
- **Health:**
  - skips itself when the Lake is healthy;
  - runs on a failure or a flag, and its output is recorded.
- **Desk and Portfolio Manager:**
  - each gets its inputs;
  - each falls back to its other Worker;
  - a failure is recorded.
- **Check:** sends the Rule plan unchanged when the Portfolio Manager failed.
- **Save state:** applies the Journal and queues Lessons.
- **Brief:**
  - is written with every section after earlier Steps fail;
  - shows a Hold mode day;
  - produces an Answers file in the exact shape the Answers Step reads. A test reads the items embedded in the HTML and builds the file the way the button does.
- **Whole Pipeline:** `agents run stocks --dry-run` covers it end to end, including the Step order and a partial Run.

### Behavior covered, ash_new

- **Parity:** the Rule plan for a session, started from the backtest's own holdings, equals the Book backtest's trades on that session.
- **Caps:**
  - a second strategy's buy is cut and the part cut stays in cash;
  - the sector cap holds;
  - a Kept holding counts toward the position cap.
- **Breakers:** no new buys at −10%; exposure halved at −18%.
- **Disaster stops:** fills on daily bars are right, including a gap through the stop.
- **Stages:** each Stage's scaling is right, and a paper Book holds full shares.
- **Order-size guard:** an order over 1% of the 20-day average traded value is cut.
- **Legacy holdings:** they are wound down in the right order, and a winner near long-term waits.
- **Check:**
  - accepts subtractions;
  - rejects an addition, a size increase, or anything outside the Mandate;
  - falls back to the Rule plan.
- **Imports:**
  - sample ICICI Direct and moomoo files become the right ledger;
  - fills are matched to orders, including partial fills;
  - a fill with no order is flagged.
- **Reconciliation:** finds each difference.
- **Paper Books:** fill at the next open.
- **Corrections:**
  - a proposal waits;
  - an approved one is applied by the next refresh;
  - approving it lifts the Quarantine.
- **Stuck refresh:** cleared only when its process is gone.
- **Feeds:** parsed from recorded responses, never from the network.
- **Review:**
  - attribution adds up to the Book's return;
  - an Override's counterfactual is right.
- **Candidates:** the Candidate test accepts a strategy that improves its Book and rejects one that doesn't.

### What makes a good test, and prior art

- **What makes a good test:** it asserts on what Saransh would notice: files, orders, positions, ledgers, exit codes. It never asserts on how a module is written inside.
- **Prior art in the agents repo:** the daily Pipeline's Step tests, with their stand-in Worker CLIs and fake Worker, and the generated-launchd-entry check in issue 12.
- **Prior art in ash_new:**
  - the fixture Lakes for backtests and data health;
  - the tests of the backtest engine, paper follow, composites, imports, pending actions, live tracking, costs and data health.

## Out of Scope

- **Broker access:** placing orders, any broker API, reading broker accounts, and storing broker credentials.
- **Hong Kong** in the Books. It stays in ash_new's catalog, unmanaged.
- **Delivery:** notifications of any kind, posting the Brief, and reaching the Brief or ash_new from a phone. That comes later, as ash_new served over a private network.
- **ash_new's Portfolios inbox for real portfolios.** Answers come through the Brief.
- **Real brokerage costs**, until Saransh provides contract notes.
- **Instruments and trading styles:**
  - intraday data, and any intraday stop other than Disaster stops;
  - derivatives, short selling, leverage and margin;
  - instruments other than stocks, the gold ETFs and the cash funds.
- **Tax:** tax filing or reporting, and any tax optimisation beyond tie-breaking and the order in which Legacy holdings are sold.
- **Moving money between the Books.** Only the yearly review proposes a new split.
- **Judgement that adds:** the Desk adding size or opening positions, and Lessons that add.
- **Pages for Books in ash_new's web app.** The Brief is the interface for now.
- **The Sash app's alerts**, which are retired.
- **Dagu**, as for the daily Pipeline.

## Further Notes

- **Taken as recommended, not yet confirmed:**
  - Answers travel by the Save answers download (round 6, Q1).
  - The build order moves the Broker inbox imports and Reconciliation into the first phase (round 6, Q2).
- **Build order:**
  0. **Fix the Lake:** clear the stuck refresh, find why the process pool dies, and bring the Lake up to date.
  1. **The data Pipeline:**
     - the Windows Schedule and the stocks Pipeline with the Lake, MarketSmith and Health Steps;
     - the Data gate, Corrections and Quarantine;
     - ash_new's schedule turned off;
     - the Broker inbox with ICICI Direct's and moomoo's import presets, and Reconciliation;
     - a Stocks Brief showing data status and holdings.
  2. **The evidence:** activate CW2's variant, load the ash ports, build the Book engine and its backtest, and pick each Book's Candidates.
  3. **Paper Books:**
     - the Rule plan, the final check and the Portfolio Manager;
     - the Journal, the Order list and Answers;
     - the weekly and monthly reviews.

     The 3-month Paper clock starts here.
  4. **The Desk, on the paper Books** within those 3 months: the Feeds, dossiers, override scorecard and Lessons.
  5. **Real money:** Legacy and Kept holdings, then the first Real-small promotions after 3 months of Paper.
- **Waiting on Saransh:**
  - each Book's capital;
  - one tradebook and one holdings export from each broker, to build the import presets;
  - the contact for the SEC's User-Agent;
  - later, contract notes, if real brokerage is to enter the costs.
- **Unconfirmed:**
  - **Codex's read-only sandbox on Windows** is untested here. If it doesn't hold, the Health Agent and the Chart analyst start on Claude Code.
  - **Node:** the agents repo requires Node 25, but this machine has 24.17.0.
  - **NSE and BSE endpoints** need browser-like headers and cookies, and change without notice. A failing Feed skips itself with a To-do.
  - **Broker charges in exports:** whether ICICI Direct's and moomoo's exports include charges, which would let the reviews check the ₹0 / $0 brokerage.
  - **Web search permission:** how Claude Code's web search is allowed for the Events and Risk analysts, given that the Worker denies every command that isn't read-only.
- **Defaults chosen while writing this PRD, not discussed:**
  - **Breaker recovery:** new buys resume once a Book recovers above −5%, and full exposure above −9%. Both are tested in the Book backtest.
  - **The yearly review** falls on the first Saturday of April, when India's financial year and the LRS limit start again.
  - **A Retired strategy's Sleeve** is wound down through the strategy's own exits.
  - **The deflated Sharpe bar** is 95%, and the holdout is 2013–2016, as in ash_new's research.
  - **Logon:** the Task Scheduler task runs only while Saransh is logged on, so no password is stored.
  - **Answers** apply oldest first.
  - **An Override is scored** until the strategy's own track closes the position.
  - **A fill with no order** is recorded as Saransh's own trade.
  - **A dry run** reads the Lake as it is.
- **Evidence so far** (next-open fills, after costs, 2016–2026; holdout 2013–2016):

  | Strategy | CAGR | Max drawdown | Sharpe | Holdout CAGR |
  |---|---|---|---|---|
  | CW2 India, best variant | 29.95% | −27.86% | 1.03 | 38.96% |
  | Investor India, 5% buffer | 28.38% | −38.46% | 0.90 | 2.53% |
  | CMO India, SuperTrend and up-day | 27.73% | −37.28% | 0.94 | 18.40% |
  | CW2 US, best variant | 20.91% | −26.01% | 0.84 | 13.41% |

  None meets a Book's 25% drawdown limit alone, which is why Candidates are judged by what they add to a Book. Hong Kong's results are weak, and CW2 Hong Kong's holdout CAGR is negative.
- **Tax and money movement:**
  - **India:** gains turn long-term after 12 months.
  - **US shares, for an Indian resident:**
    - gains turn long-term after 24 months and are taxed at 12.5%;
    - short-term gains are taxed at the slab rate;
    - dividends lose 25% to US withholding.
  - **Remittances under the LRS** carry 20% TCS above ₹10 lakh a year. That's one reason the Books never pass money to each other.
- **The daily Pipeline's PRD** (`prd.md`, beside this one) leaves Windows out of scope. This PRD changes that for the stocks Pipeline only.
- **The Pipeline's machinery runs only on macOS today.** Its lock and process records use a macOS-only file lock, it stops processes by process group, and the tests' stand-ins are `sh` scripts. Issue 16 makes it run on Windows before anything else is built there.
- **Issues:** 15–45 in this repo's issues folder. The nine that touch only ash_new are mirrored as ash_new's tickets 50–58.
