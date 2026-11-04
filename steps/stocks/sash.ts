import { join } from 'node:path'
import { sashConfig } from '../../src/env.ts'
import { writeJson } from '../../src/files.ts'
import { pdJson } from '../../src/pd.ts'
import { readRun } from '../../src/run.ts'
import { sashRequest, syncSash, type SashExport } from '../../src/sash.ts'
import { runAsStep, StepSkipped } from '../../src/step.ts'
import { writeTodos } from '../../src/todos.ts'

await runAsStep(async ({ runId, runFolder }) => {
  if (readRun(runId).dryRun) throw new StepSkipped('Dry run: Sash is not changed')
  const config = sashConfig()
  if (!config) throw new StepSkipped('Sash sync is not configured')
  try {
    const snapshot = await pdJson<SashExport>(['sash-export'], { cwd: runFolder, timeoutMs: 300_000 })
    writeJson(join(runFolder, 'sash-input.json'), snapshot)
    const books = await syncSash(snapshot, config.userId, sashRequest(config))
    writeJson(join(runFolder, 'sash.json'), { status: 'succeeded', books })
    writeTodos(runFolder, 'sash', [])
    for (const book of books) console.log(`${book.book}: managed paper watchlist has ${book.holdings} names; real portfolio has ${book.transactions} executed trades (${book.omittedCashEntries} cash entries not represented in Sash)`)
  } catch (error) {
    const why = error instanceof Error ? error.message : String(error)
    writeJson(join(runFolder, 'sash.json'), { status: 'failed', why })
    writeTodos(runFolder, 'sash', [`Sash sync failed: ${why}. Existing personal lists and alarms are not sync targets.`])
    throw error
  }
})
