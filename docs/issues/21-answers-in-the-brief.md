# 21: Answers in the Brief

**What to build:** Saransh answers what's waiting on him in the Stocks Brief itself. He clicks buttons, then Save answers, and the next Run applies his Answers. Nothing has to be running for this to work. The first kinds of Answer cover Corrections and Quarantines, and later tickets add their own kinds. See the stocks Pipeline PRD's "Answers" and the Answers Step.

**Repos:** agents, ash_new

**Blocked by:** 20: Corrections and Quarantine

**Status:** done

- [x] Every item waiting on Saransh in the Brief has an id and buttons for its Answers. The first kinds:
  - a waiting Correction: approve or reject;
  - a Quarantine: dismiss its flag.
- [x] A Save answers button downloads one Answers file naming the Run and each Answer, with an optional note. The page works when opened from disk with nothing running.
- [x] A new first Step, Answers:
  - reads every Answers file in Downloads and in the Broker inbox;
  - applies them through `pd`, oldest first;
  - applies a later Answer to an item only while that item is still open, and logs any Answer it ignores;
  - moves the files into the Run.
- [x] Answers never expire. An item without an Answer appears again in the next Brief.
- [x] A dry run consumes no Answers file.
- [x] Tests:
  - an Answers file built from the items embedded in a Brief, the way the button builds it, is applied once;
  - an Answer to a settled item is ignored;
  - an old file can't undo a newer Answer.

**Notes:**

- **Items and Answers** are kept in `src/answers.ts`. Each item has an id, such as `correction:7` or `quarantine:5`, and the Answers it takes. That module also holds the `pd` command that applies an Answer, so a later ticket adds a kind there.
  - A waiting Correction takes approve (`pd corrections approve <id>`) or reject (`pd corrections reject <id>`).
  - A Quarantine takes dismiss (`pd quarantines dismiss <id>`).
- **The Brief:**
  - Each Correction row and each Quarantine row gets a Your Answer cell, with a button per Answer and a note field that shows once an Answer is chosen. Clicking a chosen button again clears it.
  - A Save answers bar sits at the bottom of the page. The page embeds the items as JSON (`#answer-items`).
  - Its inline script runs `answersFile` and `answersFileName` from their own source, with the types stripped, so the page builds the file exactly as the tests do.
  - The file is `stocks-answers-<run>-<time saved>.json`: `{ kind: "stocks-answers", run, savedAt, answers: [{ item, answer, note? }] }`. It is downloaded as a Blob, so the page works from disk with nothing running. The page warns before it closes while choices are unsaved.
  - A Brief with nothing waiting has no bar and no script.
- **The Answers Step** is the stocks Pipeline's first Step (`steps/stocks/answers.ts`), so an approval counts in the same Run's refresh.
  - **What it reads:** every `stocks-answers*.json` in `~/Downloads` and in the Broker inbox (`data/broker-inbox`).
  - **Order:** oldest first, by the `savedAt` in each file. Files saved at the same moment keep Downloads first, then name order.
  - **Settled items:** an Answer to an item that `pd` says is settled, or that doesn't exist, is ignored with `pd`'s why. So is an Answer the item doesn't take.
  - **Old files:** `data/state/answers.json` records, per item, the Answer applied and when it was saved. An Answer saved before it is ignored without asking `pd`, so an old file can't undo a newer Answer, whatever the kind. The same Answer from a copy of the same file (Downloads and the inbox both) is ignored as applied already.
  - **Moving files:** each file read moves into the Run's `answers/` folder, copied across drives, since Downloads is on C: and the Run on D:. `answers.json` records what became of each Answer: applied, ignored, failed, not-tried or dry-run. It is written after each file, so what was applied is kept if a later file stops the Step.
  - **Unreadable files:** a `stocks-answers*.json` that isn't an Answers file stays where it is, with a To-do.
  - **When `pd` fails:** an Answer that `pd` couldn't apply (timeout, no JSON, an exit code other than 0 or 1) fails the Step. Its file and every later one stay for the next Run, with a To-do. A file that couldn't be moved after its Answers were applied is read again by the next Run, which ignores what was applied.
  - **Dry runs:** a dry run calls no `pd`, moves no file and records no state. It lists what it found.
- **The Brief's Your Answers section** says what became of each Answer this Run read, with why each was ignored, or that no file was waiting.
- **The first Answer applied settles an item**, as the PRD's "oldest first, a later Answer only while the item is open" says. If Saransh saves twice with opposite Answers before a Run, the older one wins. The page says so when it saves.
- **Not done:**
  - Answers on orders, promotions, early exits, Lessons and kept marks come with their own tickets.
  - GLOSSARY.md's Broker inbox doesn't yet say that Answers files may be dropped there, as the PRD's Answers Step reads them.
  - Saving from the page is checked by running its script against a stand-in DOM, on a Brief rendered from Run 2026-10-25-1552's status (19 Corrections, 747 Quarantines, a 468 KB page). It hasn't been clicked through in a browser.
