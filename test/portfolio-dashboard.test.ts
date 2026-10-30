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
