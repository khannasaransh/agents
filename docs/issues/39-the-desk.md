# 39: The Desk

**What to build:** Three analysts, Events, Chart and Risk, each write their own view of the names `pd plan` asks them to review. An analyst no name needs isn't called, so a quiet day costs few calls. The analysts can only subtract; their views are evidence in the Portfolio Manager's Decision records. An early exit the Desk proposes waits for Saransh's approval and then lands on the next Rule plan. See the stocks Pipeline PRD's Desk Step and "Agents".

**Repos:** agents, ash_new

**Blocked by:** 34: The Portfolio Manager, the Playbook and the final check; 37: India Feeds and the dossiers

**Status:** done, but for its first Run on real data: no strategy is in Paper yet, so no paper Book has a buy to review (see "Not done")

- [x] Each analyst is an Agent, read-only in the Run folder:
  - Events runs on Claude Code and reads results dates, guidance, pledges, promoter selling, governance and filings;
  - Chart runs on Codex and judges how far a stock is extended from its base, its distribution days and its gaps down on volume;
  - Risk runs on Claude Code and looks for concentrations sectors miss (one theme, one promoter group, five names reporting in one week) and for thin liquidity.

  Each falls back to the other Worker. Their instructions say what each may read and do, and state the Mandate.
- [x] A Desk Step calls only the analysts `pd plan` asks for, all at once. Each reviews its own names, with their dossiers and Feeds. The Step skips itself when no analyst is needed.
- [x] A view of a name is reused, with its date, while nothing that analyst reads for the name has changed.
- [x] A buy whose review was required but is missing, because the Desk or the Portfolio Manager failed, waits a session. It never goes out under the Rule plan's fallback. Its Book's sales and Disaster stops still go out.
- [x] Web search:
  - Events and Risk may use their Worker's web search, only to check one item and citing its source;
  - Chart has no web access;
  - no search ever contains Saransh's holdings, sizes or amounts.
- [x] Each analyst's output is checked against a schema. For each name it gives no view, a veto, a trim to a given size, or a proposed exit, with reasons and the evidence cited.
- [x] The Portfolio Manager gets the views, and each of its Decision records names the views it follows.
- [x] A proposed early exit becomes a Brief item. An approving Answer puts the sale on the next Rule plan.
- [x] The Brief shows the analysts' views behind each change.
- [x] Tests:
  - each analyst called gets its inputs, and an analyst no name needs isn't called;
  - a reused view keeps its date;
  - each falls back to the other Worker;
  - a buy whose required view is missing waits under the fallback;
  - an early exit is approved and lands in the next Rule plan;
  - a search query carries no amounts.

**Notes:**

- **The analysts** (`agents/events/`, `agents/chart/`, `agents/risk/`; the shared parts in `src/desk.ts`): each read-only in the Run folder, with a timeout and a turn limit, and an output schema: for each name a view (`none`, `veto`, `trim` with a `size` above 0 and under 1, or `exit`), its reasons and its evidence (`dossier`, `feed` or `web`, by what it cites), and the web searches it made with their sources. Their instructions say what each reads and may say, and state the Mandate.
  - **Workers:** Events and Risk on Claude Code, Codex as fallback. **Chart starts on Claude Code too**, not Codex as this issue has it: the PRD's "Unconfirmed" note puts it there, since on Windows Codex's unelevated sandbox can't enforce the deny-read rules on the Tools it doesn't declare, so Codex refuses to start (as for the Health Agent). Codex is its fallback; say if it should move once Codex's sandbox enforces them.
  - **Web search:** a new `webSearch` in an Agent's config, off by default. With it, Claude Code gets its WebSearch tool (never WebFetch) and Codex `web_search="live"`. Events and Risk have it; Chart doesn't.
- **What an analyst reads** of each name: its part of the dossier, copied into its inputs. Events reads MarketSmith's snapshot, the fundamentals, the events and the orders; Chart the bars and the orders; Risk the last 63 bars, the snapshot, the events and the orders, plus each reviewed Book's holdings by name and sector with their results and board meetings to come. **No shares, prices, values, weights or cash** reach an analyst: an order is its side, strategy, reason, signal (without its weight) and the rules that cut it. So a search can't carry Saransh's holdings, sizes or amounts. As a check, each query an analyst reports is matched against every whole amount in the Run's plans and Book states (years aside), with a To-do for one that carries any. The instructions tell the analysts to read nothing in the Run folder but their inputs; nothing enforces it, as they run read-only there (see "Not done").
- **The Desk Step** (`steps/stocks/desk.ts`, between Feeds and the Portfolio Manager):
  - calls only the analysts the review list needs (`review.analysts`), all at once, and skips itself when it needs none;
  - checks each view against its name: a veto or trim is of a buy, an exit of a holding the paper Book holds, a trim has a size, a view against a name cites evidence, a web citation is a link, and Chart cites no web. A view it may not give is refused;
  - keeps `desk.json`: each analyst's outcome, the views, the reviews missing, the views refused, the searches and the exits proposed;
  - fails when an analyst fails on both Workers, after recording the rest.
- **Reuse:** each view is kept in `data/state/desk-views.json` with the fingerprint (sha256) of what its analyst read for the name. While that is unchanged, the view is reused with its date (`reused`, `viewed_at`), and an analyst whose names are all reused isn't called. Risk weighs a Book's buys together, so a change to any of them, or to the Book's holdings, re-reviews them all. Chart's bars change every session, so its views are reused only while the data hasn't moved (a re-run, a Hold mode day).
- **Last views:** the Plan Step writes the Events analyst's last view of each name (`viewed_at`, UTC without an offset) to `last-views.json` and passes `pd plan --last-views`, closing issue 37's loop: an event fetched since is new.
- **A missing review:** a buy's review is missing when the review list required it and the Desk has no view of it (its analyst failed, gave none, or gave one refused), or the Desk Step failed or didn't run (every required review then). The Check Step hands these to `pd check` as the judgement's `missing_reviews`. ash_new's final check (`Reviews`) then:
  - holds back those buys, whatever went out;
  - when the Portfolio Manager failed, or judged another plan or state, also holds back every buy the review list required a review of. **Every buy needs Chart**, so under the Rule plan's fallback only sales, Disaster stops and gold's buy go out. That follows "never goes out under the Rule plan's fallback"; say if a failed Portfolio Manager should instead let through the buys with no veto against them.

  A buy held back goes into its Sleeve's strategy's waiting orders (`engine.waiting`), so the next Rule plan buys it again (`deferred`) for the Desk to review. `pd check` prints them as `held_back`. The rules-only paper Book trades its Rule plan unchanged. A view refused counts as missing too, which goes a little beyond "because the Desk or the Portfolio Manager failed": a malformed review isn't a review.
- **The Portfolio Manager** gets a `desk` input: the views (without their Run) and the reviews missing, or null when the Desk didn't review. Each Decision record names the views it follows (`views`: analyst and security). This is in its output schema and in `contract/judgement.schema.json`, and the Brief shows each view under its change. Neither the final check nor the Step checks that a named view exists; the Brief says "no such view in this Run" for one that doesn't.
- **Early exits** (ash_new's `pdash.judgement.exits`, `pd exits propose|approve|reject`, migration 0020 `early_exits`, `contract/exits-decide.schema.json`):
  - The Desk Step proposes each new `exit` view (not a reused one) with `pd exits propose BOOK SECURITY --why --by "the Desk's Events analyst" --run`. ash_new records one only for a name the paper Book holds, and one at a time per name. A proposal that fails leaves the view unkept, so the next Run's analyst gives it again.
  - `pd judgement show` lists the exits waiting and those approved but not yet sold (`exits`). The Brief shows them with Approve and Reject buttons (item `exit:<id>`), and the Answers Step applies the Answer with `pd exits approve|reject`.
  - An approved exit is sold on the paper Book's next Rule plan (`pd plan`'s `early_exits`): every Sleeve's holding of the name sold whole at its last close (reason `early_exit`, role `exit`, so the final check never drops it), in place of the plan's other orders of it. It waits in Hold mode or while the name can't be sold, and lapses once the paper Book no longer holds it.
  - `pd check` marks it listed with the Order list that carried it, or lapsed. A list superseded before it filled no longer carries it.
  - The rules-only paper Book never takes one.
  - The PRD also lists early exits among the Portfolio Manager's own proposals. Here, as the issue has it, the Desk proposes them and the Portfolio Manager is told an exit isn't its to act on.
- **The Brief:** a Desk section after the plans: each analyst's outcome, each view with its reasons, evidence (web links as links) and date ("reused from …"), the reviews missing, the views refused and the web searches. Each accepted change shows "The Desk's views behind it". Each paper Book shows its buys held back a session, and each plan the early exits it sells. A section of early exits waits for Answers.
- **Pipeline order:** answers, broker-inbox, marketsmith, lake, review, stages, health, plan, feeds, **desk**, portfolio-manager, check, save-state, brief.
- **Tests:**
  - **agents:**
    - `test/desk.test.ts`:
      - each analyst gets its inputs, read-only, and Risk its holdings with their results;
      - an analyst no name needs isn't called, and the Step skips itself;
      - a reused view keeps its date, a new event re-reviews only Events and Risk, and the Plan Step passes `--last-views`;
      - each falls back to the other Worker;
      - an analyst failing on both, and a view refused, leave reviews missing;
      - the inputs carry no amounts, and a query that does raises a To-do;
      - an early exit is proposed and the Brief asks for it;
      - a failed proposal loses nothing and is given again;
      - a dry run.
    - `test/check.test.ts`: the missing reviews handed to `pd check`, with what it held back; every review missing when the Desk didn't review, none when it skipped itself.
    - `test/answers.test.ts`: an exit approved through `pd exits`.
    - `test/portfolio-manager.test.ts`: the `desk` input and the views a Decision record names.
    - `test/stocks-brief.test.ts`: the Desk section, the views behind a change, the buys held back, early exits.
    - `test/plan.test.ts`: early exits logged.
    - `test/workers.test.ts`: web search only when the config allows it.
    - `test/stocks.test.ts`: the Step in the Pipeline, and the reviews missing when every Worker fails.
  - **ash_new:**
    - `tests/test_exits.py`: proposed, refused when waiting or not held, approved, sold on the next paper plan and not the rules-only one, carried by the recorded list and sold again by a plan made again for that session; rejected; Hold mode, unsellable and not held.
    - `tests/test_final_check.py`: a buy missing its review waits and the exit still goes; a failed Portfolio Manager holds back every reviewed buy.
    - `tests/test_judgement.py`: through `pd check`, a buy missing its review held back and bought (`deferred`) by the next plan; a failed or stale judgement's reviewed buys held back.
    - The paper Book and monthly review tests now give `pd check` a judgement that changes nothing (`plan_lake.unchanged`), since without one their buys would wait.
- **Code review** (Standards and Spec, in parallel). Fixed:
  - **Spec:** a failed `pd exits propose` had stopped the Step before desk.json was written, with its view already kept, so the exit would never reach the Brief. Now each proposal is tried apart, desk.json is always written, and an unproposed exit's view isn't kept. Risk couldn't see when the holdings report, and its instructions claimed MarketSmith's shareholding, which the snapshot lacks. Chart moved to Claude Code first, per the PRD's note.
  - **Standards:** "opinion" (the glossary's _Avoid_ for View) in the Brief; overlong header comment lines; a second copy of the Books' names; the review key built in two places; `ReviewTask` (the glossary avoids "task"), now `NameToReview`; ash_new's `exits.HOLD_MODE` clashing with `final_check.HOLD_MODE`, now `IN_HOLD`; a stale "until issue 37"; inline plurals.

  Left as judgement calls:
  - the Mandate's figures written into the three analysts' instructions (the issue asks them to state it; they are the same for every Book today);
  - the near-identical "What you may say" sections;
  - Book codes as string literals, as elsewhere;
  - the final check's `unweighed` flag;
  - the analysts' Run-folder access, and the unchecked views a Decision record names (above).
- **Not done:**
  - **On real data:** no Desk has reviewed a real plan. No strategy is in Paper, so no paper Book has a buy, and its holdings are empty.
  - **Enforcing the analysts' reading:** they run read-only in the Run folder as the issue asks, where `plan.json`, `book-states.json` and the full dossiers hold shares and amounts. Only their inputs, their instructions and the query check keep amounts out of a search. Say if they should run in a folder holding only what they read.
  - **For Saransh,** two readings to confirm:
    - a failed Portfolio Manager holds back every reviewed buy, so the Rule plan's fallback sends only sales, stops and gold;
    - Chart on Claude Code first until Codex's sandbox enforces deny rules on Windows.
