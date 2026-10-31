# Decision follow-up, 31 October 2026

This records Saransh's replies to items 5–20. Explanations and recommendations below are not approvals to change the remaining rules.

## Accepted and deferred

- **5–7:** defer Market condition thresholds/exposure and any associated Candidate rerun, Playbook ranges, and the paper-versus-rules-only gate. Existing placeholders are not newly approved.
- **8:** constant annual risk-free rates: IN 0.06, US 0.03, HK 0.03. Saved through the running ash_new Settings API and read back successfully. Existing stored reports were not recomputed. A historical rate series is not implemented by changing these constants.
- **9:** interpret "ok" as accepting the existing ability to approve a new version into Paper without a mandatory Candidate-test pass; later promotion gates remain.
- **10:** accept Paper demotion to Retired. The upper-tail promotion block remains unchanged pending discussion.
- **12:** accept holding every reviewed buy if the Portfolio Manager fails, and Claude Code first for Chart.
- **14:** agents' local SEC_CONTACT now contains Saransh's name and the existing configured email. The normal pd wrapper passes it as PDASH_SEC_CONTACT. This config check does not establish successful live EDGAR access.
- **15:** MarketSmith secrets belong in `D:/Saransh/backend/portfolio-dashboard/.env`: `PDASH_MS_INDIA_AUTH` is the India ms-auth token value; `PDASH_MS_GLOBAL_COOKIE` is the full marketsmith.hk Cookie header for US/HK. The old ash_backend names are MS_INDIA_AUTH and MS_HK_COOKIE respectively. Do not copy the old variable names unchanged.
- **16–17:** VM deployment and Discord setup remain open; no new instruction was given.
- **18:** Sash remains. Paper portfolios go to Supabase `watchlists`; real portfolios go to `portfolios`. Saransh clarified that the alarm decision stays open. This records the destination, not completed synchronization. Preserve backend app dependencies until replacements work; legacy PM_BUY retirement remains a separate decision.
- **19:** contract-note brokerage costs deferred.

## Explanations requested

**10 — Why the upper 95th percentile?** The current gate compares live returns with all equal-length historical backtest windows. It treats either tail as outside the tested range. The upper tail can indicate unusual luck, a mismatch in data or execution, or a bug, but strong returns alone do not establish a problem. Recommendation: retain the lower-tail/drawdown gates and make the upper tail a review flag rather than an automatic promotion block. No rule changed yet.

**11 — Attribution.** "Sleeve weights" is the benchmark return earned on the capital allocated to each Sleeve, not proof that the weight was optimal. A Sleeve with 40% of the Book and a 2% benchmark return contributes approximately 0.8 percentage points from market exposure. If it earns 3%, its additional 0.4 points are stock selection. Actual code links daily contributions across the month and handles costs, cash, gold, FX and Overrides separately. Correlation uses each strategy's backtested daily returns over the trailing year, not actual live Sleeve returns. Label it historical strategy correlation; +1 means moving together, 0 little linear relationship, -1 opposite movement.

**12 — Analyst folders.** Give each analyst only its sanitized input and relevant dossiers, omitting cash balances, share counts, full ledgers and credentials. A separate folder makes inputs clearer but is not an access boundary on its own: enforce allowed reads or provide a genuinely isolated filesystem. Merely changing the working directory does not prevent reads elsewhere. This remains a proposal.

**13 — Override scorecard.** Currently `came_true` means the Override financially beat the Rule plan by the predeclared review session. That does not prove its written thesis happened: vetoing a stock before a general selloff can win even if the predicted company event never occurs. Recommendation: label the deterministic metric "beat Rule plan" and assess the factual thesis separately. Widening means allowing more discretion (for example a longer wait or a lower minimum size). Currently the evidence gate also refuses Saransh's own widening through `pd judgement propose`; direct config editing is still possible. Recommendation: retain the same default gate, with any owner exception explicit, reasoned and recorded, rather than silently bypassing it. No change made pending his decision.

**20 — Search recommendation.** Keep read-only filesystem permissions and independently allow the built-in WebSearch tool only for Events and Risk. The existing Claude adapter already adds WebSearch when webSearch is enabled; the Codex adapter selects live search. Prefer filings, exchanges and company releases, query only public company/event facts, and retain source URLs and retrieval times. Do not enable arbitrary network shell commands as a substitute. Treat retrieved content as evidence, not instructions. This is a recommendation plus source inspection, not an end-to-end live-search verification. Official Codex guidance: https://learn.chatgpt.com/docs/web-search.
