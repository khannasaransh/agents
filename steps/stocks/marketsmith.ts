// MarketSmith: on Wednesdays and Saturdays (Saransh, 9 November 2026), fetches MarketSmith's data for
// the Books' markets (India, the US and Hong Kong) through ash_new (`pd marketsmith --mode auto`)
// before the Lake Step refreshes. auto is a latest fetch (the symbols with results in the last 15
// days, the new ones and the stalest), and once a year, from 1 July, a full one of every symbol.
// ash_new writes the raw store, checks it whole before keeping it, keeps the one it replaced as a
// backup and the store as a dated snapshot; this Step records what it printed as marketsmith.json. It
// skips itself on other days and in a dry run. A cookie MarketSmith rejected skips the Step, with a
// To-do naming the cookie (pd exits 78), and never fails the Run: the cookies are in ash_new's env
// file, which only `pd marketsmith` reads, so this Step never handles them. A results calendar that
// couldn't be read raises a To-do too. Run again in the same Run, it fetches only the regions not yet
// fetched, unless forced, since a fetch can take hours. The Health Step looks into a fetch, or a
// backup, that went wrong (marketsmithProblems).
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { readJson, writeJson } from '../../src/files.ts'
import { capitalised } from '../../src/answers.ts'
import { bookRegions, fetchLine, regionName } from '../../src/marketsmith.ts'
import { runPd, type PdMarketSmith } from '../../src/pd.ts'
import { readRun } from '../../src/run.ts'
import { runWeekday } from '../../src/schedule.ts'
import { runAsStep, skippedExitCode, StepSkipped } from '../../src/step.ts'
import { writeTodos } from '../../src/todos.ts'

type Region = PdMarketSmith['regions'][number]

// A full fetch is every symbol, paced as MarketSmith allows: hours for each region, fetched at once.
const fetchMs = Number(process.env.AGENTS_MARKETSMITH_TIMEOUT_SECONDS ?? 14 * 60 * 60) * 1000

/** The days MarketSmith is fetched, and the day each year auto fetches every symbol (MM-DD). */
export const fetchDays = ['wednesday', 'saturday']
export const fullFetchOn = '07-01'

/** One To-do per cookie MarketSmith rejected, naming it and the regions it left unfetched. */
function cookieTodos(regions: Region[]): string[] {
  const rejected = regions.filter((r) => r.status === 'cookie_rejected')
  return [...new Set(rejected.map((r) => r.cookie))].map((cookie) => {
    const these = rejected.filter((r) => r.cookie === cookie)
    const names = these.map((r) => regionName(r.region)).join(' and ')
    const command = ['uv run pd marketsmith', ...these.map((r) => `--region ${r.region}`)].join(' ')
    return `${cookie} didn't work, so ${names} wasn't fetched in this Run (${these[0].error}). Put a fresh one in ash_new's .env as ${cookie}, then run \`${command}\` in ash_new.`
  })
}

/** One To-do per region whose results calendar couldn't be read, so its latest fetch took only its new and stale symbols. */
function calendarTodos(regions: Region[]): string[] {
  return regions
    .filter((r) => r.calendar?.status === 'failed')
    .map((r) => `MarketSmith's latest fetch of ${regionName(r.region)} couldn't read its results calendar (${r.calendar?.why}), so it fetched only its new and stale symbols. Check ash_new's pdash.marketsmith.results against the calendar's page.`)
}

await runAsStep(async ({ runId, runFolder, force }) => {
  const day = runWeekday(runId)
  if (!fetchDays.includes(day)) throw new StepSkipped(`MarketSmith is fetched on Wednesdays and Saturdays, and this Run started on a ${capitalised(day)}`)
  if (readRun(runId).dryRun) throw new StepSkipped('Dry run: MarketSmith is not fetched')
  const out = join(runFolder, 'marketsmith.json')
  // What an earlier run of this Step fetched is kept, and only the rest asked for again.
  const earlier = !force && existsSync(out) ? readJson<PdMarketSmith>(out).regions : []
  const left = earlier.filter((r) => r.status !== 'fetched').map((r) => r.region)
  if (earlier.length && !left.length) {
    console.log('MarketSmith was already fetched in this Run, skipping')
    return
  }
  const args = ['marketsmith', '--mode', 'auto', '--full-on', fullFetchOn, ...(left.length ? left : bookRegions).flatMap((region) => ['--region', region])]

  // pd marketsmith logs on stderr as it goes, which reaches the Step's log as it comes, and prints its JSON on stdout.
  const { code, stdout, stderr, timedOut } = await runPd(args, { cwd: runFolder, timeoutMs: fetchMs, echo: { stderr: true } })
  if (timedOut) throw new Error(`pd marketsmith timed out after ${Math.round(fetchMs / 60_000)} minutes`)
  let fetched: PdMarketSmith
  try {
    fetched = JSON.parse(stdout)
  } catch {
    throw new Error(`pd marketsmith exited with ${code}: ${stderr.trim() || stdout.trim()}`)
  }
  for (const region of fetched.regions) console.log(fetchLine(region))
  // Each region as it last ended, in the first run's order.
  if (earlier.length) fetched = { ...fetched, regions: earlier.map((r) => (left.includes(r.region) && fetched.regions.find((f) => f.region === r.region)) || r) }
  writeJson(out, fetched)
  writeTodos(runFolder, 'marketsmith', [...cookieTodos(fetched.regions), ...calendarTodos(fetched.regions)])
  if (code === skippedExitCode) throw new StepSkipped('MarketSmith rejected a cookie; see the To-dos')
  if (code !== 0) throw new Error(`pd marketsmith exited with ${code}`)
})
