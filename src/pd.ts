// ash_new's `pd` command, the only way the stocks Pipeline reaches ash_new: it never reads ash_new's
// database or Lake files itself (the stocks Pipeline PRD's "Shape"). The JSON it prints is the
// contract between the two repos, described by the schemas in ash_new's contract folder.
import { delimiter, join } from 'node:path'
import { ashNewFolder } from './env.ts'
import { runProcess, type ProcessResult } from './process.ts'

/** What `pd status` prints (ash_new's contract/status.schema.json): how fresh and healthy the Lake is. */
export interface PdStatus {
  checked_at: string
  markets: {
    market: string
    name: string
    /** Whether the Data gate checks it: India and the US, never Hong Kong. */
    gated: boolean
    latest_session: string | null
    last_finished_session: string
    sessions_behind: number
  }[]
  refresh: { job: number; daily: boolean; source: string; status: string; started_at: string | null; finished_at: string | null; error: string | null } | null
  health: {
    date: string
    checked_at: string
    status: 'ok' | 'warn' | 'fail'
    markets: { market: string; status: 'ok' | 'warn' | 'fail'; data_as_of: string | null; problems: string[]; flags: Record<string, number> }[]
    flags: { market: string; security_id: string; name: string | null; check: string; date: string | null; detail: string }[]
  } | null
  gate: { verdict: 'pass' | 'fail'; reasons: string[] }
  own_schedule: { enabled: boolean; task_registered: boolean | null }
  /** Each open Quarantine with its flag: the security is held out of every Book while one is open. */
  quarantines: PdQuarantine[]
  /** Each Correction waiting for approval, with what it would change. */
  corrections: (PdCorrection & { name: string | null; effect: string })[]
}

/** A Correction as the Corrections file holds it: what the Health Agent proposes. A bar is Yahoo's bar on its date, left out. */
export interface CorrectionChange {
  security_id: string
  kind: 'split' | 'dividend' | 'demerger' | 'bar'
  date: string
  /** A split's shares after per share before; a demerger's share of the value the company kept. */
  ratio: number | null
  /** A dividend's cash per share; null drops it. */
  value: number | null
  why: string
}

/** A proposed Correction, as ash_new records it. */
export interface PdCorrection extends CorrectionChange {
  id: number
  market: string
  status: 'waiting' | 'approved' | 'rejected'
  proposed_by: string
  proposed_at: string
  decided_at: string | null
}

/** A security a Health report flagged, held out of every Book until its Correction is approved or its flag dismissed. */
export interface PdQuarantine {
  id: number
  market: string
  security_id: string
  name: string | null
  check: string
  date: string | null
  detail: string
  /** The Health report that flagged it first. */
  since: string
  lifted_by: 'corrected' | 'dismissed' | null
  lifted_at: string | null
  correction_id: number | null
}

/** What `pd corrections propose` prints (contract/corrections-propose.schema.json). */
export interface PdCorrectionsPropose {
  recorded: PdCorrection[]
  /** Proposed before, as each is now: not recorded again. */
  known: PdCorrection[]
  /** Each entry that isn't a Correction, by its place in the file. */
  refused: { index: number; why: string }[]
}

/**
 * What `pd corrections approve|reject` and `pd quarantines dismiss` print, as the Answers Step reads
 * it (contract/corrections-decide.schema.json, quarantines-dismiss.schema.json): whether deciding
 * changed anything, and why not, as when it was decided already or there is no such item.
 */
export interface PdDecided {
  changed: boolean
  why: string | null
}

/**
 * What `pd marketsmith` prints (contract/marketsmith.schema.json): how each region's fetch of
 * MarketSmith's data ended. It exits 78 when MarketSmith rejected a cookie and nothing else failed.
 */
export interface PdMarketSmith {
  fetched_at: string
  regions: {
    region: 'IN' | 'US' | 'HK'
    status: 'fetched' | 'cookie_rejected' | 'failed'
    /** The setting in ash_new's .env the region authenticates with. */
    cookie: string
    run_id: string | null
    universe: number
    ok: number
    skipped: number
    /** Symbols whose fetch failed: each keeps its last fetch. */
    failed: number
    /** The fetch's dated snapshot, as a dossier names it: IN:2026-10-31. */
    snapshot: string | null
    error: string | null
  }[]
}

/**
 * One difference Reconciliation found between a Book's real portfolio and its broker's holdings
 * export: `quantity` (both hold it, in different numbers; `ratio` names a split's or bonus's shares,
 * "2 for 1", when the broker's are one), `not_in_ledger`, `not_at_broker`, or `unknown_security` (one
 * the securities table hasn't got, so it can't be compared).
 */
export interface PdDifference {
  kind: 'quantity' | 'not_in_ledger' | 'not_at_broker' | 'unknown_security'
  security_id: string | null
  /** As the export has it: ICICI Direct's holdings name each by ISIN, moomoo's positions by symbol. */
  isin: string | null
  symbol: string | null
  name: string | null
  ledger_qty: number | null
  broker_qty: number
  ratio: string | null
}

/** A holdings export reconciled against the ledger, as of the day it was downloaded. */
export interface PdReconciliation {
  as_of: string
  matched: number
  differences: PdDifference[]
}

/** What became of one Broker inbox file in `pd broker import`. */
export interface PdBrokerFile {
  file: string
  sha256: string
  broker: 'icici_direct' | 'moomoo' | null
  kind: 'tradebook' | 'holdings' | null
  book: 'IN' | 'US' | 'HK' | null
  portfolio_id: number | null
  /** seen: a tradebook with the same content was recorded already in this Book, so nothing is. unreadable: nothing in it was recorded, and `why` says why. */
  status: 'recorded' | 'seen' | 'reconciled' | 'unreadable'
  why: string | null
  /** set_aside: rows that aren't the Book's trades: not a buy or sale, another market's (moomoo's Hong Kong fills, to the US Book), or, in the US and Hong Kong Books, a security ash_new hasn't got. */
  trades: { recorded: number; in_ledger: number; set_aside: number } | null
  reconciliation: PdReconciliation | null
}

/**
 * What `pd broker import` prints (contract/broker-import.schema.json): each file handed in, identified
 * by its columns, tradebooks recorded first, then holdings exports reconciled, the unreadable last. A file
 * of several Books (moomoo's: the US Book's and the Hong Kong Book's) is an entry for each.
 */
export interface PdBrokerImport {
  dry_run: boolean
  files: PdBrokerFile[]
}

/** A Book's real money, as `pd book-holdings` prints it (contract/book-holdings.schema.json). */
export interface PdBook {
  book: 'IN' | 'US' | 'HK'
  name: string
  broker: 'icici_direct' | 'moomoo'
  broker_name: string
  currency: string
  /** Null before its broker's first file is recorded. */
  portfolio_id: number | null
  as_of: string | null
  value: number
  cash: number
  holdings: { security_id: string; name: string | null; qty: number; avg_cost: number | null; price: number | null; priced_on: string | null; value: number | null }[]
  reconciliation: (PdReconciliation & { file: string; reconciled_at: string }) | null
}

/** What `pd book-holdings` prints: each Book's real money, India first, then the US and Hong Kong. */
export interface PdBookHoldings {
  books: PdBook[]
}

/** What `pd clear-refresh` prints (contract/clear-refresh.schema.json): the refreshes it cleared, or why it refused. */
export interface PdClearRefresh {
  cleared: { job: number; status: 'failed'; error: string }[]
  refused: string | null
}

/** Where a strategy stands in a Book (the glossary's Stage), as ash_new names it. */
export type PdStage = 'candidate' | 'paper' | 'real_small' | 'real_full' | 'retired'

/** A strategy's version in a Book, from the day it became a Candidate, as `pd stages` prints it. */
export interface PdSleeve {
  /** Its id: a Candidate's item in the Brief is candidate:<id>. Null for one a dry run would record. */
  id: number | null
  book: 'IN' | 'US' | 'HK'
  strategy_id: string
  /** Null when it is no built-in strategy now. */
  name: string | null
  version: string
  /** The strategy's version now: another means it changed, and its new version is a Sleeve of its own. */
  current_version: string | null
  stage: PdStage
  /** The day it entered its Stage, in its Book's market. */
  since: string
  /** The day its strategy was launched, while its live track follows this version. */
  launch_date: string | null
  /** Its Stage changes, oldest first, each with who approved it and why. */
  history: { from: PdStage | null; stage: PdStage; date: string; at: string; by: string; why: string }[]
}

/**
 * What `pd stages check` prints (contract/stages-check.schema.json): each new version of a strategy
 * with a Sleeve, recorded as a Candidate (in a dry run, those that would be), then each Book's Sleeves.
 */
export interface PdStagesCheck {
  checked_at: string
  dry_run: boolean
  recorded: PdSleeve[]
  /** India, the US and Hong Kong, each with its day now: how long a Sleeve has been in its Stage is counted to it. */
  books: { book: 'IN' | 'US' | 'HK'; name: string; market: string; today: string; sleeves: PdSleeve[] }[]
}

/**
 * Runs `pd` in `cwd` and resolves with how it ended, its output kept whole. It is the first `pd`
 * on PATH, else the one in ash_new's own environment, so a `pd` put first on PATH (the tests'
 * stand-in) wins.
 */
export function runPd(args: string[], { cwd, timeoutMs }: { cwd: string; timeoutMs: number }): Promise<ProcessResult> {
  const pathKey = Object.keys(process.env).find((key) => key.toUpperCase() === 'PATH') ?? 'PATH'
  const scripts = join(ashNewFolder(), '.venv', process.platform === 'win32' ? 'Scripts' : 'bin')
  return runProcess('pd', args, { cwd, timeoutMs, env: { [pathKey]: [process.env[pathKey], scripts].filter(Boolean).join(delimiter) } })
}

/**
 * The JSON a `pd` command printed. Throws, with its error output, when it ran past its timeout,
 * exited with a code not in `exitCodes`, or printed something that isn't JSON.
 */
export async function pdJson<T>(args: string[], { cwd, timeoutMs, exitCodes = [0] }: { cwd: string; timeoutMs: number; exitCodes?: number[] }): Promise<T> {
  const { code, stdout, stderr, timedOut } = await runPd(args, { cwd, timeoutMs })
  const command = `pd ${args.join(' ')}`
  if (timedOut) throw new Error(`${command} timed out after ${Math.round(timeoutMs / 1000)}s`)
  if (code === null || !exitCodes.includes(code)) throw new Error(`${command} exited with ${code}: ${stderr.trim() || stdout.trim()}`)
  try {
    return JSON.parse(stdout)
  } catch {
    throw new Error(`${command} printed no JSON: ${stdout.trim() || stderr.trim()}`)
  }
}
