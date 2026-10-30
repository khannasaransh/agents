import { createServer } from 'node:http'
import { closeSync, openSync, readSync, readdirSync, readFileSync, realpathSync, statSync } from 'node:fs'
import { extname, isAbsolute, join, relative, sep } from 'node:path'
import { agentsRoot, dataDir, runsDir } from './paths.ts'
import { loadSchedules } from './schedule.ts'
import { readTokenUsage, summarizeTokenUsage } from './token-usage.ts'
import type { RunRecord } from './run.ts'
import type { PdStatus, PdMarketSmith } from './pd.ts'
import type { BrokerInboxResult } from '../steps/stocks/broker-inbox.ts'
import type { HealthResult } from '../steps/stocks/health.ts'
import type { LakeResult } from '../steps/stocks/lake.ts'
import type { AnswersResult } from '../steps/stocks/answers.ts'

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
    const match = /^(?:(.+?): )?(reviewer|pm|docs|health) (answered|failed) on (\S+) \(([^,]+), ([^)]+)\) (?:in|after) (\d+)s(?:: (.*))?$/.exec(line)
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
  const portfolio = view === 'portfolio' ? {
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
