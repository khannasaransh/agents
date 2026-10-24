# 41: Lessons

**What to build:** The Portfolio Manager proposes Lessons drawn from its Journal in the Stocks Brief. Saransh approves or rejects each one with an Answer, and only approved Lessons shape later decisions. Lessons, like all the Agents' judgement, can only subtract. See the stocks Pipeline PRD's "Agents" and "Journal and Lessons".

**Repos:** agents

**Blocked by:** 34: The Portfolio Manager and the final check; 21: Answers in the Brief

**Status:** ready-for-agent

- [ ] An Agent's config can set whether Memory changes are applied or reviewed per Memory file. The Portfolio Manager's Journal is applied, and its Lessons file is reviewed.
- [ ] The Portfolio Manager proposes Lessons in its output, and Save state queues them.
- [ ] The Brief shows each queued Lesson with Answers to approve or reject it. `agents memory accept|reject` can settle it too.
- [ ] Rejected Lessons are kept, and the Portfolio Manager gets them, so it doesn't propose them again.
- [ ] Approved Lessons are among the Portfolio Manager's inputs. The final check holds them to subtractions.
- [ ] Tests:
  - the Journal is applied while a Lesson waits;
  - an approving Answer makes the Lesson an input;
  - a rejected Lesson stays rejected.
