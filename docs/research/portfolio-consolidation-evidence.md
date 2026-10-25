# Portfolio consolidation: evidence and design implications

Research date: 25 October 2026. Companion evidence memo for the [ash_backend / ash_new consolidation plan](D:/Saransh/agents/docs/research/portfolio-consolidation-plan.md). This memo researches architecture and evaluation; it does not approve investment parameters, confirm account scope, or recommend securities. All implementation proposals below are **design inferences**, not empirically demonstrated investment improvements.

**Owner clarification for the design:** the agent automatically makes portfolio decisions inside approved limits, and the owner places the trades. Individual in-mandate decisions do not need another approval. Changes to the mandate or decisions outside its envelope require owner approval. The investment objective is better returns while managing drawdown within owner-defined limits. The existing stocks PRD records numerical settings; reconcile those into the effective mandate rather than treating this research as fresh approval. Market gaps mean an observed loss ceiling cannot be guaranteed.

## 1. What the evidence actually supports

The promising product is an accountable portfolio decision system: approved strategies propose opportunities; a construction layer translates them into a feasible portfolio; a bounded judgment layer evaluates context; deterministic checks govern action; the dashboard explains the resulting decision. Superior returns remain a hypothesis to test. Better reconciliation, fewer unapproved actions, clearer reasons, and lower operational effort are independently measurable benefits.

| Evidence reviewed | Supported conclusion | Boundary of the evidence |
|---|---|---|
| CFA Institute, *Elements of an Investment Policy Statement for Individual Investors* [1] | Explicit objectives, scope, governance, constraints, reporting and rebalancing belong in the mandate. | Its example language and numerical limits are fictitious illustrations, not suitable default parameters for this owner. |
| Boyd et al., *Multi-Period Trading via Convex Optimization* [2] | Portfolio construction can combine forecasts, current holdings, risk, transaction costs and constraints. Multi-period methods can plan ahead and execute only the first step. | It deliberately leaves forecasting unspecified; a better optimizer does not create better forecasts. Model and cost assumptions remain approximations. |
| Novy-Marx and Velikov, *A Taxonomy of Anomalies and their Trading Costs* [3] | Costs matter; differing buy and hold thresholds can reduce unnecessary turnover. | Evidence concerns the tested anomaly portfolios. Their thresholds and profitability do not transfer automatically to this portfolio. |
| FINSABER, v6, June 2026 [4] | Broader, longer evaluation substantially weakens earlier LLM investing claims; behavior differs across regimes. | Evaluated models and timing strategies are a sample, not proof that all future agents fail or that a particular regime rule succeeds. |
| *Profit Mirage*, October 2025 preprint [5] | Historical LLM evaluation can be contaminated by learned future information. | The authors also promote their own mitigation method. Neither their system nor a declared training cutoff certifies leakage-free performance here. |
| Bailey et al., *The Probability of Backtest Overfitting* [6] | Searching many configurations can select historical luck; evaluate selection procedures, not just the winner. | A statistical correction does not cure bad data, unrealistic execution, regime change or implementation errors. |
| Anthropic, *Building effective agents* [7] | Fixed workflows and dynamic agents serve different needs; begin with simple patterns and add complexity when justified. | Engineering guidance, not investment-performance evidence. The page itself notes that tooling has changed since 2024. |
| LangGraph persistence and interrupts documentation [8–9] | Persisted state enables resumption and approvals; resumed nodes can execute again, so side effects need careful idempotency. | Checkpoints are not an order ledger and do not by themselves establish exactly-once broker execution. |
| FINRA Regulatory Notice 15-09 [10] | Change control, separate testing, monitoring, controls and limited-size pilots are useful operational practices. | Guidance addresses regulated firms. It is used here as an engineering analogue, not a declaration of this owner's legal obligations. |

## 2. Corrections to the earlier portfolio research

The earlier `portfolio-agent-research.md` remains useful source discovery, but the following conclusions should not become requirements without revision.

1. **“Subtract only” is an optional authority choice, not a finding about profitable equity discretion.** Fildes et al. [11] studied demand forecasts in supply chains. A downward forecast adjustment is not equivalent to selling stock. Selling a diversifier, realizing tax, removing a hedge, or abandoning an approved long-term allocation can worsen outcomes. Allowing only vetoes or trims could be a deliberately conservative launch scope, but must be an owner-approved restriction with measured opportunity cost. The target architecture should also represent approved additions, substitutions, delayed entries and rebalancing.
2. **Invalid LLM output must not automatically release the rule plan.** A baseline plan still needs independent data, holdings, policy, cash, open-order and freshness validation. Model failure and data failure are different conditions. Releasing a baseline after discovering an event-risk concern may bypass the reason review was required. Any unattended fallback must be a separately approved mode.
3. **“Hold, exits only by stop” is not a universal safe state.** Position data might be wrong, orders may already be pending, prices may be stale, and an application outage does not imply that broker-held stops should be canceled or duplicated. Define response per failure type, and independently specify how existing protective orders are monitored. A hold is an exposure decision, not absence of risk.
4. **Do not import illustrative limits or scope as owner approval.** Broker, exchange, country, leverage, derivatives, tax and account assumptions must be established from the actual mandate. This memo intentionally does not reassert the older document's regulatory deadlines or API quotas; reverify the relevant primary broker and exchange documentation at the execution-adapter gate.
5. **Training-cutoff filtering is helpful but insufficient.** Exact training data may be unknown; revised financials, present-day index membership, delayed publication dates and retrieval can leak future information. A genuinely forward, frozen-model shadow record is stronger evidence than selecting a seemingly uncontaminated historical interval.

## 3. Separate three decisions the user currently combines

**Design proposal.** Separate investment authority, portfolio judgment and execution authority. An approved strategy means that a versioned rule may supply candidates. It does not automatically authorize every candidate as a holding, and it does not automatically authorize sending orders.

Maintain four independently versioned objects:

- **Strategy specification:** eligibility, entry/exit logic, feature definitions, horizon, priority, permitted instruments and approved version. Rank scores are not expected returns unless separately calibrated.
- **Portfolio mandate:** managed accounts, base currency, objectives, benchmark, liquidity needs, position/sector/theme/currency limits, allowed strategy budgets, turnover, risk metrics and emergency procedures.
- **Discretion policy:** decisions the agent may alter, evidence required, maximum deviation from the baseline, time limits, escalation conditions and owner approval requirements.
- **Execution policy:** manual placement by the owner in the present target, permitted order types, session and price rules, decision validity window, partial-fill handling and authorized emergency actions. API placement is a separate future scope change.

Use separate hard constraints and soft preferences. Hard constraints make a proposal ineligible. Soft preferences rank feasible proposals and expose tradeoffs. If no feasible portfolio exists—perhaps inherited holdings already breach a cap—report the conflict and propose an approved remediation path. Do not silently relax the cap or pretend the current holdings are compliant.

“Manage it as I would” requires examples of the owner's choices, including declined trades and no-action decisions. Capture the facts available then, the alternative considered and the reason. Turn repeated preferences into a proposed policy change; keep unapproved preferences as suggestions. Do not let memory silently rewrite authority.

## 4. Construction before discretion, and construction after discretion

**Design proposal.** Begin each run with a reconciled account snapshot: quantities, settled and unsettled cash, corporate actions, open orders, reservations, currency conversions, valuation times and any unclassified holdings. Preserve legacy or owner-directed holdings with explicit management status. Avoid double allocation when multiple strategies select the same security.

The baseline construction engine produces a feasible target and trade list from approved strategy candidates. It should consider cost, existing exposure, concentration, liquidity, minimum trade size, integer shares and horizon. Start with explicit sizing and allocation rules that can be explained. Introduce mathematical optimization only if those rules create demonstrable allocation conflicts; do not ask an LLM to invent covariance estimates or precise return expectations.

The judgment layer receives the baseline plus the same evidence the dashboard displays. It may compare alternatives within the approved discretion envelope: buy now versus wait; increase one approved holding versus select another; retain a position versus rotate; hold cash versus deploy it; reduce exposure versus preserve the baseline. Each proposal includes the baseline difference and the reason it matters at portfolio level.

Then reconstruct and revalidate the **whole** portfolio. Checking each proposed trade independently misses combined cash use, correlated concentration, net exposure and outstanding orders. Every amended target passes the same deterministic construction and policy checks. The optimizer or sizing engine owns arithmetic; the model supplies bounded hypotheses, categorical judgments and source-grounded reasoning.

Example, entirely illustrative: an approved strategy finds two eligible leaders, but the portfolio already has substantial exposure to their shared sector. The agent proposes a smaller allocation to one and defers the other, using the owner's sector limit and an event-risk policy. The decision card shows the unconstrained signal, feasible baseline, discretionary change, rejected alternative, resulting exposure and review trigger. No numerical limit in this example is an adopted default.

## 5. Dynamic workflows: choose the investigation, preserve the controls

**Design proposal.** Use a durable state machine with optional research branches. A framework is optional; the required behavior is not.

```text
Trigger -> snapshot/reconcile -> validate evidence -> strategy candidates
        -> construct baseline -> classify decision complexity
        -> optional bounded research -> compare alternatives
        -> construct final target -> deterministic gates
        -> out-of-mandate approval if needed -> refresh/revalidate
        -> owner trade instructions -> import/confirm fills -> reconcile -> evaluate
```

Suggested routes:

| Condition | Work to perform | Exit condition |
|---|---|---|
| No material portfolio or evidence change | Refresh status; explain no action | Recorded no-action decision with next review trigger |
| Straightforward strategy signal inside policy | Baseline construction and evidence check | Feasible proposal or explicit rejection |
| Event, regime uncertainty or conflicting signals | Retrieve relevant primary evidence, compare alternatives, optionally use an independent critic | Evidence sufficient or escalate; bounded time/tool budget |
| Concentration or liquidity conflict | Deterministic portfolio what-if calculations | Feasible alternative or documented infeasibility |
| Missing data, conflicting holdings or uncertain order submission | Reconciliation and incident route | Verified state before renewed planning |
| Proposed mandate or strategy change | Research, replay and owner review | New approved version; never self-promote during a trade run |

The agent may choose which approved analysis to run, but may not choose to omit reconciliation, policy checking, approval rules or the execution log. An in-mandate decision proceeds directly to owner trade instructions; clicking another approval button is not required. Stop research when its information budget expires. More analyst personas do not establish independent evidence: several agents can repeat the same underlying error. Add a second model or critic only when measured error reduction justifies its cost.

Pin the run to a workflow version and record branch decisions. Separate approval from side effects. A resumed approval must compare current holdings, prices, cash, policy version and pending orders with the approved proposal. Material change invalidates approval and creates a new proposal.

For the present manual workflow, record issued instructions separately from submitted orders and confirmed fills. Never assume that showing a buy instruction changed the portfolio. Give instructions an expiry and reference-price tolerance, reserve planned cash, permit the owner to report skipped/changed/partially filled trades, and reconcile imports before issuing overlapping instructions. Withdrawal or replacement of an instruction must be visible to the owner. Manual latency belongs in performance attribution.

If API execution is approved later, persist an execution intent before contacting a broker. Use a stable idempotency key where supported; when the result is ambiguous, query broker state before retrying. Never infer that a timed-out call failed to place the order. Handle partial fills and cancel/replace as explicit states. LangGraph's replay semantics [9] make this distinction especially important.

## 6. Evidence should explain the decision, not imitate hidden reasoning

**Design proposal.** The audit artifact is a structured decision record, not an alleged transcript of the model's internal thought. Link independently checkable claims and calculations to the proposed action.

Minimum decision record:

- Identity: decision/run/account IDs, trigger, code/model/prompt/workflow versions, strategy and mandate versions.
- Inputs: snapshot IDs, source URLs or document IDs, content hashes, publication time, ingestion time, observation time, timezone and freshness verdict. Revised facts retain their earlier versions.
- Baseline: approved strategy signal, deterministic construction, constraint effects and feasible no-discretion target.
- Judgment: permitted action class, observed facts, assumptions, uncertainty, rejected alternatives, portfolio impact and a condition that would reverse or revisit the choice.
- Checks: each rule's observed value, allowed value and verdict; whole-book cash and risk calculations; explanation-to-evidence consistency checks.
- Authority: approval scope, approver, proposal hash, expiration, revalidation result and any owner amendment.
- Outcome: submitted order, broker identity, fills, fees, changes, cancellations, reconciliation and eventual evaluation.

The visible card should answer: **What changed? Why now? Why this action for my existing portfolio? Which approved rule permits it? What argues against it? What would change the decision?** Put detailed source data behind expandable links. Label observed facts, derived metrics and judgment separately. If evidence is unavailable, show that absence instead of generating a confident substitute.

Record every material **hold**, **defer**, **reject** and **abstain** alongside trades. Otherwise the database learns only from action and hides missed opportunities. Retain untrusted news and filings as data; their text cannot grant tool access or modify authority. Validate cited numbers against stored values and require provenance for market-sensitive assertions.

## 7. Measure incremental value, not persuasive explanations

**Design proposal.** Establish a prospective evaluation protocol before tuning. Run parallel, self-financing shadow books with the same initial capital, deposits/withdrawals, available universe, observation times, cost assumptions and execution opportunities:

1. Owner-approved benchmark or policy portfolio.
2. Approved strategy with feasible deterministic construction, including costs.
3. The same construction plus agent judgment.
4. Actual implementation, including owner changes and real fills.

This separates strategy merit from construction, discretionary changes and execution. Maintain both a continuing shadow book and localized decision comparisons. The latter ask what the baseline alternative would have done from the identical pre-decision state over a predeclared horizon. They are estimated counterfactuals: capital constraints and subsequent decisions interact, so the sum of trade-level “value added” is not necessarily the portfolio-level difference.

Report net return and money impact together with drawdown, downside behavior, exposure, turnover, concentration, liquidity, benchmark-relative behavior and implementation cost. Group discretionary differences by action type, reason, market regime and evidence quality. Estimate uncertainty with methods appropriate to serially dependent observations; avoid treating related daily or position outcomes as independent successes. Explain when there are too few observations to infer anything useful.

Use a separate operational scorecard: policy breaches, invalid evidence, stale-input use, failed reconciliation, duplicate execution, approval-invalidations handled correctly, abstention rate, explanation coverage, owner correction rate, decision latency and operating cost. An owner agreeing with an agent is a usability signal, not investment alpha.

Historical testing must use point-in-time universe membership, contemporaneously published financials/news, corporate actions, realistic decision-to-fill timing, spreads and fees. Preserve a sealed forward period, log every strategy/prompt/model variant, and freeze versions during comparisons. Stress missing quotes, duplicated imports, portfolio drift, API timeouts, market gaps and conflicting evidence. A paper fill cannot establish real liquidity or market impact.

Promote capabilities in stages: read-only consolidated reporting; shadow decisions; automatic in-mandate decisions with owner trade placement. Broker automation is optional future work, not a prerequisite or the current target. Promotion requires both operational reliability and evidence appropriate to the owner's return and drawdown objective. Evaluate returns at comparable risk/exposure, and drawdown level, duration and recovery, rather than rewarding de-risking solely for reducing a volatility statistic. A few profitable weeks is insufficient to establish persistent superiority. Increased authority is a policy decision, never a reward the agent assigns itself after a winning run.

## Sources and access notes

All references below were checked on 25 October 2026. Source publication dates are distinct from retrieval dates. Primary academic papers, author repositories and official documentation were preferred; no secondary investment commentary is relied upon.

1. CFA Institute (2010), [Elements of an Investment Policy Statement for Individual Investors](https://rpc.cfainstitute.org/sites/default/files/-/media/documents/article/position-paper/investment-policy-statement-individual-investors.pdf). Full PDF opened. Scope/governance/objectives/risk sections; introduction explicitly cautions against copying fictitious example wording.
2. Boyd et al. (2016/2017), [Multi-Period Trading via Convex Optimization](https://web.stanford.edu/~boyd/papers/pdf/cvx_portfolio.pdf). Full author-hosted PDF opened, especially abstract and introduction. Optimization formulation, assumptions and forecasting boundary.
3. Novy-Marx and Velikov (2014 working paper; 2016 journal publication), [A Taxonomy of Anomalies and their Trading Costs](https://www.nber.org/papers/w20721). NBER abstract and indexed primary PDF passage retrieved; direct landing-page fetch returned 403. Claim is limited to abstract and buy/hold methodology exposed in the primary results.
4. Li et al. (2026, v6), [Can LLM-based Financial Investing Strategies Outperform the Market in Long Run?](https://arxiv.org/html/2505.07078v6). Full HTML opened. Longer/broader evaluation and regime behavior; version notes disclose corrected FinAgent results with conclusions unchanged.
5. Li et al. (2025 preprint), [Profit Mirage: Revisiting Information Leakage in LLM-based Financial Agents](https://arxiv.org/html/2510.07920v1). Full HTML opened. Memorization and evaluation design concerns; claims about the authors' own method are not treated as independently replicated evidence.
6. Bailey et al. (2015 manuscript; 2017 publication), [The Probability of Backtest Overfitting](https://www.davidhbailey.com/dhbpapers/backtest-prob.pdf), with [University of California repository record and abstract](https://escholarship.org/uc/item/4w1110bb). Primary author/repository material retrieved. Used for selection-bias principle, not a numerical guarantee.
7. Anthropic (2024, live page retrieved 2026), [Building effective agents](https://www.anthropic.com/research/building-effective-agents). Workflows, dynamic agents, simple composition and gates.
8. LangChain, [LangGraph persistence](https://docs.langchain.com/oss/python/langgraph/persistence). Official current documentation. Checkpointers versus stores and persistence scope.
9. LangChain, [LangGraph interrupts](https://docs.langchain.com/oss/python/langgraph/interrupts). Official current documentation. Resume behavior and idempotent side effects.
10. FINRA (2015), [Regulatory Notice 15-09](https://www.finra.org/rules-guidance/notices/15-09). Official guidance, including limited-size pilots, monitoring and development controls. Used as an operational analogy only.
11. Fildes et al. (2009), [Effective forecasting and judgmental adjustments: an empirical evaluation and strategies for improvement in supply-chain planning](https://eprints.lancs.ac.uk/id/eprint/45487/). Author-university record and abstract opened. Its domain is demand forecasting, which is why an equity “subtract-only” mandate cannot be inferred from it.
