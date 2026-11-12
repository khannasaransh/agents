import { createServer } from 'node:http'
import { closeSync, openSync, readSync, readdirSync, readFileSync, realpathSync, statSync } from 'node:fs'
import { extname, isAbsolute, join, relative, sep } from 'node:path'
import { agentsRoot, dataDir, runsDir } from './paths.ts'
import { loadSchedules } from './schedule.ts'
import { readTokenUsage, summarizeTokenUsage } from './token-usage.ts'
import type { RunRecord } from './run.ts'
import type { PdBookState, PdJudgedBook, PdMarketSmith, PdPaperBooks, PdPaperStanding, PdPlan, PdPlanKind, PdPlanOrder, PdRulePlan, PdStatus } from './pd.ts'
import type { BrokerInboxResult } from '../steps/stocks/broker-inbox.ts'
import type { CheckResult } from '../steps/stocks/check.ts'
import type { HealthResult } from '../steps/stocks/health.ts'
import type { LakeResult } from '../steps/stocks/lake.ts'
import type { AnswersResult } from '../steps/stocks/answers.ts'
import type { PortfolioManagerResult } from '../steps/stocks/portfolio-manager.ts'

export type DashboardView = 'engineering' | 'portfolio'
const pipelines = { engineering: new Set(['daily', 'weekly']), portfolio: new Set(['stocks']) }
const extensions = new Set(['.json', '.log', '.md', '.html'])
const maxText = 1024 * 1024

/** Resolve only real files inside a root, including through symlinks. */
export function containedFile(root: string, name: string): string {
  const base = realpathSync(root)
  const file = realpathSync(join(base, name))
  const rel = relative(base, file)
  if (!rel || rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel) || !statSync(file).isFile()) throw new Error('File outside data area')
  return file
}

function entries(folder: string): string[] {
  try { return readdirSync(folder) } catch { return [] }
}

function json<T>(folder: string, name: string): T | null {
  try { return JSON.parse(readFileSync(containedFile(folder, name), 'utf8')) as T } catch { return null }
}

/** Logs can be large: read only their latest MiB, clearly marked when truncated. */
function tail(file: string): string {
  const size = statSync(file).size
  const fd = openSync(file, 'r')
  try {
    const buffer = Buffer.alloc(Math.min(size, maxText))
    const read = readSync(fd, buffer, 0, buffer.length, Math.max(0, size - maxText))
    return (size > maxText ? '[Showing the last 1 MiB of this file]\n' : '') + buffer.subarray(0, read).toString('utf8')
  } finally { closeSync(fd) }
}

export function agentAttempts(log: string, step: string) {
  return log.split('\n').flatMap((line) => {
    const metadata = / \[tokens=(\{.*\})\]$/.exec(line)
    let usage = null
    if (metadata) {
      try { usage = readTokenUsage(JSON.parse(metadata[1])) } catch { /* Invalid metadata stays unavailable. */ }
      line = line.slice(0, metadata.index)
    }
    const match = /^(?:(.+?): )?((?:reviewer|pm|docs|health|portfolio-manager|events|chart|risk)(?:-adversary|-contest)?) (answered|failed) on (\S+) \(([^,]+), ([^)]+)\) (?:in|after) (\d+)s(?:: (.*))?$/.exec(line)
    if (!match) return []
    const [, target, agent, outcome, worker, model, effort, seconds, error] = match
    return [{ step, target: target ?? 'Whole run', agent, outcome, worker, model, effort, seconds: Number(seconds), error: error ?? null, usage }]
  })
}

function artifacts(folder: string, prefix = '', depth = 0): { path: string; bytes: number }[] {
  if (depth > 2) return []
  return entries(join(folder, prefix)).sort().flatMap((name) => {
    const path = prefix ? `${prefix}/${name}` : name
    try {
      const info = statSync(join(folder, path))
      if (info.isDirectory()) return artifacts(folder, path, depth + 1)
      if (!extensions.has(extname(path))) return []
      return [{ path, bytes: statSync(containedFile(folder, path)).size }]
    } catch { return [] }
  })
}

function runRecord(id: string): RunRecord | null {
  if (!/^[\w-]+$/.test(id)) return null
  // Validate the directory too: a linked run.json alone must not authorize an outside run folder.
  try {
    const rel = relative(realpathSync(runsDir()), realpathSync(join(runsDir(), id)))
    if (!rel || rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel)) return null
  } catch { return null }
  const run = json<RunRecord>(runsDir(), `${id}/run.json`)
  const timestamp = (value: unknown) => typeof value === 'string' && Number.isFinite(Date.parse(value))
  return run && run.id === id && Object.values(pipelines).some(group => group.has(run.pipeline))
    && ['running', 'succeeded', 'partial', 'failed'].includes(run.status) && timestamp(run.startedAt)
    && (run.endedAt === undefined || timestamp(run.endedAt))
    && Array.isArray(run.steps) && run.steps.every(step => step && typeof step.name === 'string' && typeof step.log === 'string'
      && ['pending', 'running', 'succeeded', 'failed', 'skipped'].includes(step.status)
      && (step.startedAt === undefined || timestamp(step.startedAt)) && (step.endedAt === undefined || timestamp(step.endedAt))) ? run : null
}

/** A holding of a Book's on its last close, as the portfolio page lists it. */
export interface DashboardHolding {
  security_id: string
  name: string | null
  qty: number
  avg_cost: number | null
  /** The last close the plan knew; null when no plan of the Book priced it. */
  close: number | null
  value: number | null
  /** The Sleeves holding it, each with its Disaster stop (null: none). */
  sleeves: { sleeve: string; stop: number | null }[]
}

/** The part of the Book engine's state the page reads: each Sleeve's holdings and Disaster stops. */
interface EngineSleeves {
  sleeves?: Record<string, { holdings?: Record<string, unknown> }>
  stops?: Record<string, Record<string, number>>
}

/** One Book of one kind (real, paper or rules-only) in a Run: its plan, holdings, orders and what became of them. */
export interface DashboardBook {
  book: string
  kind: PdPlanKind
  name: string
  currency: string | null
  as_of: string | null
  value: number | null
  cash: number | null
  plan: { status: PdRulePlan['status']; why: string | null; mode: PdRulePlan['mode']; for_placing: boolean; session: string | null; exposure: PdRulePlan['exposure'] | null } | null
  holdings: DashboardHolding[]
  orders: PdPlanOrder[]
  stops: NonNullable<PdRulePlan['stops']>
  /** What the Check Step made of its Order list; null when it didn't run. */
  list: { status: string; why: string | null; orders: number; superseded: number } | null
  /** The Portfolio Manager's judgement of its plan; null for a rules-only Book's, or when it didn't answer. */
  judgement: PdJudgedBook | null
  /** A paper Book's standing from pd paper-books, with its gap to the rules-only one on the paper Book's. */
  standing: PdPaperStanding | null
  gap: { value: number; share: number } | null
}

const list = <T>(value: T[] | null | undefined): T[] => Array.isArray(value) ? value.filter(item => item !== null && item !== undefined) : []

/**
 * Each Book of each kind in the Run, from its plan, Book state, Order list, the Portfolio Manager's
 * judgement and the paper Books' standing. plan.json is trimmed here: its names not traded (every
 * Quarantine) would make each 15-second refresh a quarter of a megabyte.
 */
export function dashboardBooks(plan: PdPlan | null, states: { states?: PdBookState[] } | null, check: CheckResult | null, manager: PortfolioManagerResult | null, paper: PdPaperBooks | null): DashboardBook[] {
  const plans = list(plan?.plans)
  const judged = manager?.status === 'answered' ? list(manager.answer?.books) : []
  const kindOf = (state: PdBookState): PdPlanKind => !state.paper ? 'real' : state.rules_only ? 'rules_only' : 'paper'
  const keys = new Map<string, { book: string; kind: PdPlanKind }>()
  for (const p of plans) keys.set(`${p.book}/${p.kind}`, { book: p.book, kind: p.kind })
  for (const s of list(states?.states)) keys.set(`${s.book}/${kindOf(s)}`, { book: s.book, kind: kindOf(s) })
  const order = { IN: 0, US: 1, HK: 2 } as Record<string, number>, kinds = { real: 0, paper: 1, rules_only: 2 }
  return [...keys.values()].sort((a, b) => (order[a.book] ?? 9) - (order[b.book] ?? 9) || kinds[a.kind] - kinds[b.kind]).map(({ book, kind }) => {
    const p = plans.find(item => item.book === book && item.kind === kind) ?? null
    const state = list(states?.states).find(item => item.book === book && kindOf(item) === kind) ?? null
    // A rules-only plan lists no holdings: its closes are the other plans' of the same Book.
    const closes = new Map<string, number>()
    for (const other of plans.filter(item => item.book === book)) {
      for (const h of list(other.holdings)) closes.set(h.security_id, h.close)
      for (const o of list(other.orders)) if (!closes.has(o.security_id)) closes.set(o.security_id, o.price)
    }
    // Each holding's Sleeves and stops: the engine's state has them for every paper Book; a real Book's plan lists them.
    const engine = (state?.engine ?? null) as EngineSleeves | null
    const sleevesOf = (security: string) => {
      const fromEngine = Object.entries(engine?.sleeves ?? {}).filter(([, sleeve]) => sleeve?.holdings && security in sleeve.holdings)
        .map(([sleeve]) => ({ sleeve, stop: engine?.stops?.[sleeve]?.[security] ?? null }))
      return fromEngine.length ? fromEngine : list(p?.holdings).filter(item => item.security_id === security).map(item => ({ sleeve: item.sleeve, stop: item.stop }))
    }
    const holdings = list(state?.holdings).map((h): DashboardHolding => {
      const close = closes.get(h.security_id) ?? null
      return { security_id: h.security_id, name: h.name, qty: h.qty, avg_cost: h.avg_cost, close, value: close === null ? null : close * h.qty, sleeves: sleevesOf(h.security_id) }
    })
    const listed = list(check?.check?.lists).find(item => item.book === book && item.kind === kind)
    const standing = list(paper?.books).find(item => item.book === book)
    return {
      book, kind, name: p?.name ?? state?.name ?? book, currency: p?.currency ?? state?.currency ?? null,
      as_of: p?.as_of ?? state?.as_of ?? null, value: p?.value ?? null, cash: p?.cash ?? state?.cash ?? null,
      plan: p && { status: p.status, why: p.why, mode: p.mode, for_placing: p.for_placing, session: p.session ?? null, exposure: p.exposure ?? null },
      holdings, orders: list(p?.orders), stops: list(p?.stops),
      list: listed ? { status: listed.status, why: listed.why, orders: listed.orders, superseded: listed.superseded } : null,
      judgement: kind === 'rules_only' || !p ? null : judged.find(item => item.plan_id === p.id) ?? null,
      standing: kind === 'paper' ? standing?.paper ?? null : kind === 'rules_only' ? standing?.rules_only ?? null : null,
      gap: kind === 'paper' ? standing?.gap ?? null : null,
    }
  })
}

/** What the page shows of the Portfolio Manager's answer: all but the Books (each in its DashboardBook) and the Journal it read. */
function managerOf(manager: PortfolioManagerResult | null) {
  if (!manager) return null
  if (manager.status !== 'answered') return { status: manager.status, error: manager.error ?? null }
  const { books, ...rest } = manager.answer
  return { status: manager.status, error: null, books: list(books).length, ...rest }
}

export function dashboardRun(id: string, view: DashboardView = 'engineering') {
  const run = runRecord(id)
  if (!run || !pipelines[view].has(run.pipeline)) return null
  const folder = join(runsDir(), id)
  const files = artifacts(folder)
  const steps = run.steps.map(step => {
    let log = ''
    try { log = tail(containedFile(folder, step.log)) } catch { /* Pending steps may have no log. */ }
    const notes = log.split('\n').filter(line => line.trim() && !line.startsWith('---'))
    return { ...step, note: notes.at(-1) ?? null, attempts: agentAttempts(log, step.name), logTruncated: log.startsWith('[Showing') }
  })
  const readFolder = (name: string) => files.filter(file => file.path.startsWith(`${name}/`) && file.path.endsWith('.json')).map(file => json<Record<string, unknown>>(folder, file.path)).filter(Boolean)
  const attempts = steps.flatMap(step => step.attempts)
  const tokenUsage = {
    ...summarizeTokenUsage(attempts),
    truncated: steps.some(step => step.logTruncated),
    agents: [...new Set(attempts.map(attempt => attempt.agent))].map(agent => ({ agent, ...summarizeTokenUsage(attempts.filter(attempt => attempt.agent === agent)) })),
  }
  const plan = view === 'portfolio' ? json<PdPlan>(folder, 'plan.json') : null
  const manager = view === 'portfolio' ? json<PortfolioManagerResult>(folder, 'portfolio-manager.json') : null
  const paperBooks = view === 'portfolio' ? json<PdPaperBooks>(folder, 'paper-books.json') : null
  const portfolio = view === 'portfolio' ? {
    books: dashboardBooks(plan, json(folder, 'book-states.json'), json<CheckResult>(folder, 'check.json'), manager, paperBooks),
    market: plan && { on: plan.on, gate: plan.gate, mode: plan.mode, markets: list(plan.markets) },
    paperCombined: paperBooks?.combined ?? null,
    portfolioManager: managerOf(manager),
    lake: json<LakeResult>(folder, 'lake.json'),
    status: json<PdStatus>(folder, 'lake/status.json'),
    healthStatus: json<PdStatus>(folder, 'health/status.json'),
    health: json<HealthResult>(folder, 'health.json'),
    broker: json<BrokerInboxResult>(folder, 'broker-inbox.json'),
    answers: json<AnswersResult>(folder, 'answers.json'),
    marketSmith: json<PdMarketSmith>(folder, 'marketsmith.json'),
    todos: files.filter(file => /^todos\/[^/]+\.json$/.test(file.path)).flatMap(file => {
      const values = json<unknown>(folder, file.path)
      return Array.isArray(values) ? values.filter((value): value is string => typeof value === 'string').map(todo => ({ step: file.path.slice(6, -5), todo })) : []
    }),
  } : null
  return { ...run, steps, files, tokenUsage, portfolio, pm: json(folder, 'pm.json'), reviews: readFolder('review'), fetches: readFolder('fetch'), docs: json(folder, 'docs/result.json') }
}

export async function dashboardSnapshot(view: DashboardView = 'engineering') {
  const warnings: string[] = []
  const runs = entries(runsDir()).flatMap(id => {
    const run = runRecord(id)
    if (!run) {
      if (entries(join(runsDir(), id)).includes('run.json')) warnings.push(`Could not read Run ${id}; its record is invalid, unavailable, or still writing.`)
      return []
    }
    if (!pipelines[view].has(run.pipeline)) return []
    const files = ['brief.html', 'brief.md'].filter(name => { try { containedFile(runsDir(), `${id}/${name}`); return true } catch { return false } })
    return [{ ...run, briefs: files }]
  }).sort((a, b) => b.startedAt.localeCompare(a.startedAt) || b.id.localeCompare(a.id, 'en', { numeric: true }))
  let scheduleLog = ''
  try { scheduleLog = tail(containedFile(dataDir(), 'scheduled-starts.log')) } catch { /* No scheduled runs yet. */ }
  return {
    generatedAt: new Date().toISOString(), timeZone: 'Asia/Singapore', dataPath: dataDir(), view, runs, warnings,
    schedules: (await loadSchedules()).filter(schedule => pipelines[view].has(schedule.pipeline)),
    backlog: { daily: json<string[]>(dataDir(), 'state/pm-backlog.json') ?? [], weekly: json<string[]>(dataDir(), 'state/weekly-pm-backlog.json') ?? [] },
    scheduleLog: scheduleLog.split('\n').filter(line => [...pipelines[view]].some(pipeline => line.includes(` ${pipeline}:`))).join('\n'),
  }
}

/** A read-only local dashboard. It never launches or changes a pipeline. */
export function createDashboardServer() {
  return createServer(async (request, response) => {
    response.setHeader('Cache-Control', 'no-store')
    response.setHeader('X-Content-Type-Options', 'nosniff')
    response.setHeader('Referrer-Policy', 'no-referrer')
    response.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; frame-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'self'")
    const send = (status: number, body: string | Buffer, type = 'application/json; charset=utf-8') => { response.writeHead(status, { 'Content-Type': type }); response.end(body) }
    try {
      if (!/^(127\.0\.0\.1|localhost)(:\d+)?$/.test(request.headers.host ?? '')) return send(403, '{"error":"Local access only"}')
      if (request.method !== 'GET') return send(405, '{"error":"Read-only dashboard"}')
      const url = new URL(request.url ?? '/', 'http://localhost')
      const view: DashboardView = url.pathname.startsWith('/api/portfolio/') ? 'portfolio' : 'engineering'
      if (['/api/dashboard', '/api/portfolio/dashboard'].includes(url.pathname)) return send(200, JSON.stringify(await dashboardSnapshot(view)))
      if (['/api/run', '/api/portfolio/run'].includes(url.pathname)) {
        const run = dashboardRun(url.searchParams.get('id') ?? '', view)
        return send(run ? 200 : 404, JSON.stringify(run ?? { error: 'Run not found' }))
      }
      const artifactRoute = /^\/runs\/([\w-]+)\/(.+)$/.exec(url.pathname)
      if (url.pathname === '/api/file' || artifactRoute) {
        const id = artifactRoute?.[1] ?? url.searchParams.get('run') ?? ''
        const name = artifactRoute ? decodeURIComponent(artifactRoute[2]) : url.searchParams.get('path') ?? ''
        if (!runRecord(id) || !extensions.has(extname(name))) return send(404, '{"error":"File not found"}')
        // Also contain the run within the runs area, so a symlinked run cannot escape it.
        const file = containedFile(runsDir(), `${id}/${name}`)
        containedFile(join(runsDir(), id), name)
        if (extname(name) === '.html') {
          response.setHeader('Content-Security-Policy', "sandbox allow-popups; default-src 'none'; style-src 'unsafe-inline'; img-src data:; base-uri 'none'; form-action 'none'")
          return send(200, readFileSync(file), 'text/html; charset=utf-8')
        }
        return send(200, tail(file), 'text/plain; charset=utf-8')
      }
      if (url.pathname === '/portfolio-guide.md') return send(200, readFileSync(join(agentsRoot, 'docs', 'portfolio-dashboard.md')), 'text/plain; charset=utf-8')
      const name = new Map([['/', 'index.html'], ['/portfolio', 'portfolio.html'], ['/portfolio/', 'portfolio.html'], ['/portfolio.js', 'portfolio.js'], ['/portfolio.css', 'portfolio.css'], ['/dashboard.js', 'dashboard.js'], ['/dashboard.css', 'dashboard.css']]).get(url.pathname)
      if (!name) return send(404, '{"error":"Not found"}')
      const types: Record<string, string> = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' }
      send(200, readFileSync(join(agentsRoot, 'dashboard', name)), `${types[extname(name)]}; charset=utf-8`)
    } catch {
      send(404, '{"error":"Data unavailable; refresh to retry"}')
    }
  })
}

export function startDashboard(port = 4310) {
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Port must be between 1 and 65535')
  const server = createDashboardServer()
  server.on('error', error => { console.error(`Dashboard: ${error.message}`); process.exitCode = 1 })
  server.listen(port, '127.0.0.1', () => console.log(`Pipeline dashboard: http://127.0.0.1:${port}\nPortfolio dashboard: http://127.0.0.1:${port}/portfolio`))
  return server
}
