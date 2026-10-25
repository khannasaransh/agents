# A rules-only paper Book is the baseline the Portfolio Manager is judged against

Beside each paper Book runs a rules-only paper Book. It trades the Rule plan unchanged, from the same start, with the same Sleeves, Stages, cash and new money. The paper Book's gap to it is what the Portfolio Manager's judgement added. That gap is the gate for moving a real Book to Playbook mode, with the bar for it fixed before the 3 months start.

## Considered Options

- **Sum the Overrides' own scores** (issue 40 as first written): rejected as the gate. Overrides interact: cash left by a veto funds another buy, and a cut changes what later caps allow. So their scores don't add up to what judgement did to the Book. They stay, as a diagnosis by Lever, analyst and Lesson.
- **Compare the real Book with its paper Book**: rejected for this. That gap mixes in Saransh's fills, skips and the Stages (issue 44 measures it for that).

## Consequences

- Each Book has two paper portfolios in ash_new, and the Check Step records an Order list for each.
- The monthly attribution's Overrides part, for a paper Book, is its gap to the rules-only paper Book.
- This qualifies ADR 0003's "scored by Lever against the Rule plan alone". The scores remain, but the gate is the gap between the two Books.
