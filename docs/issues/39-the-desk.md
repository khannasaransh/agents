# 39: The Desk

**What to build:** Three analysts, Events, Chart and Risk, each write their own view of the names `pd plan` asks them to review. An analyst no name needs isn't called, so a quiet day costs few calls. The analysts can only subtract; their views are evidence in the Portfolio Manager's Decision records. An early exit the Desk proposes waits for Saransh's approval and then lands on the next Rule plan. See the stocks Pipeline PRD's Desk Step and "Agents".

**Repos:** agents, ash_new

**Blocked by:** 34: The Portfolio Manager, the Playbook and the final check; 37: India Feeds and the dossiers

**Status:** ready-for-agent

- [ ] Each analyst is an Agent, read-only in the Run folder:
  - Events runs on Claude Code and reads results dates, guidance, pledges, promoter selling, governance and filings;
  - Chart runs on Codex and judges how far a stock is extended from its base, its distribution days and its gaps down on volume;
  - Risk runs on Claude Code and looks for concentrations sectors miss (one theme, one promoter group, five names reporting in one week) and for thin liquidity.

  Each falls back to the other Worker. Their instructions say what each may read and do, and state the Mandate.
- [ ] A Desk Step calls only the analysts `pd plan` asks for, all at once. Each reviews its own names, with their dossiers and Feeds. The Step skips itself when no analyst is needed.
- [ ] A view of a name is reused, with its date, while nothing that analyst reads for the name has changed.
- [ ] A buy whose review was required but is missing, because the Desk or the Portfolio Manager failed, waits a session. It never goes out under the Rule plan's fallback. Its Book's sales and Disaster stops still go out.
- [ ] Web search:
  - Events and Risk may use their Worker's web search, only to check one item and citing its source;
  - Chart has no web access;
  - no search ever contains Saransh's holdings, sizes or amounts.
- [ ] Each analyst's output is checked against a schema. For each name it gives no view, a veto, a trim to a given size, or a proposed exit, with reasons and the evidence cited.
- [ ] The Portfolio Manager gets the views, and each of its Decision records names the views it follows.
- [ ] A proposed early exit becomes a Brief item. An approving Answer puts the sale on the next Rule plan.
- [ ] The Brief shows the analysts' views behind each change.
- [ ] Tests:
  - each analyst called gets its inputs, and an analyst no name needs isn't called;
  - a reused view keeps its date;
  - each falls back to the other Worker;
  - a buy whose required view is missing waits under the fallback;
  - an early exit is approved and lands in the next Rule plan;
  - a search query carries no amounts.
