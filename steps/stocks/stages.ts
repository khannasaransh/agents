// Stages: records each Book's Sleeves and their Stages for the Brief. It runs `pd stages check`,
// which first records as a Candidate each new version of a strategy with a Sleeve (its rules,
// parameters or code changed), the old version keeping its Stage until the new one replaces it,
// then prints each Book's Sleeves; this Step keeps that as stages.json. It comes after the Answers
// Step, so a Candidate Saransh approved is in Paper here. A dry run records nothing: it asks what
// would be recorded (`--dry-run`).
import { rmSync } from 'node:fs'
import { join } from 'node:path'
import { writeJson } from '../../src/files.ts'
import { pdJson, type PdSleeve, type PdStagesCheck } from '../../src/pd.ts'
import { readRun } from '../../src/run.ts'
import { stageName } from '../../src/stages.ts'
import { runAsStep } from '../../src/step.ts'

/** How long pd stages check may take: a few rows, and every strategy's version hashed. */
const checkMs = 5 * 60_000

/** A Book's Sleeves in a line: each by its strategy's name and Stage, then how many are Retired. */
function sleevesLine(sleeves: PdSleeve[]): string {
  if (!sleeves.length) return 'no Sleeve yet'
  const held = sleeves.filter((s) => s.stage !== 'retired').map((s) => `${s.name ?? s.strategy_id} ${s.stage === 'candidate' ? 'a Candidate' : `in ${stageName(s.stage)}`} since ${s.since}`)
  const retired = sleeves.length - held.length
  return [...held, ...(retired ? [`${retired} Retired`] : [])].join('; ')
}

await runAsStep(async ({ runId, runFolder }) => {
  const out = join(runFolder, 'stages.json')
  // Stages an earlier run of this Step read would say nothing true about them now.
  rmSync(out, { force: true })
  const { dryRun = false } = readRun(runId)
  const stages = await pdJson<PdStagesCheck>(['stages', 'check', ...(dryRun ? ['--dry-run'] : [])], { cwd: runFolder, timeoutMs: checkMs })
  writeJson(out, stages)
  for (const sleeve of stages.recorded) console.log(`${dryRun ? 'Would record' : 'Recorded'} ${sleeve.strategy_id}'s new version ${sleeve.version} as a Candidate in the ${sleeve.book} Book`)
  for (const book of stages.books) console.log(`${book.name}: ${sleevesLine(book.sleeves)}`)
})
