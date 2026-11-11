// Watched names: the securities the Books hold or may trade, as the last Run's Rule plans had them,
// kept across Runs in the state area. The Health Step runs before this Run's plans are made, so it
// reads the last Run's: a flag on one of these needs the Health Agent's attention however old it is,
// where a flag on a security no Book touches is diagnosed once, when it is new (the audit of 10
// November 2026, docs/audit).
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { readJson, writeJson } from './files.ts'
import { stateDir } from './paths.ts'
import type { PdPlan } from './pd.ts'

/** The watched names as they are kept: with the Run whose plans they come from. */
export interface Watched {
  run: string
  names: string[]
}

const file = () => join(stateDir(), 'watched.json')

/** The securities a Run's plans hold, would trade or may buy: each plan's orders, holdings, Legacy and Kept holdings and Pool, and every Book's holdings. */
export function watchedNames(plan: PdPlan): string[] {
  const names = new Set<string>()
  for (const p of plan.plans) {
    for (const each of [...(p.orders ?? []), ...(p.holdings ?? []), ...(p.pool ?? []), ...(p.legacy ?? []), ...(p.kept ?? [])]) names.add(each.security_id)
  }
  for (const held of plan.review?.holdings ?? []) names.add(held.security_id)
  return [...names].sort()
}

/** The last Run's watched names; none before a Run has kept any. */
export function readWatched(): Watched | null {
  return existsSync(file()) ? readJson<Watched>(file()) : null
}

/** Keeps the names Run `run`'s plans watch, replacing the last Run's. */
export function recordWatched(plan: PdPlan, run: string): void {
  writeJson(file(), { run, names: watchedNames(plan) } satisfies Watched)
}
