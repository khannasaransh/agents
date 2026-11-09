import { capitalised } from './answers.ts'
import type { PdMarketSmith } from './pd.ts'

const regionNames: Record<string, string> = { IN: 'India', US: 'the US', HK: 'Hong Kong' }

/** The markets the Books trade, whose MarketSmith data is fetched each Wednesday and Saturday: India, the US and Hong Kong. */
export const bookRegions = ['IN', 'US', 'HK']

/** A MarketSmith region's name in a sentence: India, the US, Hong Kong. */
export const regionName = (code: string) => regionNames[code] ?? code

/**
 * How a region's fetch ended, as the Step logs it and the Brief shows it: "India: fetched 2571 of
 * 2599 (full), snapshot IN:2026-10-31; 26 MarketSmith has nothing for, 2 failed", or for a latest fetch
 * "India: fetched 717 of 2599 (latest: 214 with results, 3 new, 500 stale), …". A symbol that failed
 * keeps its last fetch, if it had one, and so does every symbol a latest fetch didn't ask for.
 */
export function fetchLine(r: PdMarketSmith['regions'][number]): string {
  const name = capitalised(regionName(r.region))
  if (r.status !== 'fetched') return `${name} wasn't fetched: ${r.error ?? r.status}`
  const how = r.chosen ? `latest: ${r.chosen.results} with results, ${r.chosen.new} new, ${r.chosen.stale} stale` : (r.mode ?? 'full')
  const removed = (r.backups?.removed ?? []).filter((b) => b.why.startsWith('not whole'))
  const notes = [
    r.skipped && `${r.skipped} MarketSmith has nothing for`,
    r.failed && `${r.failed} failed`,
    r.calendar?.status === 'failed' && 'its results calendar couldn\'t be read',
    r.calendar?.status === 'partial' && `part of its results calendar couldn't be read`,
    r.left_out && `${r.left_out} not whole in the last fetch, fetched again`,
    removed.length && `${removed.length} backup${removed.length === 1 ? '' : 's'} not whole, removed`,
  ].filter(Boolean)
  return `${name}: fetched ${r.ok} of ${r.universe} (${how}), snapshot ${r.snapshot}${notes.length ? `; ${notes.join(', ')}` : ''}`
}

/**
 * What went wrong with this Run's MarketSmith fetch, for the Health Agent to look into: a region whose
 * fetch failed (not a rejected cookie, which is a To-do of its own), a results calendar that couldn't
 * be read, symbols the last fetch left not whole, and each backup removed because it wasn't whole.
 */
export function marketsmithProblems(fetched: PdMarketSmith | null): string[] {
  const why: string[] = []
  for (const r of fetched?.regions ?? []) {
    const name = regionName(r.region)
    if (r.status === 'failed') why.push(`MarketSmith's fetch of ${name} failed: ${r.error}`)
    if (r.calendar?.status === 'failed') why.push(`MarketSmith's latest fetch of ${name} couldn't read its results calendar: ${r.calendar.why}`)
    if (r.left_out) why.push(`MarketSmith's last fetch of ${name} had ${r.left_out} symbol${r.left_out === 1 ? '' : 's'} whose files weren't whole.`)
    for (const b of r.backups?.removed ?? []) if (b.why.startsWith('not whole')) why.push(`MarketSmith's backup ${b.id} of ${name} wasn't whole, so it was removed: ${b.why}`)
  }
  return why
}
