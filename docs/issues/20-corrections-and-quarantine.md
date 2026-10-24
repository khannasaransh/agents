# 20: Corrections and Quarantine

**What to build:** A flagged security goes into Quarantine instead of freezing every Book. The Health Agent proposes a Correction for the bad corporate action behind the flag. Once Saransh approves it, the next refresh applies it and re-runs the backtests it affects. See the stocks Pipeline PRD's "Data, Corrections and Quarantine".

**Repos:** ash_new, agents

**Blocked by:** 19: Health Agent

**Status:** ready-for-agent

- [ ] ash_new applies a Corrections file when it builds prices (decision 2a). A Correction can be:
  - a split or bonus, with its date and ratio;
  - a dividend dropped or corrected;
  - a demerger's ratio.

  Applying one changes the data version, so the backtests it affects go stale.
- [ ] The refresh re-runs stale backtests after building the panels (decision 1b).
- [ ] The Health Agent can propose Corrections in the file's format. The Pipeline records them in ash_new as waiting.
- [ ] A `pd` command approves or rejects a waiting Correction. An approved Correction joins the file, and the next refresh applies it. Nothing unapproved is ever applied.
- [ ] A security the Health report flags is Quarantined until its Correction is approved or its flag dismissed. A `pd` command dismisses a flag. The status JSON lists each Quarantine with its flag.
- [ ] A flag on its own doesn't fail the Data gate.
- [ ] The Brief lists each Quarantine, and each waiting Correction with what it would change.
- [ ] The known data issues (Bhagyanagar India's −91% bar, New Fortress Energy's 150.00 dividend) come through as proposed Corrections.
- [ ] Tests:
  - **ash_new:** a Correction fixes the total-return index and the panels; a waiting one changes nothing; approving one lifts its Quarantine.
  - **agents:** proposals are recorded, and the Brief lists them.
