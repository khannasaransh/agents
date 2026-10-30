// Feeds: fetches each company's events through ash_new (`pd feeds`, issues 37 and 38) for the names
// the Plan Step's plan asks the Desk to review and every Book's holdings: India's from NSE (corporate
// announcements, board meetings, which give results dates, and pledges) and BSE (announcements), the
// US's from SEC EDGAR (8-K, 10-Q, 10-K, Form 4) and Yahoo (earnings dates). ash_new caches what it
// fetched before and keeps each event's link and the time it was first fetched, so a Decision record
// can cite only what was fetched before its Run. This Step keeps what it printed as feeds.json, and
// ash_new brings each dossier's events up to date in the Run's dossiers folder. A source that fails
// (NSE's and BSE's endpoints need browser-like headers and change without notice) stops, keeping what
// it had, with a To-do; EDGAR skips itself, with a To-do, until SEC_CONTACT is set in the env file,
// which runPd passes to `pd`. Neither fails the Step. A dry run fetches nothing: it reads only the
// cache (`--cached`). It skips itself when the Plan Step made no plan, since the plan names the names.
import { existsSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { feedTodos, sourceLine } from '../../src/feeds.ts'
import { writeJson } from '../../src/files.ts'
import { pdJson, type PdFeeds } from '../../src/pd.ts'
import { dossiersFolder } from '../../src/plans.ts'
import { readRun } from '../../src/run.ts'
import { runAsStep, StepSkipped } from '../../src/step.ts'
import { writeTodos } from '../../src/todos.ts'

/** How long pd feeds may take: a few requests a second for each name and source. */
const feedsMs = 20 * 60_000

await runAsStep(async ({ runId, runFolder }) => {
  const out = join(runFolder, 'feeds.json')
  // Feeds an earlier run of this Step fetched would be older than this Run's plan.
  rmSync(out, { force: true })
  if (!existsSync(join(runFolder, 'plan.json'))) throw new StepSkipped('No Rule plan was made in this Run, so no name needs its Feeds')
  const { dryRun = false } = readRun(runId)
  const args = ['feeds', '--plan', 'plan.json', '--dossiers', dossiersFolder, ...(dryRun ? ['--cached'] : [])]
  const feeds = await pdJson<PdFeeds>(args, { cwd: runFolder, timeoutMs: feedsMs })
  writeJson(out, feeds)
  for (const source of feeds.sources) console.log(sourceLine(source))
  const events = feeds.names.reduce((n, name) => n + name.events.length, 0)
  console.log(`${feeds.names.length} names, ${events} events as fetched by ${feeds.fetched_at}`)
  writeTodos(runFolder, 'feeds', feedTodos(feeds))
})
