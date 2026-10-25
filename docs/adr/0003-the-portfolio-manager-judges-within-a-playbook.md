# The Portfolio Manager judges within a Playbook, not only by subtracting

The Rule plan is where a Book's Order list starts, not what Saransh holds. Market conditions and the Book as it stands call for judgement the strategies don't make: how much to hold in stocks, which of the names the strategies surfaced to take, and at what size. So each Book has a Playbook: the Levers the Portfolio Manager may pull beyond the Rule plan, each with the data it must read and a range Saransh approves. The final check in code accepts a change only inside the Mandate, inside its Lever's range, allowed by the Book's Judgement mode, and with a complete Decision record whose cited figures match the Run's inputs. Anything else falls back to the Rule plan.

Judgement still starts by subtracting. Real Books run in *subtract only* mode until the agent's judgement has matched the strategies on paper; paper Books run in *Playbook* mode from their first Run. Exposure can only be cut below the level code sets from the Market condition, and sizes only go down until the override scorecard shows upsizing adds.

## Considered Options

- **Subtract only, everywhere** (the stocks PRD as first written): rejected. It can veto and trim, but can't choose between the names the strategies surfaced or hold cash in a weak market, which is most of what Saransh does by hand.
- **Free judgement within the Mandate**: rejected. Its record could never be backtested, because a language model already knows how past markets turned out, and nothing would tie a position back to a strategy Saransh approved.
- **Exposure set by the Portfolio Manager within a band**: deferred. Code sets the level from the Market condition, so the level is in the Book backtest, and the Portfolio Manager may only cut it. A band can follow once the scorecard shows its cuts add.

## Consequences

- Every position traces to a strategy: the Portfolio Manager buys only names in its Book's Pool, those an approved strategy surfaced in the last 2 months.
- The Book backtest includes the exposure level by Market condition, so the rule part of the judgement is tested. The Portfolio Manager's own choices earn their record forward, on the paper Books, scored by Lever against the Rule plan alone. Whether a real Book moves to Playbook mode is decided by the paper Book's gap to a rules-only paper Book (ADR 0004).
- A Book's Judgement mode and its Playbook ranges change only by Saransh's Answer. A Lesson may propose a range change; a wider range needs the scorecard's support.
- The Desk still only subtracts: its analysts veto, trim or propose exits, and their views are evidence in the Portfolio Manager's Decision records.
