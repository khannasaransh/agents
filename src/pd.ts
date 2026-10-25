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

/** A Correction as the Corrections file holds it: what the Health Agent proposes. */
export interface CorrectionChange {
  security_id: string
  kind: 'split' | 'dividend' | 'demerger'
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

/** What `pd clear-refresh` prints (contract/clear-refresh.schema.json): the refreshes it cleared, or why it refused. */
export interface PdClearRefresh {
  cleared: { job: number; status: 'failed'; error: string }[]
  refused: string | null
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
