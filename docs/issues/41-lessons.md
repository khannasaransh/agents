# 41: Lessons

**What to build:** The Portfolio Manager proposes Lessons drawn from its Journal in the Stocks Brief. Saransh approves or rejects each one with an Answer, and only approved Lessons shape later decisions. A Lesson may propose a narrower or wider Playbook range; a wider one needs the override scorecard's support. See the stocks Pipeline PRD's "Agents" and "Journal and Lessons".

**Repos:** agents

**Blocked by:** 34: The Portfolio Manager, the Playbook and the final check; 21: Answers in the Brief

**Status:** done

- [x] An Agent's config can set whether Memory changes are applied or reviewed per Memory file. The Portfolio Manager's Journal is applied, and its Lessons file is reviewed.
- [x] The Portfolio Manager proposes Lessons in its output, and Save state queues them.
- [x] The Brief shows each queued Lesson with Answers to approve or reject it. `agents memory accept|reject` can settle it too.
- [x] Rejected Lessons are kept, and the Portfolio Manager gets them, so it doesn't propose them again.
- [x] Approved Lessons are among the Portfolio Manager's inputs. An approved range change is written to the Book's Playbook, and the final check holds every decision to it.
- [x] A proposed Lesson that widens a range cites the override scorecard's figures for its Lever; without them it isn't queued.
- [x] Tests:
  - the Journal is applied while a Lesson waits;
  - an approving Answer makes the Lesson an input;
  - a rejected Lesson stays rejected.

**Notes:**

- **Memory per file** (`AgentConfig.memoryChanges`, `memoryChangesFor`): `apply` or `review` for all of an Agent's Memory files, or for each by its name (one not named is applied). The Portfolio Manager's config applies its `journal` and reviews its `lessons`; the stocks Save state reads it for both, and the daily Save state for the Reviewer's and the PM Agent's.
- **Lessons** (`src/lessons.ts`): the Portfolio Manager's answer has `lessons`, each its words, why, the figures it rests on, and optionally a range change (a Book, a Lever and its ranges). Save state queues each as its own Memory change, `lesson-<id>` (`MemoryProposal.adds`: a block added under `## Approved` or `## Rejected` of the Lessons file once settled, whatever the file holds by then, so Lessons wait and settle in any order). It doesn't queue one whose words (case and spacing aside) are approved, rejected or waiting already, one whose range change touches another Lever's range, or one that widens a range without citing a figure of review.json about its Lever (its `security`) in that Book's scorecard tally of it. A range change is recorded in ash_new first (`pd judgement propose --why "Lesson <id>: ..."`), ash_new refusing a widening the scorecard doesn't support, and the Lesson keeps the proposal's id. What became of each is lessons.json.
- **Answers:** `lesson:<id>` takes approve or reject, applied in this repo (`decideLesson`): its range change's proposal is approved or rejected in ash_new (`pd judgement approve|reject`), then the Lesson goes into the Lessons file. One whose proposal ash_new didn't decide that way (decided otherwise already, or its ranges no longer making a Playbook) keeps waiting, and the Answer is ignored with why. `agents memory accept|reject portfolio-manager lesson-<id>` does the same. The Brief shows each waiting Lesson with its buttons (its range change's proposal isn't asked about apart), and what this Run's Save state didn't queue, with why.
- **Inputs and records:** the Portfolio Manager is given `lessons`: the Lessons file (approved and rejected) and those waiting. Its Decision records name the approved Lessons they follow (`lessons`, ash_new's contract/judgement.schema.json, optional); the Check Step keeps only approved ones, which the override scorecard tallies by Lesson.
- **Not done:** a rejected Lesson is kept from being queued again only by its words (case and spacing aside); a reworded one relies on the Portfolio Manager, which is given every rejected Lesson.
- **Tests:** `test/lessons.test.ts` (the Journal applied while a Lesson waits and `agents memory` lists it; an approving Answer making it an input and approving its range change in ash_new; a rejected Lesson kept, ignored when approved later and not queued again; a widening without the scorecard's figures not queued, and ash_new refusing one citing them; the Check Step passing only approved Lessons), `test/memory.test.ts` (memoryChanges per file).
