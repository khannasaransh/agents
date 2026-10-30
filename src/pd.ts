// ash_new's `pd` command, the only way the stocks Pipeline reaches ash_new: it never reads ash_new's
// database or Lake files itself (the stocks Pipeline PRD's "Shape"). The JSON it prints is the
// contract between the two repos, described by the schemas in ash_new's contract folder.
import { delimiter, join } from 'node:path'
import { ashNewFolder, secContact } from './env.ts'
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
  /** The promotions waiting on Saransh (issue 35), oldest first: each Sleeve still in the Stage it was proposed from. */
  proposals: PdStageProposal[]
}

/** A Sleeve's promotion up a Stage, proposed by the Portfolio Manager for Saransh's Answer (issue 35): its item in the Brief is promotion:<id>. */
export interface PdStageProposal {
  id: number
  sleeve: number
  book: 'IN' | 'US' | 'HK'
  strategy_id: string
  version: string
  from: PdStage
  stage: PdStage
  why: string
  by: string
  at: string
  decision: 'approved' | 'rejected' | null
}

/**
 * What `pd stages propose` and `pd stages promote|reject` print (contract/stages-propose.schema.json,
 * stages-decide.schema.json): whether it changed anything and why not, the promotion, and its Sleeve now.
 */
export interface PdStagesDecided {
  changed: boolean
  why: string | null
  proposal: PdStageProposal | null
  sleeve: { id: number; book: 'IN' | 'US' | 'HK'; strategy_id: string; version: string; stage: PdStage; since: string } | null
}

/** The distribution of a backtest's returns over windows: its least, 5th to 95th percentiles and most. */
export interface PdQuantiles {
  min: number
  p5: number
  p25: number
  p50: number
  p75: number
  p95: number
  max: number
}

/** A live record, from its first session (a launch, or its last demotion) to the last. */
export interface PdLiveRecord {
  start: string
  end: string
  sessions: number
  return: number
  /** Its fall from its highest close, on its last: 0 or less. */
  drawdown: number
  max_drawdown: number
  /** Its return over its whole months, which its backtest's range is compared over; null under a month. */
  window: { months: number; return: number | null } | null
  /** Its return over the last 12 months; null before it has 12. */
  rolling_12m: number | null
  /** The benchmark's over the same sessions; null without its levels. */
  benchmark: { return: number; max_drawdown: number } | null
}

/** A live record against its backtest's range: the ten years before it began. */
interface PdJudgedRecord {
  record: PdLiveRecord | null
  backtest: { start: string; end: string; max_drawdown: number; rolling_12m: PdQuantiles | null; window: (PdQuantiles & { months: number }) | null } | null
  backtest_why: string | null
  /** Its drawdown no deeper than its backtest's worst, and its return over its whole months between its 5th and 95th percentiles; null without both. */
  in_range: boolean | null
  /** How it is outside its range, in sentences. */
  outside: string[]
}

/** A demotion: the half of the demotion rule a Sleeve broke, the Stage it moves down into, and whether it was applied. */
export interface PdDemotion {
  /** drawdown: past 1.5 times its backtest's worst; rolling_12m: after 12 months, under its backtest's 5th percentile. */
  rule: 'drawdown' | 'rolling_12m'
  why: string
  from: PdStage
  to: PdStage
  /** held: in a dry run, or while the Data gate fails. */
  status: 'demoted' | 'held'
  held_why: string | null
}

/** A Sleeve's next promotion: due now when its time is up, its record inside its tested range and it breaks no demotion rule. */
export interface PdPromotion {
  to: PdStage
  to_name: string
  /** The day its time in its Stage is up: 3 months of Paper, 6 of Real-small. */
  due: string
  due_now: boolean
  why: string | null
}

/** A Sleeve from Paper up, as the weekly review measured it. */
export interface PdSleeveReview extends PdJudgedRecord {
  id: number
  strategy_id: string
  version: string
  stage: PdStage
  stage_name: string
  since: string
  name: string | null
  /** no_record: its version isn't tracked live, or its track has no two sessions yet. */
  status: 'measured' | 'no_record'
  why: string | null
  demotion: PdDemotion | null
  promotion: PdPromotion | null
}

/**
 * What `pd review` prints (contract/review.schema.json): the weekly review. Each Book's paper Book and
 * its Sleeves against their backtests' ranges and benchmarks, the demotions the demotion rule made by
 * itself, the promotions due, and each real Book's latest Reconciliation.
 */
export interface PdReview {
  reviewed_at: string
  dry_run: boolean
  gate: { verdict: 'pass' | 'fail'; reasons: string[] }
  books: {
    book: 'IN' | 'US' | 'HK'
    name: string
    market: string
    currency: string
    /** Its real Book's broker, as the Reconciliation's differences are worded. */
    broker: 'icici_direct' | 'moomoo'
    broker_name: string
    benchmark: string
    today: string
    /** The paper Book's live record; not_started before it has two closes filled. */
    paper: PdJudgedRecord & { status: 'measured' | 'not_started' | 'no_record'; why: string | null }
    sleeves: PdSleeveReview[]
    reconciliation: (PdReconciliation & { file: string; reconciled_at: string }) | null
  }[]
  demotions: (PdDemotion & { book: 'IN' | 'US' | 'HK'; sleeve: number; strategy_id: string })[]
  promotions_due: (PdPromotion & { book: 'IN' | 'US' | 'HK'; sleeve: number; strategy_id: string; from: PdStage })[]
  /** With --month (the first Saturday of a month, of the month before): the monthly review; else null. */
  monthly: PdMonthlyReview | null
}

/** Where a paper Book's return over a month came from: each source's part, adding up to its return. */
export interface PdAttributionParts {
  /** Each strategy's Sleeve's holdings after the open's trades, at the Book's benchmark's return. */
  sleeve_weights: number
  /** What the Sleeves' holdings made beyond the benchmark. */
  picks: number
  gold: number
  /** What the cash fund earned, the Sleeves' own cash among it. */
  cash: number
  /** What the trades paid: less than nothing. */
  costs: number
  /** The paper Book's gap to its rules-only paper Book (not the sum of the Overrides' scores); null without it. */
  overrides: number | null
  /** For a Book not in rupees, its currency's move against the rupee; null for one in rupees, or without the rates. */
  currency: number | null
}

/**
 * The monthly review (ash_new's `pipeline.attribution`): for each Book's paper Book over the month, its
 * return attributed to its sources, the correlation between its Sleeves (each strategy's own backtest's
 * daily returns, and gold's, over the year to the month's end) and its drawdown against its limits.
 */
export interface PdMonthlyReview {
  /** YYYY-MM, and its first and last days. */
  month: string
  start: string
  end: string
  books: {
    book: 'IN' | 'US' | 'HK'
    name: string
    currency: string
    attribution: {
      /** no_record: its paper Book filled no close in the month. */
      status: 'measured' | 'no_record'
      why: string | null
      /** The close before the month's first close filled, and its last. */
      start: string | null
      end: string | null
      sessions: number
      /** What its return and parts are in: rupees, or the Book's currency without the rates. */
      currency: string
      return: number | null
      local_return: number | null
      rules_only_return: number | null
      benchmark_return: number | null
      parts: PdAttributionParts | null
      sleeves: { strategy_id: string; weights: number; picks: number }[]
      overrides_why: string | null
      /** The Book's currency in rupees at the start and the end, and its move. */
      fx: { from: number; to: number; move: number } | null
      currency_why: string | null
    }
    correlation: { start: string; end: string; pairs: { a: string; b: string; correlation: number | null }[]; why: string | null }
    drawdown: {
      status: 'measured' | 'no_record'
      why: string | null
      end: string | null
      /** At the month's last close filled, and the deepest in the month. */
      drawdown: number | null
      max_drawdown: number | null
      limits: { no_new_buys_at: number; halve_exposure_at: number; drawdown_limit: number }
      /** Each limit the month's deepest reached. */
      reached: ('no_new_buys_at' | 'halve_exposure_at' | 'drawdown_limit')[]
    }
  }[]
}

/**
 * What `pd book-state <book>` prints (contract/book-state.schema.json): what a real Book's Rule plan
 * starts from, with an id. Its cash is its capital with its ledger's money, since the brokers' files
 * hold none; every holding is Legacy until the Rule plan's orders are recorded. With --paper (or
 * --rules-only), its paper Book's (or rules-only paper Book's): the Book engine's state on its last
 * close filled, and the orders of its Order lists not yet filled.
 */
export interface PdBookState {
  id: string
  book: 'IN' | 'US' | 'HK'
  name: string
  /** A paper Book's state (`pd book-state <book> --paper`, or `--rules-only`): its capital in cash before its first Order list fills. */
  paper: boolean
  /** A rules-only paper Book's, which trades the Rule plan unchanged (a paper Book's state only). */
  rules_only?: boolean
  /** A paper Book's last close filled; null before its first Order list fills. */
  as_of?: string | null
  market: string
  currency: string
  portfolio_id: number | null
  ledger: { transactions: number; last: string | null }
  capital: number
  capital_set: boolean
  cash: number
  holdings: { security_id: string; name: string | null; qty: number; avg_cost: number | null; legacy: boolean }[]
  reconciliation: { as_of: string; file: string; matched: number } | null
  /** Reconciliation's open differences: neither bought nor sold on a signal until settled. */
  unsettled: { security_id: string | null; name: string | null; kind: PdReconciliation['differences'][number]['kind']; ledger_qty: number | null; broker_qty: number }[]
  /** A paper Book's: the orders of its Order lists not yet filled; a real Book's none until issue 42. */
  open_orders: { id: string; session: string; sleeve: string; security_id: string; side: 'BUY' | 'SELL'; shares: number; limit: number | null }[]
  /** The cash its open orders reserve: its buys' shares at their limits. */
  reserved: number
  stops: { sleeve: string; security_id: string; price: number }[]
}

/** A cut a rule made to an order: the rule (or why the Book mustn't trade it), the shares wanted and allowed. */
export interface PdCut {
  rule: string
  wanted: number
  allowed: number
}

/** An order of a Rule plan, for the next session. */
export interface PdPlanOrder {
  /** <book>-<session>-<n>; <book>-paper-<session>-<n> in a paper Book, <book>-rules-<session>-<n> in a rules-only one. */
  id: string
  book: 'IN' | 'US' | 'HK'
  /** Its strategy's id, or gold. */
  sleeve: string
  security_id: string
  name: string | null
  side: 'BUY' | 'SELL'
  shares: number
  /** The last close it was sized at. */
  price: number
  value: number
  /** A buy's limit: the last close plus the Book's tolerance; null for a sale. */
  limit: number | null
  /** first_allocation, rebalance, stop_loss, target, regime, untradeable, deferred, reweighting, breaker or disaster_stop. */
  reason: string
  /** What of its strategy's track signalled it; null for the Book's own orders and gold's. */
  signal: { kind: 'trade' | 'holding' | 'waiting'; action?: string; weight?: number; signal_date?: string; score?: number; rank?: number } | null
  cuts: PdCut[]
  /** A paper Book's plan's (issue 34): the security's sector. */
  sector?: string | null
  /**
   * A paper Book's plan's (issue 34): its role in its Sleeve. entry or add: a buy of a name it doesn't
   * hold, or does; exit: a sale of a name its strategy no longer holds; trim: any other sale; stop: its
   * Disaster stop. The final check never drops or delays an exit or a stop.
   */
  role?: 'entry' | 'add' | 'exit' | 'trim' | 'stop'
}

/** How much of the Portfolio Manager's judgement a Book's final check accepts (issue 34). */
export type PdJudgementMode = 'plan_only' | 'subtract_only' | 'playbook'

/** A Book's Playbook in force (issue 34): each Lever's range, under its version. */
export interface PdPlaybook {
  /** exposure: the floor the exposure level may be cut to, by Market condition. */
  exposure_floor: Record<PdCondition, number>
  /** size: the least and most multiple of a strategy's size. */
  size_min: number
  size_max: number
  /** timing: how many sessions a buy may wait. */
  timing_sessions: number
  /** rebalance: the share of the Book under which a rebalance may be skipped. */
  rebalance_under: number
  version: string
}

/** A name the Portfolio Manager may buy: a Pool name, or a buy made to wait, at its last close and limit. */
interface PdBuyable {
  security_id: string
  name: string | null
  close: number
  sector: string | null
  rs_rating: number | null
  limit: number
}

/** The kinds of Rule plan: a real Book's shadow plan, a paper Book's and a rules-only paper Book's. */
export type PdPlanKind = 'shadow' | 'paper' | 'rules_only'

/** A Book's Rule plan, as `pd plan` prints it: planned, or why it couldn't be. */
export interface PdRulePlan {
  id: string
  book: 'IN' | 'US' | 'HK'
  name: string
  /**
   * shadow: the real Book's, with one Sleeve, not for placing (issue 47); paper: the paper Book's, each
   * strategy from Paper up at its full share (issue 32); rules_only: its rules-only paper Book's, the
   * baseline the Portfolio Manager is judged against (issue 33). The Check Step records a paper and a
   * rules-only plan as Order lists, filled at the next open.
   */
  kind: PdPlanKind
  for_placing: boolean
  state_id: string
  mandate_version: string
  playbook_version: string
  /** hold: the Data gate failed, so no order is made and only Disaster stops sell. */
  mode: 'normal' | 'hold'
  /** market_shut: its market was shut the session before the Run's day, so it has no order. */
  status: 'planned' | 'market_shut' | 'cant_plan'
  why: string | null
  /** The exposure level its session trades under, which its market's condition on the last close sets. */
  exposure?: { condition: PdCondition; level: number } | null
  market?: string
  currency?: string
  /** The last session: the plan knows the data to its close. */
  as_of?: string
  /** The next session, which its orders are for. */
  session?: string
  data_version?: string
  book_data_version?: string
  strategies?: { id: string; name: string; version: string; stage: PdStage; disaster_stop: number }[]
  value?: number
  /** The money its Sleeves share. */
  cash?: number
  legacy?: { security_id: string; name: string | null; qty: number }[]
  weights?: Record<string, number> | null
  not_traded?: { security_id: string; name: string | null; why: 'unsettled' | 'quarantined' }[]
  orders?: PdPlanOrder[]
  /** Each order a rule cut to nothing. */
  dropped?: { sleeve: string; security_id: string; name: string | null; side: 'BUY' | 'SELL'; wanted: number; rule: string }[]
  /** A paper Book's Sleeves it couldn't run, with why. */
  left_out?: { strategy_id: string; version: string; stage: PdStage; why: string }[]
  /** The Disaster stops to place, for each new position, or raise (was: the stop it raises). */
  stops?: { sleeve: string; security_id: string; name: string | null; price: number; was: number | null }[]
  buys?: number
  sales?: number
  /** A paper Book's plan's (issue 34): its Judgement mode, and since when (null: its first). */
  judgement?: { mode: PdJudgementMode; since: string | null }
  /** A paper Book's plan's: the Book's Playbook in force. */
  playbook?: PdPlaybook
  /** A paper Book's plan's: the names a strategy with a Sleeve in the Book bought or signalled to buy in the last 2 months. */
  pool?: (PdBuyable & { strategies: string[]; signalled: string })[]
  /** A paper Book's plan's: each holding on the last close, Sleeve by Sleeve (Legacy ones under legacy). */
  holdings?: { sleeve: string; security_id: string; name: string | null; shares: number; close: number; sector: string | null; rs_rating: number | null; value: number; stop: number | null; sellable: boolean }[]
  /** A paper Book's plan's: the cash its open orders reserve. */
  reserved?: number
  /** A paper Book's plan's: the buys made to wait that may still be bought on its session, each by its Override's id. */
  waits?: (PdBuyable & { id: number; sleeve: string; shares: number; until: string })[]
}

/** A market's Market condition, as ash_new reads it from the Lake (issue 46). */
export type PdCondition = 'uptrend' | 'under_pressure' | 'correction'

/** A Book's market's condition on the last close, the exposure level it sets the Book, and MarketSmith's outlook beside it. */
export interface PdMarketCondition {
  market: string
  book: 'IN' | 'US' | 'HK'
  book_name: string
  status: 'read' | 'cant_read'
  why: string | null
  reading: {
    date: string
    condition: PdCondition
    /** The Book's benchmark. */
    index: string
    close: number | null
    short_average: number | null
    long_average: number | null
    /** The share of the index's members (or the market's securities) above their own 200-day average. */
    breadth: number | null
    /** The index whose members breadth was measured over (NIFTY500, SP500); null: the whole market's. */
    breadth_of: string | null
    distribution_days: number
  } | null
  /** The most of the Book in stocks the condition sets for the next session. */
  exposure_level: number | null
  levels: Record<PdCondition, number>
  /** MarketSmith's own outlook from its latest snapshot, deciding nothing; outlook null when the snapshot hasn't one. */
  marketsmith: { snapshot: string; day: string; outlook: string | null } | null
}

/** What `pd plan` prints (contract/plan.schema.json): each market's condition, and each Book's Rule plan for the Run's day. */
export interface PdPlan {
  on: string
  /** The Data gate, as pd status gives it: failing, every plan is in Hold mode. */
  gate: { verdict: 'pass' | 'fail'; reasons: string[] }
  mode: 'normal' | 'hold'
  markets: PdMarketCondition[]
  plans: PdRulePlan[]
  /** The names the Desk reviews, by the Feeds fetched before the plan, and every Book's holdings for pd feeds (issue 37). */
  review: PdReviewList
}

/** The Desk's analysts (the glossary). */
export type PdAnalyst = 'events' | 'chart' | 'risk'

/** A Book holding a name, real or paper. */
export interface PdHeldBy {
  book: 'IN' | 'US' | 'HK'
  kind: 'real' | 'paper'
  name: string
}

/** A name the Desk reviews in a paper Book's plan, with the analysts it needs and why. */
export interface PdReviewName {
  book: 'IN' | 'US' | 'HK'
  /** The plan's name: the paper Book's. */
  plan: string
  security_id: string
  name: string | null
  market: string
  /** Bought, sold, or held with results or another event in the next 5 sessions. */
  role: 'buy' | 'sale' | 'holding'
  held: boolean
  orders: string[]
  /** Events for an event in the next 5 sessions or one new since its last view, Chart for a buy; none for a sale. */
  analysts: { analyst: Exclude<PdAnalyst, 'risk'>; why: string }[]
  /** Why it needs none: a sale. */
  why: string | null
  /** Its events' ids in the next 5 sessions, and those new since its last view. */
  coming: string[]
  new: string[]
  /** Its dossier's path in the Run folder (contract/dossier.schema.json). */
  dossier: string | null
}

/** What `pd plan` prints of the Desk's work (contract/plan.schema.json's review). */
export interface PdReviewList {
  names: PdReviewName[]
  /** The Books with buys, for the Risk analyst over all of them. */
  risk: { book: 'IN' | 'US' | 'HK'; plan: string; buys: string[]; why: string }[]
  /** The analysts needed at all. */
  analysts: PdAnalyst[]
  /** Every Book's holdings, but its gold ETF and cash fund. */
  holdings: { security_id: string; name: string | null; market: string; held_by: PdHeldBy[] }[]
}

/** An event from the Feeds: its day is the one it is about (a meeting's, results'), else the day it was published. */
export interface PdEvent {
  id: string
  security_id: string
  source: PdFeedSource
  kind: 'announcement' | 'board_meeting' | 'results' | 'pledge' | 'filing' | 'insider'
  date: string
  title: string
  link: string | null
  published_at: string | null
  /** When it was first fetched, in UTC: a Decision record may cite only events fetched before its Run. */
  fetched_at: string
  detail: Record<string, unknown>
}

export type PdFeedSource = 'nse_announcements' | 'nse_board_meetings' | 'nse_pledges' | 'bse_announcements' | 'edgar' | 'yahoo_earnings'

/** What `pd feeds` prints (contract/feeds.schema.json): each source's fetch, and each name's events as fetched by then. */
export interface PdFeeds {
  on: string
  fetched_at: string
  /** A dry run: nothing fetched, only the cache read. */
  cached_only: boolean
  sources: {
    source: PdFeedSource
    label: string
    market: string
    /** failed: it stopped, keeping what it had; skipped: it can't be fetched at all (EDGAR without its contact). */
    status: 'fetched' | 'cached' | 'failed' | 'skipped'
    why: string | null
    names: number
    fetched: number
    cached: number
    new: number
  }[]
  names: { security_id: string; name: string | null; market: string; held_by: PdHeldBy[]; reviewed: boolean; events: PdEvent[] }[]
}

/** The Levers of a Playbook (the glossary). */
export const levers = ['exposure', 'selection', 'size', 'timing', 'trim', 'rebalance'] as const
export type PdLever = (typeof levers)[number]

/** A Decision record (the glossary): the evidence behind a change from the Rule plan, or the day's exposure level. */
export interface PdDecisionRecord {
  /** What the Rule plan said: its order, or its exposure level. */
  rule_plan: string
  /** What goes out instead. */
  instead: string
  lever: PdLever
  /** The Playbook's line the change is within. */
  playbook: string
  /** Each figure it rests on: the input file (its path in the Run folder), what it is about, the field and its value. */
  figures: { input: string; security: string | null; field: string; value: number | string | boolean | null }[]
  expected: string
  /** The session it is judged on, after the plan's. */
  judged_on: string
}

/** The kinds of change from the Rule plan the Portfolio Manager may make (issue 34). */
export const changeKinds = ['drop', 'resize', 'swap', 'wait', 'release', 'trim', 'skip'] as const
export type PdChangeKind = (typeof changeKinds)[number]

/** A change from a paper Book's Rule plan, as the Portfolio Manager makes it. */
export interface PdChange {
  kind: PdChangeKind
  /** The Rule plan's order it changes (drop, resize, swap, wait, skip). */
  order: string | null
  /** A swap's name bought; a trim's holding. */
  security_id: string | null
  /** A trim's Sleeve. */
  sleeve: string | null
  /** A swap's, trim's or release's shares (a release's: all those waiting when null). */
  shares: number | null
  /** A resize's multiple of the order's shares. */
  multiple: number | null
  /** How many sessions a wait holds the buy back. */
  sessions: number | null
  /** A release's wait, by its id in the plan's waits. */
  wait: number | null
  decision: PdDecisionRecord
}

/** The Portfolio Manager's judgement of one paper Book's Rule plan. */
export interface PdJudgedBook {
  book: 'IN' | 'US' | 'HK'
  plan_id: string
  state_id: string
  mandate_version: string
  playbook_version: string
  /** The exposure level for the day: the plan's, or a cut, with its Decision record. */
  exposure: { level: number; decision: PdDecisionRecord }
  changes: PdChange[]
  /** The Brief's commentary on the Book. */
  commentary: string
}

/**
 * The Portfolio Manager's judgement as the Check Step hands it to `pd check --judgement`
 * (contract/judgement.schema.json): whether it answered, the Run's inputs its Decision records may
 * cite (files beside it in the Run folder), and its judgement of each Book.
 */
export interface PdJudgement {
  status: 'answered' | 'failed'
  why: string | null
  inputs: string[]
  books: PdJudgedBook[]
}

/** A change as the final check judged it: whether it was accepted and why not, the Rule plan's order it changed and the orders it made. */
export type PdJudgedChange = Omit<Partial<PdChange>, 'kind' | 'decision'> & { kind: PdChangeKind | 'exposure'; decision: PdDecisionRecord } & {
  /** An exposure level's change: the level. */
  level?: number
  lever: PdDecisionRecord['lever'] | null
  accepted: boolean
  why: string | null
  rule_order: PdPlanOrder | null
  orders: PdPlanOrder[]
  /** An exposure cut's: the Rule plan's buys it took out. */
  dropped?: string[]
}

/** What the final check made of the Portfolio Manager's judgement of a paper Book's plan. */
export interface PdListJudgement {
  /** judgement: its changes that passed went out; rule_plan: the Rule plan did; exits_only: only its exits and Disaster stops. */
  applied: 'judgement' | 'rule_plan' | 'exits_only'
  /** Why not the Portfolio Manager's changes. */
  why: string | null
  /** The exposure level the list goes out at. */
  level: number
  /** Each change judged, the exposure level's first. */
  changes: PdJudgedChange[]
  /** When only the exits and stops went out: what Saransh should look into. */
  todo: string | null
  commentary: string | null
}

/** What became of a paper Book's Order list in `pd check`. */
export interface PdOrderList {
  book: 'IN' | 'US' | 'HK'
  kind: 'paper' | 'rules_only'
  name: string
  plan_id: string
  /** The list's id: its plan's, or for a list the judgement changed, the hash of its plan's and its orders. */
  list_id: string | null
  /** A paper Book's: what the final check made of the Portfolio Manager's judgement; null for a rules-only one's. */
  judgement: PdListJudgement | null
  /** The session its orders are for; null without a plan. */
  session: string | null
  orders: number
  /** unchanged: the same plan is recorded already; would_record: in a dry run. */
  status: 'recorded' | 'unchanged' | 'not_recorded' | 'would_record'
  why: string | null
  /** The orders of the session's earlier list it superseded. */
  superseded: number
}

/**
 * What `pd check --plan <file> --judgement <file>` prints (contract/check.schema.json): the final
 * Order lists recorded for the paper Books to fill at the next open: each paper Book's Rule plan with
 * the Portfolio Manager's changes the final check accepted, each rules-only one's own Rule plan.
 */
export interface PdCheck {
  on: string
  run: string | null
  dry_run: boolean
  lists: PdOrderList[]
}

/** A proposal waiting on Saransh's Answer: to move a Book's Judgement mode, or to change its Playbook's ranges. */
export interface PdJudgementProposal {
  id: number
  book: string
  /** A mode's side: the paper Book's (true) or the real Book's; null for Playbook ranges. */
  paper: boolean | null
  mode: PdJudgementMode | null
  /** Each range's new value, by its name (an exposure floor as exposure_floor.<condition>). */
  playbook: Record<string, number> | null
  why: string
  by: string
  at: string
  decision: 'approved' | 'rejected' | null
}

/** A Book's Judgement mode on one side: as the Brief writes it, and the change that set it (null: its first). */
interface PdJudgementSide {
  mode: PdJudgementMode
  name: string
  change: { date: string; by: string; why: string } | null
}

/** What `pd judgement show` prints (contract/judgement-show.schema.json). */
export interface PdJudgementShow {
  books: { book: string; name: string; real: PdJudgementSide; paper: PdJudgementSide; playbook: PdPlaybook; playbook_changes: Record<string, number>[]; history: unknown[] }[]
  /** The proposals waiting on Saransh, oldest first. */
  proposals: PdJudgementProposal[]
}

/** A paper Book on its last close filled, or its capital before its first Order list fills. */
export interface PdPaperStanding {
  started_on: string | null
  as_of: string | null
  value: number
  cash: number
  invested: number
  nav: number
  peak: number
  /** Its value per unit against its highest close: 0 or less. */
  drawdown: number
  /** False while the first breaker stops new buys. */
  buying: boolean
  /** True while the second breaker halves its exposure. */
  halved: boolean
  lists_waiting: string[]
  orders_waiting: number
}

/** A Book's paper Books, as `pd paper-books` gives them. */
export interface PdPaperBook {
  book: 'IN' | 'US' | 'HK'
  name: string
  market: string
  currency: string
  paper: PdPaperStanding
  rules_only: PdPaperStanding
  /** The paper Book's value less its rules-only paper Book's: what judgement added (ADR 0004). */
  gap: { value: number; share: number } | null
  breakers: { no_new_buys_at: number; halve_exposure_at: number }
  sleeves: { strategy_id: string; version: string; stage: PdStage; stage_name: string; since: string; value: number | null }[]
  gold: number | null
  risk_per_trade: number
  /** The positions whose Disaster stop would lose more than risk_per_trade of the paper Book. */
  stops_at_risk: { sleeve: string; security_id: string; name: string | null; qty: number; close: number; stop: number; loss: number; share: number }[]
}

/** What `pd paper-books` prints (contract/paper-books.schema.json): how each Book's paper Books stand. */
export interface PdPaperBooks {
  books: PdPaperBook[]
  /** The paper Books' values together in rupees; a Book whose currency has no rate is missing. */
  combined: { currency: string; value: number; rates: Record<string, number>; missing: ('IN' | 'US' | 'HK')[] }
}

/**
 * Runs `pd` in `cwd` and resolves with how it ended, its output kept whole. It is the first `pd`
 * on PATH, else the one in ash_new's own environment, so a `pd` put first on PATH (the tests'
 * stand-in) wins. The SEC's User-Agent contact from the env file goes with it as PDASH_SEC_CONTACT.
 */
export function runPd(args: string[], { cwd, timeoutMs }: { cwd: string; timeoutMs: number }): Promise<ProcessResult> {
  const pathKey = Object.keys(process.env).find((key) => key.toUpperCase() === 'PATH') ?? 'PATH'
  const scripts = join(ashNewFolder(), '.venv', process.platform === 'win32' ? 'Scripts' : 'bin')
  const contact = secContact()
  return runProcess('pd', args, { cwd, timeoutMs, env: { [pathKey]: [process.env[pathKey], scripts].filter(Boolean).join(delimiter), ...(contact ? { PDASH_SEC_CONTACT: contact } : {}) } })
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
