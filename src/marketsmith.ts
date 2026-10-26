import { capitalised } from './answers.ts'
import type { PdMarketSmith } from './pd.ts'

const regionNames: Record<string, string> = { IN: 'India', US: 'the US', HK: 'Hong Kong' }

/** The markets the Books trade, whose MarketSmith data is fetched each Saturday: India, the US and Hong Kong. */
export const bookRegions = ['IN', 'US', 'HK']

/** A MarketSmith region's name in a sentence: India, the US, Hong Kong. */
export const regionName = (code: string) => regionNames[code] ?? code

/**
 * How a region's fetch ended, as the Step logs it and the Brief shows it: "India: fetched 2571 of
 * 2599, snapshot IN:2026-10-31; 26 MarketSmith has nothing for, 2 failed". A symbol that failed keeps
 * its last fetch, if it had one.
 */
export function fetchLine(r: PdMarketSmith['regions'][number]): string {
  const name = capitalised(regionName(r.region))
  if (r.status !== 'fetched') return `${name} wasn't fetched: ${r.error ?? r.status}`
  const notes = [r.skipped && `${r.skipped} MarketSmith has nothing for`, r.failed && `${r.failed} failed`].filter(Boolean)
  return `${name}: fetched ${r.ok} of ${r.universe}, snapshot ${r.snapshot}${notes.length ? `; ${notes.join(', ')}` : ''}`
}
