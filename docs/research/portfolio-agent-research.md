# Research: an AI agent that manages a personal equity portfolio under an owner-approved mandate

Researched 2026-10-25. Scope: India (NSE stocks via ICICI Direct) and US (stocks via moomoo). The question is how to design an agent that follows rules the owner approves, makes judgement calls inside those rules, and backs every action with evidence.

Every claim cites a source from the **Sources** list at the end (`[S#]`). The list holds only pages I opened. Lines marked **Design note** are my own inferences for this repo, not claims from a source.

---

## 0. Key points

1. **Write the mandate down as an Investment Policy Statement (IPS) and make it executable.** The CFA Institute's IPS elements (2010) cover four areas: scope, governance, objectives and constraints, and risk management. They include target weights with allowed ranges, a loss level the owner cannot tolerate that triggers set procedures, rebalancing rules that include a minimum trade size, permitted assets, prohibited holdings with a check frequency, and an annual review [S1]. Each of these can become a machine-checked parameter.
2. **Keep a construction layer between signals and orders.** The signal is not the portfolio. Constraints, costs, sizing and regime overlays sit in between. Published evidence:
   - Constraints cut how much of the signal reaches the portfolio [S19].
   - Costs erase most high-turnover anomalies, and a buy/hold spread (no-trade band) is the most effective simple fix [S18b].
   - The best policy trades only partway toward an "aim" portfolio [S18a].
   - Volatility targeting thins the left tail for equities [S17].
   - A 10-month moving-average trend filter roughly halved drawdowns over a century, at the cost of lagging in bull markets [S16].
   - No rebalancing frequency or threshold is optimal. Calendar checks with ~5% bands balance risk against cost [S20].
3. **Allow discretion only inside rules, and score every override.** The Basel IRB standard requires firms to state who may override a model, when and by how much, and to "identify overrides and separately track their performance" [S23]. Forecasting research finds that model plus judgement beats either alone [S22b]. Small adjustments tend to hurt, large ones help, and **downward (pessimistic) adjustments beat upward (optimistic) ones** [S22a]. That supports overrides that may only subtract.
4. **The LLM proposes and code checks.** Published multi-agent trading systems use analyst, debate, risk-team and fund-manager roles with structured reports [S12]. Independent checks show reported LLM trading gains shrink badly on longer, broader tests. LLMs are too timid in bull markets and too aggressive in bear markets [S13c]. Gains also vanish after the model's training cutoff because of memorization ("profit mirage") [S13e]. Use deterministic gates, schema-validated outputs (numeric bounds are not enforced by the schema, so check them in code [S15b]), point-in-time data, anonymized prompts [S13d], and live paper trading before real money [S13f][S24a].
5. **Treat the decision record as a books-and-records system.** The regulated analogues are:
   - SEC Rule 204-2: a memo for every order, naming who recommended it and marking discretionary orders; records that support any performance figure; five-year retention [S24c].
   - SEC Rule 15c3-5: pre-trade rejection of orders that breach credit limits or have wrong price or size, plus annual review [S24b].
   - FINRA Notice 15-09: code change control, testing separated from production, kill switch, and pilots at small size [S24a].
   - NSE's retail-algo standards: exchange algo-ID tagging and a five-year audit trail [S4].
6. **India rules.**
   - SEBI's circular of 4 Feb 2025 sets the retail algo framework [S2]. It went live 1 Oct 2025 for brokers that were ready, and **applies to all brokers from 1 Apr 2026** [S3].
   - Self-built algos at or under **10 orders per second per exchange** need no registration. They still need a static IP, OAuth/2FA, exchange tagging and a daily logout [S4].
   - Breeze allows no market orders via the API and caps calls at 100 per minute and 5,000 per day [S6][S7].
   - **moomoo:** paper trading through `TrdEnv.SIMULATE`. Placing orders is limited to 15 per 30 seconds per account, and live accounts must be unlocked before trading [S10].

---

## 1. Investment Policy Statement (the mandate)

### What the CFA Institute says to write down
*Elements of an Investment Policy Statement for Individual Investors*, CFA Institute, May 2010 [S1]. The paper has four sections with 18 elements, and gives example IPS wording for each.

| Area | Element (CFA numbering) | Concrete practice from the paper |
|---|---|---|
| Scope | 1b Define the investor and **which assets** the IPS governs | Lists the accounts covered by name |
| Scope | 1c Structure, standard of care, risk structure, **acceptance** | The owner signs the IPS. The adviser must "promptly notify … of … violations of the Policy" |
| Governance | 2a Who **sets**, who **executes**, who **monitors** | Owner approves policy and all changes. Adviser reports "no less than a monthly basis" |
| Governance | 2b Review process | "review the IPS … no less frequently than annually" |
| Governance | 2d Asset allocation responsibility | The allocation sits in an **appendix that can be revised without a new IPS**, with stated input assumptions |
| Governance | 2e Risk monitoring | Adviser identifies "variances in risk positions that exceed tolerable limits", takes "prompt corrective action", and reports all variances at least quarterly |
| Objectives | 3b Return and risk requirements, **permitted asset classes, each with a benchmark** | A policy portfolio with **target weights and allowable ranges**. Each report confirms weights stayed in range |
| Objectives | 3c Risk tolerance | Defined as a loss path rather than volatility. Example: "an absolute loss in any 12-month period of more than 33 percent is intolerable. At that threshold … policies and procedures to minimize risk of further loss should be implemented." Stop-loss and rebalancing policies can go in an appendix |
| Constraints | 3d Evaluation horizon, liquidity, tax, legal, **leverage**, **foreign securities**, **currency policy** | Examples: judge performance over rolling 8 quarters; "up to 15 percent … can be liquidated upon five days' notice"; a margin cap; a currency-conversion rule |
| Other | 3e Philosophy, **exclusion criteria** | Example: an exclusion list, with the portfolio "review[ed] monthly" and violating holdings disposed of "immediately" |
| Risk mgmt | 4a Performance reporting | Calculated to GIPS, **reconciled to the broker statement** |
| Risk mgmt | 4b Risk metrics | Fixed metrics such as tracking error and information ratio, kept consistent. "Inappropriate use of different metrics to highlight or disguise certain risks should be avoided" |
| Risk mgmt | 4c Rebalancing | A documented band or trigger. Example: propose on the first business day of each quarter, execute within two days of authorization, and **defer any trade under a minimum size**. If the policy is not to rebalance, document that too |

The paper also says what the IPS is for: it "serves as a policy guide that can offer an objective course of action to be followed during periods of market disruption when emotional or instinctive responses might otherwise motivate less prudent actions" [S1].

### Parameters to write down for a personal two-market equity book
**Design note.** These parameters are derived from [S1] plus the construction literature in section 2. Each should be a typed, versioned field that the checker enforces, not prose.
- **Universe and permitted instruments:** exchanges, minimum liquidity and price, no derivatives, no margin, no shorting. Leverage and short limits are separate IPS elements in [S1].
- **Position limits:** maximum weight per name at entry and at drift (for example 8% and 12%), and a maximum number of names.
- **Sector or theme limits:** maximum weight per sector, and a maximum share in correlated clusters.
- **Cash band:** minimum and maximum cash, and how the band moves with the market regime (section 2.4).
- **Drawdown limits:** book-level breakers (for example −10% → stop new buys, −15% → halve gross, −20% → go to cash and escalate). These follow the CFA "intolerable loss → procedures" pattern [S1].
- **Per-position risk:** an initial stop or maximum loss per position, and a risk budget per trade as % of the book.
- **Rebalancing and trading rules:** check frequency, band width, minimum order value, a turnover cap per period, and order types per market.
- **Prohibited actions:**
  - averaging down below the stop;
  - trading outside listed sessions;
  - a name on an exclusion list;
  - any order whose evidence is stale or missing;
  - any increase in risk proposed by the LLM (section 3).
- **Governance:**
  - the owner approves every IPS change, and the version and date go into every decision record;
  - review at least annually and after any breaker trips;
  - who may override (section 3).
- **Reporting:** benchmark per book (for example Nifty 500 TRI, S&P 500 TR), fixed risk metrics, and reconciliation to broker statements [S1].

---

## 2. From signals to the live portfolio: the construction layer

### 2.1 Why the live portfolio differs from strategy output
- **Implementation shortfall.** Perold (1988) defined it as the return gap between the paper portfolio and the portfolio actually implemented, because execution prices differ from decision prices [S25]. The gap includes market impact, delay, and the opportunity cost of orders that never fill [S25].
- **Constraints dilute the signal.** Clarke, de Silva and Thorley (FAJ, Sept 2002) show that long-only, turnover and sector-neutrality constraints stop managers from fully using their forecasts. They split realized performance into forecast quality and the "noise" constraints add [S19]. This is the "transfer coefficient" idea: the generalized fundamental law of active management scales information ratio by how much of the signal reaches the weights.
- **Costs.** Novy-Marx and Velikov (NBER w20721, Dec 2014; RFS 2016) find that anomalies with one-sided monthly turnover under ~50% mostly stay significant after costs, and few higher-turnover ones do. A **buy/hold spread**, meaning you keep a holding that would not be bought fresh, is "the single most effective simple cost mitigation strategy" [S18b].
- **Personal-book specifics:** whole shares, minimum order sizes, different session times in IN and US, FX, tax lots, and legacy holdings the owner chooses to keep. **Design note:** each of these makes the real book drift from the backtest, so measure the drift (section 4.4).

### 2.2 Position sizing and volatility targeting
- Harvey et al., *The Impact of Volatility Targeting*, JPM 45(1), 2018 [S17]. Study of 60+ assets with daily data from 1926:
  - Scaling exposure inversely to recent volatility raises Sharpe ratios for **risk assets (equities and credit)**, and for portfolios with a large allocation to them.
  - The effect on Sharpe is negligible for bonds, FX and commodities.
  - Volatility targeting **"consistently reduces the likelihood of extreme returns"** in every asset class, and reduces maximum drawdowns for balanced and risk-parity portfolios.
  - The mechanism is the leverage effect: volatility rises when prices fall, so scaling down acts like time-series momentum.
  - Volatility was estimated with exponentially weighted daily returns. Equal-weight rolling windows gave similar results [S17].
- **Design note:** for a long-only, unlevered personal book, use volatility scaling to *cap* exposure, not to lever up. Examples: per-position size = risk budget ÷ (stop distance or ATR), and book gross exposure shrinks when index volatility rises. That captures the tail benefit in [S17] without leverage the IPS prohibits.

### 2.3 Turnover- and cost-aware rebalancing and no-trade bands
- Garleanu and Pedersen, *Dynamic Trading with Predictable Returns and Transaction Costs* (NBER w15205, 2009, rev. 2013) [S18a]. The optimal policy under costs is to "aim in front of the target" and "trade partially towards the current aim". Signals that decay slowly get more weight.
- Vanguard, *Best practices for portfolio rebalancing*, by Jaconetti, Kinniry and Zilbering (2010) [S20]. Study of 1926–2009:
  - "There is no optimal rebalancing frequency or threshold."
  - Monthly and annual rebalancing gave similar risk and return. Monthly averaged 8.5% return at 12.1% standard deviation; annual averaged 8.6% at 11.9%.
  - The number of rebalancing events and the costs rose sharply with frequency.
  - "Annual or semiannual monitoring, with rebalancing at 5% thresholds", is a reasonable balance for most investors.
  - The never-rebalanced portfolio drifted to about 84% equity.
- Faber reports less than one round trip per asset class per year for his trend model, so commissions are minor. Taxes, however, are "a very real consideration" in taxable accounts [S16].
- **Practice:**
  - Hold-band or hysteresis rules: buy at rank ≤ N, sell only at rank > M with M > N.
  - A minimum trade value, which CFA's example defers indefinitely [S1].
  - A turnover cap per period.
  - Trade partway toward the target when signals are noisy [S18a][S18b].

### 2.4 Regime and market-condition overlays
- **200-day / 10-month trend filter.** Faber, *A Quantitative Approach to Tactical Asset Allocation* (2006 working paper; JWM Spring 2007; 2013 update) [S16]:
  - Rule: "Buy when monthly price > 10-month SMA", otherwise move to cash. The model is checked only at month-end.
  - On the S&P 500 from 1901 to 2012, the timing model returned 10.18% compounded against 9.32% for buy-and-hold. It was invested ~70% of the time.
  - It cut the 1929–32 drawdown from 83.66% to 42.24%, exited on 31 Dec 2007, and avoided the 50.95% drawdown of 2008–09.
  - Caveats in the paper: it "can underperform buy and hold during a roaring bull market", it lagged in roughly half of all years, the value shows "only over the course of entire business cycles", and taxes, commissions and slippage are excluded [S16].
- **IBD / MarketSmith "market direction".** The O'Neil method classifies the market by state: confirmed uptrend, uptrend under pressure, correction or downtrend, and rally attempt.
  - Distribution days, meaning down days on higher volume, warn of a top.
  - A follow-through day, a strong up day on higher volume after a rally attempt, confirms a new uptrend.
  - "A rally attempt … is not a buy signal". In a confirmed uptrend, exposure should rise gradually, alongside breadth and new leadership [S21] (MarketSmith India, 10 Apr 2026).
  - I could not open investors.com or the MarketSmith India blog with my tools, so exact counts and thresholds (distribution-day count and expiry, follow-through day number and % gain) are **unverified here**. Take them from the MarketSmith material the owner subscribes to.
- **Independent support for regime-aware controls in LLM systems.** The FINSABER study (arXiv 2505.07078; KDD 2026) recommends "trend detection and regime-aware risk controls" over more complex agent designs. It found that LLM strategies were too conservative in bull markets and too aggressive in bear markets [S13c].
- **Design note:** encode the overlay as a deterministic *exposure ceiling* by state, for example uptrend 100%, under pressure 60%, correction 20–30% with no new buys. Code computes it from index data. The LLM may cite it but may not change it.

---

## 3. Discretionary overlay under rules: overrides and scorecards

### 3.1 The regulatory template (banking, but directly analogous)
Basel Framework **CRE36.44, Overrides** (BIS; in force 1 Jan 2023) [S23]:
- "banks must clearly articulate the situations in which bank officers may override the outputs of the rating process, including how and to what extent such overrides can be used and by whom."
- For model-based ratings, banks need "guidelines and processes for monitoring cases where human judgement has overridden the model's rating", and must name the staff who approve overrides.
- "Banks must identify overrides and separately track their performance."
- CRE36.28 adds that overrides must not "render the mapping process ineffective" [S23].

Mapped to this agent, that gives four rules:
1. A written override policy: which actions, how large, and who may make them.
2. Every override flagged in the record.
3. A named approver.
4. A separate performance track for overrides.

### 3.2 What the evidence says about judgemental adjustments
- **Combining helps.** Blattberg and Hoch, *Database Models and Managerial Intuition: 50% Model + 50% Manager*, Management Science 36(8), Aug 1990 [S22b]. Across five forecasting settings, model plus manager beat either alone, adding an average R² of 0.09 (16%) over the best single input in cross-validation.
- **Which overrides help.** Fildes, Goodwin, Lawrence and Nikolopoulos, IJF 25(1), 2009 [S22a]. Study of more than 60,000 forecasts at four supply-chain companies:
  - Adjustments improved accuracy on average at three of the four companies.
  - **Larger adjustments helped, and small ones often hurt.**
  - **Upward (optimistic) adjustments were much less likely to help than downward ones**, and were more often in the wrong direction.
- **Design implications (Design note):**
  - Let the LLM **subtract only**: veto a buy, trim, or exit early. Never add or upsize. This matches the downward-adjustment finding [S22a] and keeps risk inside the IPS by construction.
  - Do not log trivial tweaks as overrides. Set a minimum size, say ≥25% of an order or a full veto. Small changes add noise and cost [S22a][S18b].
  - Require a reason code and evidence for every override, so overrides can be grouped by reason when scored.

### 3.3 Override log and scorecard (practice)
**Design note**, built on CRE36.44's "separately track their performance" [S23]:
- **Log fields:**
  - the rule-plan order, unchanged, next to the override;
  - the override type (veto, trim, early exit, delay);
  - a reason code and free-text rationale;
  - evidence references (data snapshot ids, filings, news ids with timestamps);
  - confidence;
  - IPS version;
  - approver (owner or auto).
- **Counterfactual scoring:** score each override against the rule plan's own track until that track would have closed the position.
  - Veto: the P&L avoided.
  - Trim: the P&L difference on the part trimmed.
  - Early exit: what the track made after the exit.
  - Include costs on both sides [S25].
- **Tallies:** count, hit rate, average and total value in currency and in bps of the book, by reason code, analyst or role, and market regime. Add a confidence-calibration check: do high-confidence overrides score better?
- **Governance loop:**
  - If overrides of a reason class keep losing money, remove that class from the allowed list (an IPS change).
  - If they add value, consider encoding them as a rule. Then they stop being overrides and go through backtesting.
  - The Basel "how and to what extent … by whom" wording [S23] fits a staged autonomy model, where the scope of allowed overrides widens only on evidence.

---

## 4. Explainability, decision records, compliance and attribution

### 4.1 Books-and-records ideas to borrow (US)
- **SEC Rule 204-2, investment adviser books and records** [S24c]:
  - "A memorandum of each order … for the purchase or sale of any security", including the order's terms, "the person … who recommended the transaction" and who placed it. "Orders entered pursuant to the exercise of discretionary power shall be so designated." (a)(3)
  - Written records of "any recommendation made or proposed to be made and any advice given or proposed to be given". (a)(7)
  - "All accounts, books, internal working papers … necessary to form the basis for or demonstrate the calculation of any performance or rate of return." (a)(16)
  - Retained "not less than five years". (e)(1)
  - **Mapping:** the agent's per-order record should hold the proposal, who proposed it (rule engine or LLM role), whether it was discretionary (an override), the inputs, and the calculations behind any reported performance.
- **SEC Rule 15c3-5, market access pre-trade controls** [S24b]:
  - Controls must "systematically limit the financial exposure". They reject orders that breach preset credit or capital thresholds, or that "exceed appropriate price or size parameters", and they catch duplicates. (c)(1)
  - Restricted securities are blocked. (c)(2)
  - The controls are reviewed regularly, at least annually, with a CEO certification. (e)
  - **Mapping:** before any order leaves, run a deterministic check:
    - cash and limit check;
    - price-collar check against the last trade;
    - size check against ADV and the book;
    - duplicate check;
    - restricted-list check;
    - IPS limits.
- **FINRA Regulatory Notice 15-09** (26 Mar 2015), algorithmic strategy supervision [S24a]:
  - Track code changes with approval steps.
  - Keep a "basic summary of each algorithm's intended function".
  - Provide a kill switch.
  - Pilot new strategies at limited size and scale up after results are confirmed.
  - Test in an environment separate from production, with QA independent of development, and keep records of test results.
  - Document and periodically review risk-control parameter settings.
  - Restrict the ability to "overwrite or evade system controls".
  - Rate-limit outbound messages.

### 4.2 India: the audit trail in the retail algo framework
- Every algo order is tagged with an exchange-issued identifier "in order to establish audit trail" [S2][S4].
- Brokers must keep a "sound audit trail for all … Client API … orders and trades", identify the actual user, and hold the data **at least 5 years** [S4].
- "White box" algos are those whose logic is disclosed and replicable. "Black box" algos make the vendor register as a Research Analyst and keep a research report for each algo [S2]. **Design note:** a personal agent whose rules are code the owner approved is closer to the white-box idea. Keep the rules versioned and readable for that reason.

### 4.3 Decision record (trade rationale log) contents
**Design note**, synthesized from [S24c][S24b][S1][S12]:

| Field | Purpose |
|---|---|
| Run id, timestamps, IPS version, code commit | Reproducibility and change control [S24a] |
| Data snapshot ids with as-of times; data-gate verdict | Point-in-time proof against look-ahead (section 5.4) |
| Rule-plan order (side, qty, limit, stop) and the rule that fired | What the system would do with no discretion |
| Pre-trade check results, each pass/fail with values | 15c3-5-style evidence [S24b] |
| LLM proposal (schema-validated JSON), role, model id, prompt hash | Who recommended it and how [S24c] |
| Evidence list: claim → source id → quoted value | Every factual statement ties to a stored artifact |
| Final order, approval (owner/auto), placed/filled states, fills | Order memo [S24c]; reconciliation to broker [S1] |
| Post-trade: implementation shortfall vs decision price | Paper vs reality [S25] |

### 4.4 Attribution and evidence a non-quant owner can read
- **Brinson.** Brinson, Hood and Beebower, *Determinants of Portfolio Performance*, FAJ Jul/Aug 1986, split active return into **policy, timing (allocation) and security selection** [S26]. The CFA curriculum reading *Return Attribution* (Bacon and Wright) teaches the BHB and Brinson-Fachler forms with allocation, selection and interaction effects. The standard Brinson-Fachler per-segment terms are:
  - allocation = (wₚ−w_b)(R_b,i − R_b);
  - selection = w_b(Rₚ,i − R_b,i);
  - interaction = (wₚ−w_b)(Rₚ,i − R_b,i).
- **Layered attribution for this agent (Design note):** decompose each book's return versus its benchmark into:
  1. strategy-in-backtest vs benchmark (the alpha claim);
  2. live rule plan vs backtest (the implementation gap: costs, whole shares, timing [S25][S19]);
  3. overrides vs rule plan (the override scorecard);
  4. owner deviations (skipped orders, own trades).

  Contribution-to-return per position (weight × return) is the easiest table for a non-quant owner to read.
- **Explanations for non-technical readers.** CFA Institute, *Explainable AI in Finance* (C.-A. Wilson, 10 Sep 2025) [S27]:
  - Different stakeholders need different explanations.
  - It prefers "ante-hoc" built-in transparent rules over post-hoc explanations where possible.
  - It proposes **"evaluative AI" that presents evidence for and against a decision to reduce automation bias**.
  - It stresses human oversight.

  **Design note:** each proposal should show the case for, the case against (as in TradingAgents' bull/bear debate [S12]), what would change the decision, and the counterfactual in money.
- **Consistency:** keep the same risk metrics every period. Do not swap metrics to flatter results [S1].

---

## 5. LLM agent architecture for portfolio decisions

### 5.1 Published systems (what they are, what they claim)
- **TradingAgents.** Xiao, Sun, Luo and Wang, arXiv 2412.20138 (v1 28 Dec 2024) [S12]; open source [S12b].
  - Roles: analysts (fundamental, sentiment, news, technical) → bull and bear researchers debate for *n* rounds under a facilitator → trader → risk team (aggressive, neutral, conservative) → fund manager approves or adjusts.
  - Agents exchange **structured reports in a shared state**. Natural language is kept for debates, to avoid a "telephone effect".
  - Backtest: 1 Jan – 29 Mar 2024, with results reported for AAPL, GOOGL and AMZN. 11 LLM calls and 20+ tool calls per decision. The authors cite cost as the reason the window is short.
  - The repo calls itself a research tool "not intended as financial, investment, or trading advice" [S12b].
  - The current repo has a `run_backtest` that enters at the next close and uses point-in-time EDGAR data, as first reported. It withholds Yahoo statements for past dates because their publication dates cannot be verified [S12b].
- **FinMem.** Yu et al., arXiv 2311.13743, Nov 2023 [S13a]. Profiling, layered memory and decision modules. Claims improvements from tuning memory span and the character profile.
- **FinAgent.** Zhang et al., arXiv 2402.18485, Feb 2024 (v3 Jun 2024) [S13b]. A multimodal agent reading prices, news and charts, with dual-level reflection, memory retrieval and tool use. Claims a >36% average profit improvement over 9 baselines.

### 5.2 Independent evidence and failure modes
- **Short, narrow backtests overstate results.** FINSABER (Li, Kim, Cucuringu, Ma; arXiv 2505.07078, v1 May 2025 → v6 Jun 2026; KDD 2026) [S13c]:
  - Over two decades and 100+ symbols, the LLM advantages reported earlier "deteriorate significantly" once survivorship and data-snooping biases are controlled.
  - LLM strategies are "overly conservative in bull markets" and "overly aggressive in bear markets".
  - The authors recommend trend detection and regime-aware risk controls.
- **Memorization and look-ahead.**
  - *Profit Mirage* (arXiv 2510.07920, 9 Oct 2025) [S13e]: backtest gains of LLM agents disappear after the model's knowledge cutoff because of information leakage. The authors release a leakage-robust benchmark (FinLake-Bench) and use counterfactual perturbation (FactFin).
  - Glasserman and Lin (arXiv 2309.17322, Sep 2023) [S13d] separate **look-ahead bias** from a **"distraction effect"**, where the model's general knowledge of a company skews its reading of a headline. Removing company identifiers from headlines *improved* in-sample performance. Out of sample, look-ahead is not a concern, but distraction remains. They propose anonymization for de-biased backtests and for live use.
- **Live evaluation is different.**
  - LiveTradeBench (arXiv 2511.03628, Nov 2025) [S13f]: 50-day live runs of 21 LLMs. High general-benchmark (LMArena) scores do not imply better trading. Models show distinct risk styles.
  - Agent Market Arena (arXiv 2510.11695, Oct 2025) [S13g]: in live markets, **the agent framework shapes behaviour more than the model backbone does**.
- **Other failure modes and their mitigations (Design note):**
  - **Hallucinated numbers.** The LLM never sources data. Every number it uses must come from a tool result and be echoed with its source id. The checker verifies that quoted values match the stored snapshot.
  - **Overtrading.** Turnover caps, minimum trade size, hold bands, and allowing subtractions only [S18b][S20][S22a].
  - **Non-determinism.** Outputs vary between runs [S12b]. Store the prompt, model id and output. Consider majority voting across runs for vetoes (the "voting" pattern in [S15a]).
  - **Prompt injection from news or filings.** Treat retrieved text as data. Exclude it from tool-permission decisions.

### 5.3 Architecture pattern: LLM proposes, code checks
- Anthropic, *Building effective agents* (19 Dec 2024) [S15a]:
  - Prefer the simplest solution. Use workflows with predefined code paths when the task is well defined.
  - Put **programmatic "gates"** between steps.
  - Have agents get "ground truth from the environment at each step".
  - Pause for human checkpoints. Set stopping conditions.
  - Test "extensively in sandboxed environments".
  - Design tools ("poka-yoke") so mistakes are hard to make.
- **Structured outputs.** Claude's structured outputs guarantee schema-valid JSON through constrained decoding. However, **numeric constraints (`minimum`, `maximum`, `multipleOf`) and string-length constraints are not supported in the schema**, and refusals or `max_tokens` cut-offs can produce non-conforming output [S15b]. **Size, price and limit checks must therefore live in code, not in the schema.**
- **Recommended layering (Design note):**
  1. *Deterministic rule engine*: the same code as the backtest produces the rule plan.
  2. *Data gate*: freshness and completeness checks. If it fails, hold: no buys, exits only by stop.
  3. *LLM roles* (analyst, bull/bear, PM) read the rule plan and evidence. They return schema-validated JSON proposing **subtractions only**, each with reasons and evidence ids.
  4. *Checker in code*:
     - rejects any addition or size increase, and anything outside the IPS;
     - runs 15c3-5-style checks [S24b];
     - verifies evidence ids exist and quoted values match;
     - if the LLM output fails, falls back to the rule plan unchanged.
  5. *Human approval*: the owner places or approves the orders. Autonomy widens in stages only on scorecard evidence [S23][S24a].
  6. *Kill switch and breakers* in code [S24a][S2].
- **Backtestability of agent decisions:**
  - Replay the agent over history only on point-in-time snapshots, and only for dates **after the model's training cutoff** [S13e].
  - Anonymize tickers and company names in prompts where possible [S13d].
  - Use long and broad windows across regimes [S13c].
  - Since LLM replays are expensive and non-deterministic [S12][S12b], the main evidence should come from **forward live paper trading** with scorecards, as in LiveTradeBench [S13f].

### 5.4 Paper trading before live
- FINRA 15-09: pilot at limited size and scale up after results are confirmed; keep test and production separate [S24a].
- moomoo's `place_order` takes `trd_env=TrdEnv.SIMULATE` for paper trading, and paper accounts need no unlock. Paper trading does not support irregular hours [S10]. Quotas and limits are documented per interface [S9][S10].
- Under SEBI's glide path, brokers had to take part in exchange **mock sessions** by 3 Jan 2026 [S3]. That is a broker obligation, but it is the same principle.

---

## 6. India and US broker specifics

### 6.1 SEBI retail algo framework (timeline verified on sebi.gov.in)
| Date | Event | Source |
|---|---|---|
| 9 Dec 2021 | SEBI discussion paper on algo trading by retail investors | [S2] |
| **4 Feb 2025** | Circular SEBI/HO/MIRSD/MIRSD-PoD/P/CIR/2025/0000013, "Safer participation of retail investors in Algorithmic trading". Implementation standards due 1 Apr 2025; provisions effective 1 Aug 2025 | [S2] |
| 5 May 2025 | NSE circular NSE/INVG/67858 (Ref. 471/2025) issues the implementation standards | [S4] |
| 22 Jul 2025 | Exchanges issue detailed operational modalities (with clarifications in the second half of Sep 2025) | [S3] |
| 29 Jul 2025 | Effective date extended to 1 Oct 2025 | [S3] |
| **30 Sep 2025** | Circular CIR/2025/132: brokers that are ready go live 1 Oct 2025. Glide path: apply for registration of an API algo product and at least one strategy by 31 Oct 2025; complete registration by 30 Nov 2025; mock session by 3 Jan 2026. Brokers that miss these are barred from onboarding new API-algo clients from 5 Jan 2026. **From 1 Apr 2026 the framework applies to all brokers.** | [S3] |

**Key provisions** [S2][S4]:
- **Broker is principal, algo provider is agent.** No open APIs. Access only through a unique API key plus a whitelisted static IP, with OAuth and two-factor authentication [S2].
- **Self-developed algos.** They must be registered through the broker only when they exceed the order-per-second threshold, and can be used for the family (self, spouse, dependent children and parents) [S2].
- **TOPS = 10 orders per second per exchange/segment**, measured by the broker server's calendar second. Below this, no registration is needed, but orders get a **generic exchange algo ID** and pass broker risk checks. Orders above the limit are rejected. Brokers may set lower client limits [S4].
- **Static IP:**
  - one primary and an optional secondary;
  - changeable at most **once per calendar week**;
  - one client per IP, but shareable within a family on written or 2FA request;
  - non-registered algos must use **one designated API key** [S4].
- **"All API sessions shall be compulsorily logged out every day before the start of the next trading day."** [S4]
- Exchanges may restrict order types or securities for client algos. Exchanges keep a kill switch for each algo id. Audit trail is kept for at least 5 years [S2][S4].
- The broker Zerodha's summary (6 May 2025) adds that the static IP is needed only for order placement, IPv6 is allowed, and the IP need not be in India [S5]. This is a secondary source, so treat it as broker interpretation.

**Design note for this repo:**
- The current issues have the owner placing orders by hand from the agent's Order list, and importing ICICI tradebooks through a file inbox with no API (issues 23 and 42). Orders the owner keys in by hand are not API algo orders.
- If order placement through Breeze is added later, the system will need:
  - a static IP (once-weekly change limit);
  - a daily re-login;
  - limit orders only;
  - fewer than 10 orders per second (trivial at this scale);
  - acceptance that orders carry the broker's generic algo tag.

### 6.2 ICICI Direct Breeze API
From the official SDK README [S6] and the API docs [S7]:
- **Capabilities:**
  - orders: place, modify, cancel, square off, and GTT (single-leg and OCO);
  - account: order, trade and position books, demat and portfolio holdings, funds, margin and margin calculator, preview order (brokerage);
  - market data: quotes, option chain, instrument master;
  - historical charts v1 and v2 at 1 second (v2), 1, 5 and 30 minutes, and 1 day;
  - streaming: ticks, OHLCV candles, market depth, order notifications.
  - Exchanges: NSE, BSE, NFO, BFO [S6][S7].
- **Limits:**
  - "Breeze API is designed to accept 100 API calls per minute and 5000 API calls per day" [S7].
  - "A maximum combined limit of 10 orders per second", covering place, modify, cancel and square-off [S6][S7].
  - v2 historical requests return at most 1,000 candles per request, and historical data is **not corporate-action adjusted** [S6]. The lake must adjust it itself.
- **SEBI framework effects:**
  - "Market orders are not permitted". Orders marked market are converted to aggressive limits: LTP ± 3% for equity, checked against the exchange price band [S6][S7].
  - Margin and Option Plus orders via the API are prohibited [S6].
  - Orders only from the registered static IP, changeable once a week. Unregistered algos route through a single API key [S6][S7].
- **Auth:** log in at `api.icicidirect.com/apiuser/login?api_key=…` to get a session value, then call `generate_session(api_secret, session_token)` [S6][S7]. Daily logout is required by the NSE standard [S4]. The docs I read did not state session expiry.

### 6.3 moomoo OpenAPI
From the official docs, v10.11 [S8][S9][S10]:
- **Architecture:** the **OpenD** gateway runs locally or on a cloud server (Windows, macOS, CentOS, Ubuntu) and forwards a TCP protocol. SDKs exist for Python, Java, C#, C++ and JavaScript. Login is with a moomoo ID and password [S8].
- **Markets:** US stocks and ETFs on NYSE, NYSE American and Nasdaq, plus options and futures. OTC and US indices are not supported for quotes. Trading covers US, HK, A-shares, SG, JP, MY, AU and CA, depending on the entity. The same trading interfaces serve live and paper accounts [S8].
- **Quote quotas by asset tier:**
  - 100 subscriptions and 100 historical-candle symbols per rolling 7 days below HKD 10k;
  - 300 at HKD 10k or more;
  - 1,000 and 2,000 for higher tiers.
  - US stocks get LV3 quotes free "during promotion period".
  - Rules can change without notice [S9].
- **`place_order`:**
  - `trd_env` defaults to **REAL**. Pass `TrdEnv.SIMULATE` for paper.
  - Order types include normal (limit), market, stop, stop-limit, MIT, LIT, trailing stop and trailing stop-limit.
  - TIF is DAY or GTD.
  - US sessions are set with `session` (RTH, ETH, OVERNIGHT, ALL); `fill_outside_rth` is deprecated.
  - **Limit: 15 requests per 30 seconds per account, at least 0.02 s apart**, shared with combo orders.
  - **Live accounts must "unlock trade" before placing orders. Paper accounts need no unlock.** Paper trading does not support irregular hours [S10].
- **Design note:** default `trd_env` to SIMULATE in code and require an explicit, logged switch to REAL. The SDK default is REAL [S10], so this is a real footgun.

---

## 7. Open questions and gaps
- Exact IBD/MarketSmith distribution-day and follow-through thresholds: primary pages were unreachable (section 2.4).
- Whether NSE's 22 Jul 2025 operational modalities add order-type restrictions for client algos beyond the 5 May 2025 standards. Not read. They are referenced in [S3].
- Breeze session-token expiry: not stated in the pages read.
- The moomoo entity (moomoo US vs others) determines the account type and any pattern-day-trader rules. Not researched.
- The CFA *Return Attribution* reading itself was not opened. The Brinson-Fachler formulas above are the standard textbook form, checked against BHB 1986's framework [S26].

---

## Sources
All opened during this research, 2026-10-25.

- **[S1]** CFA Institute, *Elements of an Investment Policy Statement for Individual Investors* (May 2010). https://rpc.cfainstitute.org/-/media/documents/article/position-paper/investment-policy-statement-individual-investors.pdf
- **[S2]** SEBI circular SEBI/HO/MIRSD/MIRSD-PoD/P/CIR/2025/0000013, 4 Feb 2025. Page: https://www.sebi.gov.in/legal/circulars/feb-2025/safer-participation-of-retail-investors-in-algorithmic-trading_91614.html ; PDF: https://www.sebi.gov.in/sebi_data/attachdocs/feb-2025/1738665456458.pdf
- **[S3]** SEBI circular SEBI/HO/MIRSD/MIRSD-PoD/P/CIR/2025/132, 30 Sep 2025 (timeline extension and glide path). Page: https://www.sebi.gov.in/legal/circulars/sep-2025/extension-of-timeline-for-implementation-of-sebi-circular-dated-february-04-2025-on-safer-participation-of-retail-investors-in-algorithmic-trading-_96979.html ; PDF: https://www.sebi.gov.in/sebi_data/attachdocs/sep-2025/1759232056254.pdf
- **[S4]** NSE circular NSE/INVG/67858 (Ref. 471/2025), 5 May 2025, implementation standards. https://nsearchives.nseindia.com/content/circulars/INVG67858.pdf
- **[S5]** Zerodha Z-Connect, overview of NSE's retail algo circular (6 May 2025; secondary). https://zerodha.com/z-connect/general/a-comprehensive-overview-of-nses-circular-on-the-new-retail-algo-trading-framework
- **[S6]** ICICI Securities, Breeze Python SDK README. https://github.com/Idirect-Tech/Breeze-Python-SDK
- **[S7]** ICICI Direct Breeze API documentation. https://api.icicidirect.com/breezeapi/documents/index.html
- **[S8]** moomoo OpenAPI introduction (doc v10.11). https://openapi.moomoo.com/moomoo-api-doc/en/intro/intro.html
- **[S9]** moomoo OpenAPI authorities and quotas. https://openapi.moomoo.com/moomoo-api-doc/en/intro/authority.html
- **[S10]** moomoo OpenAPI `place_order`. https://openapi.moomoo.com/moomoo-api-doc/en/trade/place-order.html
- **[S12]** Xiao et al., *TradingAgents: Multi-Agents LLM Financial Trading Framework*, arXiv 2412.20138. https://arxiv.org/html/2412.20138v4
- **[S12b]** TauricResearch/TradingAgents repository. https://github.com/TauricResearch/TradingAgents
- **[S13a]** Yu et al., *FinMem*, arXiv 2311.13743 (Nov 2023). https://arxiv.org/abs/2311.13743
- **[S13b]** Zhang et al., *FinAgent*, arXiv 2402.18485 (Feb 2024). https://arxiv.org/abs/2402.18485
- **[S13c]** Li, Kim, Cucuringu, Ma, *Can LLM-based Financial Investing Strategies Outperform the Market in Long Run?* (FINSABER), arXiv 2505.07078. https://arxiv.org/abs/2505.07078
- **[S13d]** Glasserman and Lin, *Assessing Look-Ahead Bias in Stock Return Predictions Generated by GPT Sentiment Analysis*, arXiv 2309.17322 (Sep 2023). https://arxiv.org/abs/2309.17322
- **[S13e]** Li et al., *Profit Mirage: Revisiting Information Leakage in LLM-based Financial Agents*, arXiv 2510.07920 (Oct 2025). https://arxiv.org/abs/2510.07920
- **[S13f]** Yu, Li, You, *LiveTradeBench*, arXiv 2511.03628 (Nov 2025). https://arxiv.org/abs/2511.03628
- **[S13g]** Qian et al., *When Agents Trade: Live Multi-Market Trading Benchmark for LLM Agents*, arXiv 2510.11695 (Oct 2025). https://arxiv.org/abs/2510.11695
- **[S15a]** Anthropic, *Building effective agents* (19 Dec 2024). https://www.anthropic.com/engineering/building-effective-agents
- **[S15b]** Claude API docs, *Structured outputs*. https://platform.claude.com/docs/en/build-with-claude/structured-outputs
- **[S16]** Faber, *A Quantitative Approach to Tactical Asset Allocation* (2006; JWM 2007; 2013 update). https://mebfaber.com/wp-content/uploads/2016/05/SSRN-id962461.pdf
- **[S17]** Harvey, Hoyle, Korgaonkar, Rattray, Sargaison, Van Hemert, *The Impact of Volatility Targeting*, JPM 45(1) 2018. https://people.duke.edu/~charvey/Research/Published_Papers/P135_The_impact_of.pdf
- **[S18a]** Garleanu and Pedersen, *Dynamic Trading with Predictable Returns and Transaction Costs*, NBER w15205. https://www.nber.org/papers/w15205
- **[S18b]** Novy-Marx and Velikov, *A Taxonomy of Anomalies and their Trading Costs*, NBER w20721. https://www.nber.org/papers/w20721
- **[S19]** Clarke, de Silva, Thorley, *Portfolio Constraints and the Fundamental Law of Active Management*, FAJ 58(5) 2002. https://rpc.cfainstitute.org/research/financial-analysts-journal/2002/portfolio-constraints-and-the-fundamental-law-of-active-management
- **[S20]** Jaconetti, Kinniry, Zilbering (Vanguard), *Best Practices for Portfolio Rebalancing* (2010; AAII reprint). https://www.aaii.com/files/journal/pdf/best-practices-for-portfolio-rebalancing.pdf
- **[S21]** MarketSmith India, *From Distribution to Demand: How a New Uptrend Is Born* (10 Apr 2026). https://marketsmithin.substack.com/p/from-distribution-to-demand-how-a
- **[S22a]** Fildes, Goodwin, Lawrence, Nikolopoulos, *Effective forecasting and judgmental adjustments*, IJF 25(1) 2009. https://eprints.lancs.ac.uk/id/eprint/45487/
- **[S22b]** Blattberg and Hoch, *Database Models and Managerial Intuition: 50% Model + 50% Manager*, Management Science 36(8) 1990. https://ideas.repec.org/a/inm/ormnsc/v36y1990i8p887-899.html
- **[S23]** BIS Basel Framework CRE36 (IRB minimum requirements; CRE36.44 Overrides). https://www.bis.org/committees/bcbs/basel-framework/standard/cre/36/inforce/2023-01-01/published/2022-12-08
- **[S24a]** FINRA Regulatory Notice 15-09 (Mar 2015). https://www.finra.org/rules-guidance/notices/15-09
- **[S24b]** 17 CFR 240.15c3-5 (SEC Market Access Rule). https://www.law.cornell.edu/cfr/text/17/240.15c3-5
- **[S24c]** 17 CFR 275.204-2 (SEC adviser books and records). https://www.law.cornell.edu/cfr/text/17/275.204-2
- **[S25]** Article on implementation shortfall (cites Perold 1988, JPM). https://www.cis.upenn.edu/~mkearns/finread/impshort.pdf
- **[S26]** Brinson, Hood, Beebower, *Determinants of Portfolio Performance*, FAJ Jul/Aug 1986 (reprint). https://indexacapital.com/bundles/unaiadvisor/docs/papers/1986-Brinson-Determinants-of-Portfolio-Performance-I.pdf?v=241
- **[S27]** CFA Institute press release, *Explainable AI in Finance* (10 Sep 2025). https://www.cfainstitute.org/about/press-room/2025/explainable-ai-in-finance-2025
