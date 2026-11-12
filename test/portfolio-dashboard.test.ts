import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, test } from 'node:test'
import { createDashboardServer, dashboardRun, dashboardSnapshot } from '../src/dashboard.ts'
import { portfolioFixture } from './portfolio-dashboard-fixture.ts'

const original = process.env.AGENTS_DATA_DIR
const folders: string[] = []
afterEach(() => {
  if (original === undefined) delete process.env.AGENTS_DATA_DIR
  else process.env.AGENTS_DATA_DIR = original
  for (const folder of folders.splice(0)) rmSync(folder,{recursive:true,force:true})
})
function fixture() {
  const data = mkdtempSync(join(tmpdir(),'portfolio-dashboard-test-')); folders.push(data)
  process.env.AGENTS_DATA_DIR = data
  return {data,...portfolioFixture(data)}
}
test('portfolio and engineering snapshots keep their runs and schedules separate', async () => {
  const {data,id} = fixture()
  mkdirSync(join(data,'runs','engineering'))
  writeFileSync(join(data,'runs','engineering','run.json'),JSON.stringify({id:'engineering',pipeline:'daily',status:'succeeded',startedAt:'2026-10-29T00:00:00Z',steps:[]}))
  writeFileSync(join(data,'scheduled-starts.log'),'2026-10-29 daily: engineering\n2026-10-29 stocks: portfolio\n')
  const portfolio = await dashboardSnapshot('portfolio'), engineering = await dashboardSnapshot()
  assert.deepEqual(portfolio.runs.map(run => run.id),[id])
  assert.deepEqual(engineering.runs.map(run => run.id),['engineering'])
  assert.deepEqual(portfolio.schedules.map(schedule => schedule.pipeline),['stocks'])
  assert.match(portfolio.scheduleLog,/stocks:/)
  assert.doesNotMatch(portfolio.scheduleLog,/daily:/)
  assert.equal(dashboardRun(id),null)
  assert.equal(dashboardRun('engineering','portfolio'),null)
})
test('portfolio run exposes recorded book, lake, health, attention and token snapshots', () => {
  const {id} = fixture()
  const run = dashboardRun(id,'portfolio')!
  assert.equal(run.portfolio?.status?.gate.verdict,'pass')
  assert.equal(run.portfolio?.health?.status,'diagnosed')
  assert.equal(run.portfolio?.broker?.books?.books[0].currency,'INR')
  assert.equal(run.portfolio?.broker?.books?.books[1].value,0)
  assert.equal(run.portfolio?.broker?.books?.books[2].portfolio_id,null)
  assert.equal(run.portfolio?.todos[0].step,'lake')
  assert.equal(run.tokenUsage.agents[0].agent,'health')
  assert.equal(run.tokenUsage.tokens?.totalTokens,1280)
})
test("each Book's plan, holdings, orders, Order list and the Portfolio Manager's judgement come together", () => {
  const {id} = fixture()
  const run = dashboardRun(id,'portfolio')!
  const books = run.portfolio!.books
  assert.deepEqual(books.map(book => book.kind),['real','paper','rules_only'])
  const [real,paper,rules] = books
  assert.equal(real.list?.status,'not_recorded')
  assert.match(real.list?.why ?? '',/Real-small/)
  assert.equal(real.orders[0].security_id,'US:GLD')
  assert.equal(real.cash,400)
  assert.equal(real.judgement?.commentary,'Fixture real commentary')
  assert.equal(real.standing,null)
  // A paper Book's holding is valued at its plan's close, with its Sleeve's stop from the engine.
  assert.deepEqual(paper.holdings,[{security_id:'US:HELD',name:'Held Co',qty:10,avg_cost:55,close:60,value:600,sleeves:[{sleeve:'cw2',stop:50}]}])
  assert.equal(paper.orders[0].side,'SELL')
  assert.equal(paper.judgement?.changes[0].kind,'wait')
  assert.deepEqual(paper.gap,{value:10,share:0.01})
  assert.equal(paper.standing?.value,1000)
  // A rules-only plan lists no holdings: its close is the paper plan's, its stop its own engine's.
  assert.deepEqual(rules.holdings[0],{security_id:'US:HELD',name:'Held Co',qty:12,avg_cost:55,close:60,value:720,sleeves:[{sleeve:'cw2',stop:48}]})
  assert.equal(rules.judgement,null)
  assert.equal(rules.standing?.value,990)
  assert.equal(run.portfolio!.market?.gate.verdict,'pass')
  assert.equal(run.portfolio!.paperCombined?.value,84000)
  const manager = run.portfolio!.portfolioManager as Record<string, unknown>
  assert.equal(manager.status,'answered')
  assert.deepEqual(manager.journal,{entries:['Fixture journal entry'],open:['Fixture open item']})
  // Trimmed: neither the plan's names not traded nor the Journal the Agent read is sent.
  assert.doesNotMatch(JSON.stringify(run.portfolio),/US:QUARANTINED|Fixture journal read/)
})
test('a run before the plan Steps, or a failed Portfolio Manager, shows no Books rather than empty ones', () => {
  const {id,folder,write} = fixture()
  for (const name of ['plan.json','book-states.json','check.json','paper-books.json']) rmSync(join(folder,name))
  write('portfolio-manager.json',{status:'failed',error:'Both Workers failed'})
  const run = dashboardRun(id,'portfolio')!
  assert.deepEqual(run.portfolio!.books,[])
  assert.equal(run.portfolio!.market,null)
  assert.deepEqual(run.portfolio!.portfolioManager,{status:'failed',error:'Both Workers failed'})
})
test('missing or invalid snapshots stay unavailable without breaking the run', () => {
  const {id,write,folder} = fixture()
  write('lake/status.json','{invalid')
  rmSync(join(folder,'broker-inbox.json'))
  write('todos/lake.json',{invalid:true})
  const run = dashboardRun(id,'portfolio')!
  assert.equal(run.portfolio?.status,null)
  assert.equal(run.portfolio?.broker,null)
  assert.deepEqual(run.portfolio?.todos,[])
  assert.equal(run.status,'succeeded')
})
test('empty portfolio history remains empty instead of showing engineering or demo data', async () => {
  const data = mkdtempSync(join(tmpdir(),'portfolio-dashboard-empty-')); folders.push(data); process.env.AGENTS_DATA_DIR = data
  const snapshot = await dashboardSnapshot('portfolio')
  assert.deepEqual(snapshot.runs,[])
  assert.equal(snapshot.schedules[0].pipeline,'stocks')
})
test('portfolio page, guide, APIs and brief links are served read-only', async () => {
  const {id} = fixture()
  const server = createDashboardServer()
  await new Promise<void>(resolve => server.listen(0,'127.0.0.1',resolve))
  const address = server.address(); assert.ok(address && typeof address !== 'string')
  const base = `http://127.0.0.1:${address.port}`
  try {
    assert.match(await (await fetch(`${base}/portfolio`)).text(),/Portfolio Observatory/)
    assert.match(await (await fetch(`${base}/portfolio-guide.md`)).text(),/Connect the Windows portfolio runs/)
    assert.equal((await (await fetch(`${base}/api/portfolio/dashboard`)).json()).runs.length,1)
    assert.equal((await (await fetch(`${base}/api/dashboard`)).json()).runs.length,0)
    assert.equal((await fetch(`${base}/api/run?id=${id}`)).status,404)
    assert.equal((await (await fetch(`${base}/api/portfolio/run?id=${id}`)).json()).tokenUsage.tokens.totalTokens,1280)
    const brief = await fetch(`${base}/runs/${id}/brief.html`)
    assert.equal(brief.status,200)
    assert.doesNotMatch(brief.headers.get('content-security-policy')!,/allow-scripts/)
    assert.match(await (await fetch(`${base}/runs/${id}/logs/health.log`)).text(),/health answered/)
    assert.equal((await fetch(`${base}/api/portfolio/run?id=${id}`,{method:'POST'})).status,405)
  } finally { await new Promise<void>((resolve,reject) => server.close(error => error ? reject(error) : resolve())) }
})
