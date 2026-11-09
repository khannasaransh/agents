// Delistings: what the Health Agent found out about securities the Lake no longer gets prices for,
// kept across Runs in the state area so each security is looked up once. A security that was
// delisted, or now trades under another name, stays stale in the Lake until ash_new marks it
// inactive or moves it to its successor; these findings are what Saransh does that from.
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { readJson, writeJson } from './files.ts'
import { stateDir } from './paths.ts'

/** What happened to a security the Lake no longer gets prices for, as the Health Agent found it. */
export interface Delisting {
  /** As the Lake names it: US:AVB. */
  security_id: string
  /**
   * delisted: no longer listed under any ticker (taken private, bought for cash, liquidated, its
   * listing cancelled); renamed: it, or the shares it became, trade under `successor`; trading:
   * still listed under the same ticker, so the gap is the data source's; unknown: not found out.
   */
  status: 'delisted' | 'renamed' | 'trading' | 'unknown'
  /** Its last trading day, or the day the change took effect, YYYY-MM-DD; null when not known. */
  date: string | null
  /** What it became, as the Lake would name it (US:VMRK), with the terms in `why`; null when nothing. */
  successor: string | null
  why: string
  /** Where it was found: a filing's or an exchange notice's URL. */
  source: string
}

/** A finding as it is kept: with the Run that made it. */
export type KeptDelisting = Delisting & { run: string }

const file = () => join(stateDir(), 'delistings.json')

/** Every finding so far, by security. */
export function readDelistings(): Record<string, KeptDelisting> {
  return existsSync(file()) ? readJson(file()) : {}
}

/** Keeps `found`, made in Run `run`, each replacing what was known of its security. Returns how many were new. */
export function recordDelistings(found: Delisting[], run: string): number {
  const kept = readDelistings()
  const fresh = found.filter((d) => !(d.security_id in kept)).length
  for (const d of found) kept[d.security_id] = { ...d, run }
  writeJson(file(), kept)
  return fresh
}
