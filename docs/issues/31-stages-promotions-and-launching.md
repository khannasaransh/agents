# 31: Stages, promotions and launching

**What to build:** Each Book's Sleeves and their Stages are recorded, and Saransh moves Candidates into Paper with an Answer. Entering Paper launches the strategy in ash_new, so its live track starts that day. See the stocks Pipeline PRD's "Strategies and Stages" and "The Book engine".

**Repos:** ash_new, agents

**Blocked by:** 30: The Candidate test; 21: Answers in the Brief

**Status:** done

- [x] ash_new's app database keeps each Book's Sleeves and their Stages, with every change's date and who approved it. Only `pd` commands change them.
- [x] The Candidate report's Candidates appear in the Brief as items, and an Answer approves a Candidate into Paper.
- [x] Entering Paper launches the strategy in ash_new, starting its live track that day.
- [x] Each Sleeve names its strategy's version. A strategy whose rules, parameters or code hash change is a new version, and starts as a Candidate. The old one keeps its Stage until the new one replaces it.
- [x] A Retired strategy's Sleeve buys nothing new and winds down through the strategy's own exits.
- [x] The Brief shows each Book's Sleeves with their Stages and how long each has been in its Stage.
- [x] Tests:
  - approving a Candidate records the Stage and launches the strategy;
  - a changed strategy starts as a Candidate;
  - a Retired Sleeve only sells.

**Notes:**

- **Where Stages live.** ash_new's app database keeps each Book's Sleeves (`sleeves`: a strategy's version in a Book, its Stage and since when) and every Stage change (`stage_changes`: from and to, its day in the Book's market, when, who approved it and why), migration 0015, `pdash.stages`. A Candidate is a Sleeve at Stage Candidate: it isn't in the Book yet. Only `pd stages` changes them:
  - `pd stages record <report>` records each strategy a Candidate report chose as a Candidate, at the version it tested, by "the Candidate test of <its end>". A strategy whose version changed since the report is refused, with why. The same version recorded again is `known`, not recorded twice.
  - `pd stages check` records as a Candidate each new version of a strategy with a Sleeve that isn't Retired, by "a new version", then prints each Book's Sleeves. `--dry-run` says what it would record.
  - `pd stages approve <id>` moves a Candidate into Paper, by Saransh (`--by`). A Sleeve that isn't a Candidate, or whose version is no longer its strategy's, changes nothing and says why; none at all exits 1.
  - Each prints JSON with a schema (`contract/stages-check`, `stages-record`, `stages-approve`), and the stand-in `pd` has examples of each.
- **Versions.** A Sleeve names its strategy's version (`approvals.version_of`: its rules, parameters and code hash, and the engine's version), and `current_version` says what the strategy's version is now. A new version is a Sleeve of its own, starting as a Candidate. **Replacing:** a Sleeve entering a Stage Retires each other version of its strategy in the Book at that Stage or below, with "Replaced by version … in …", approved by whoever moved the new one (Saransh, for an approval). So a new version entering Paper Retires the old one in Paper, while an old one at Real-small or Real-full keeps its Stage until issue 35's promotions bring the new one there. A new Candidate replaces an older version's Candidate the same way, so a Candidate whose strategy changed never waits to be approved.
- **Launching.** Approving loads the built-in strategies into the app database, as the API does when it starts, so the strategy's latest version there is the Candidate's. Then it launches the strategy from that day in the Book's market (`StrategyStore.launch(afresh=True)`): the daily chain's live step extends its track from that close on. A strategy tracked live at the Candidate's version already keeps its track and its launch date (`launched.now` is false). A paused one is launched afresh, not resumed, so its track starts on the Paper day.
- **Retired** (`portfolios.book_engine`, `Track.retired_on`): from the session a strategy is Retired, its Sleeve buys nothing (neither its strategy's buys nor the breakers' buying back). It sells a holding only once its strategy no longer holds it: a trim is the strategy's, not an exit. The breakers' selling down and its Disaster stops still sell. At an April weighting it has no share and isn't resized; the cash its sales raised goes to the cash fund for the other Sleeves. The Book backtest still holds each strategy at one Stage over its range; the Rule plan (issue 32) sets `retired_on` from a Retired Sleeve's `since`.
- **The Pipeline.** A new **Stages** Step after the Lake (`steps/stocks/stages.ts`) runs `pd stages check` (with `--dry-run` in a dry run) and keeps it as `stages.json`. The Answers Step runs first, so a Candidate approved by an Answer is in Paper in the same Run's Brief.
- **Answers.** A Candidate is the item `candidate:<id>`, with one Answer, approve (`pd stages approve <id>`). An unapproved Candidate waits in every Brief. A Candidate whose version is no longer its strategy's gets no button.
- **The Brief:**
  - **Candidates waiting for your approval** comes after the Quarantines, each with its Book, strategy, version, when it was recorded and by what, why, and an Approve button.
  - **Sleeves and Stages** comes before the real Books. Each Book's Sleeves show their strategy, version (and a note when the strategy has changed since), Stage, since when and for how long in calendar months and days, and the day it went live. Retired ones are folded away, with why.
- **Recorded on the real app database, 28 October 2026.** The India report in ash_new's `docs/review/candidate-test-20261028/` gives one Candidate: `in-super30-ok-tuned`, version `b0a30c3545e3`, Sleeve 1 in the India Book. The next Brief asks for its approval. The US report chose none.
- **Not done:**
  - Promotions past Paper, demotions and the yearly review's choosing come with issue 35. `pd stages` has no command for them yet, and nothing retires a Sleeve but a new version replacing it.
  - **One live track per strategy.** ash_new tracks a strategy, not a version. When a new version enters Paper while the old one is at Real-small or Real-full, the launch moves the strategy's track to the new version, and the old one's track stops being extended. Issue 32's Rule plan needs a track per version before both can trade.
  - A Candidate Saransh doesn't want can't be rejected. It waits until the next Candidate test, or a new version, replaces it.
  - **A Retired Stage doesn't trade differently yet.** The wind-down is in the Book engine (`Track.retired_on`), and nothing reads a Retired Sleeve from the app database into it until issue 32's Rule plan. Today a Sleeve is Retired only when a new version replaces it, and that moves the strategy's one live track to the new version (above), so the old version's own exits aren't tracked to wind it down by. Issue 32 needs both.
  - **A new version's Candidate hasn't been through the Candidate test.** `pd stages check` records it as a Candidate, as "starts as a Candidate" asks, and it can be approved into Paper like a tested one. It also replaces a tested Candidate of the strategy's older version. The Brief says who recorded it ("a new version"). **Accepted by Saransh, 31 October 2026 ("9 ok"):** his approval may admit a new version to Paper without a mandatory Candidate-test pass. This does not waive the later promotion gates.
  - Recording a Candidate report is by hand (`pd stages record`), as running the Candidate test is: no Step records one.
