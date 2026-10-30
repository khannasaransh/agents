import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { get } from 'node:http'
import { join } from 'node:path'
import { afterEach, test } from 'node:test'
import { agentAttempts, containedFile, createDashboardServer, dashboardRun, dashboardSnapshot } from '../src/dashboard.ts'

const folders: string[] = []
const original = process.env.AGENTS_DATA_DIR
afterEach(() => {
  if (original === undefined) delete process.env.AGENTS_DATA_DIR
  else process.env.AGENTS_DATA_DIR = original
  for (const folder of folders.splice(0)) rmSync(folder, { recursive: true, force: true })
})
function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'agents-dashboard-')); folders.push(root)
  const data = join(root, 'data'); process.env.AGENTS_DATA_DIR = data
  const folder = join(data, 'runs', '2026-10-29-0530'); mkdirSync(join(folder, 'logs'), { recursive: true })
  writeFileSync(join(folder, 'run.json'), JSON.stringify({ id:'2026-10-29-0530', pipeline:'daily', status:'succeeded', startedAt:'2026-10-28T21:30:00Z', endedAt:'2026-10-28T21:31:00Z', steps:[{name:'pm',status:'succeeded',log:'logs/pm.log'}] }))
  writeFileSync(join(folder, 'logs/pm.log'), 'pm failed on codex (gpt-test, high) after 2s: quota; retrying once on claude-code (opus, medium)\npm answered on claude-code (opus, medium) in 20s\n')
  writeFileSync(join(folder, 'brief.html'), '<h1>Brief</h1>')
  return {root,data,folder}
}
test('attempts retain actual workers, targets and failed fallback attempts', () => {
  const attempts = agentAttempts('repo-one: reviewer failed on codex (model, high) after 5s: quota\nrepo-one: reviewer answered on claude-code (opus, medium) in 8s\nrepo-one: already reviewed in this Run, skipping', 'review')
  assert.equal(attempts.length,2)
  assert.equal(attempts[0].target,'repo-one')
  assert.equal(attempts[0].outcome,'failed')
  assert.equal(attempts[1].worker,'claude-code')
  assert.equal(attempts[1].seconds,8)
})
test('snapshot handles corrupt records and keeps completed run data without inventing attempts', async () => {
  const {data,folder} = fixture()
  mkdirSync(join(data,'runs','broken')); writeFileSync(join(data,'runs','broken','run.json'),'{')
  const snapshot = await dashboardSnapshot()
  assert.equal(snapshot.runs.length,1)
  assert.equal(snapshot.warnings.length,1)
  const run = dashboardRun('2026-10-29-0530')!
  assert.equal(run.steps[0].attempts.length,2)
  assert.equal(run.pm,null)
  assert.equal(run.tokenUsage.tokens,null)
  assert.equal(run.tokenUsage.agents[0].agent,'pm')
  assert.equal(run.tokenUsage.agents[0].recordedAttempts,0)
  assert.ok(run.files.some(file => file.path === 'brief.html'))
  writeFileSync(join(folder,'logs/pm.log'),'PM already answered in this Run, skipping\n')
  assert.equal(dashboardRun(run.id)!.steps[0].attempts.length,0)
})
test('file resolution blocks traversal and symlink escapes', () => {
  const {root,data} = fixture()
  writeFileSync(join(root,'private.txt'),'private')
  assert.throws(() => containedFile(data,'../private.txt'))
  symlinkSync(join(root,'private.txt'),join(data,'leak.log'))
  assert.throws(() => containedFile(data,'leak.log'))
})

test('malformed run shapes are skipped with warnings instead of breaking history', async () => {
  const {data} = fixture()
  const malformed = [
    {steps:[null],startedAt:'2026-10-29T00:00:00Z'},
    {steps:[]},
    {steps:[],startedAt:42},
    {steps:[],startedAt:'not a date'},
    {steps:[{name:'pm',log:'logs/pm.log',status:'succeeded',endedAt:'invalid'}],startedAt:'2026-10-29T00:00:00Z'},
  ]
  for (const [index,record] of malformed.entries()) {
    const id = `bad-${index}`
    mkdirSync(join(data,'runs',id))
    writeFileSync(join(data,'runs',id,'run.json'),JSON.stringify({id,pipeline:'daily',status:'failed',...record}))
    assert.equal(dashboardRun(id),null)
  }
  const snapshot = await dashboardSnapshot()
  assert.equal(snapshot.runs.length,1)
  assert.equal(snapshot.warnings.length,malformed.length)
})

test('a run folder outside the data area cannot expose outputs through a linked run record', () => {
  const {root,data} = fixture()
  const outside = join(root,'outside'); mkdirSync(outside)
  const record = join(data,'runs','linked-record.json')
  writeFileSync(record,JSON.stringify({id:'escape',pipeline:'daily',status:'succeeded',startedAt:'2026-10-29T00:00:00Z',steps:[]}))
  writeFileSync(join(outside,'pm.json'),'{"highlights":["private"]}')
  symlinkSync(record,join(outside,'run.json'))
  symlinkSync(outside,join(data,'runs','escape'))
  assert.equal(dashboardRun('escape'),null)
})
test('HTTP serves real data read-only, sandboxes briefs and rejects escapes and remote hosts', async () => {
  const {root,data,folder} = fixture()
  writeFileSync(join(root,'secret.json'),'{"secret":true}')
  symlinkSync(join(root,'secret.json'),join(folder,'leak.json'))
  const server = createDashboardServer()
  await new Promise<void>(resolve => server.listen(0,'127.0.0.1',resolve))
  const address = server.address(); assert.ok(address && typeof address !== 'string')
  const base = `http://127.0.0.1:${address.port}`
  try {
    const home = await fetch(base); assert.equal(home.status,200); assert.match(await home.text(),/Pipeline Observatory/)
    const response = await fetch(`${base}/api/dashboard`); assert.equal((await response.json()).runs.length,1)
    const brief = await fetch(`${base}/api/file?run=2026-10-29-0530&path=brief.html`)
    assert.match(brief.headers.get('content-security-policy')!,/sandbox/)
    assert.equal((await fetch(`${base}/runs/2026-10-29-0530/brief.html`)).status,200)
    assert.match(await (await fetch(`${base}/runs/2026-10-29-0530/logs/pm.log`)).text(),/pm answered/)
    assert.equal((await fetch(`${base}/runs/2026-10-29-0530/leak.json`)).status,404)
    for (const path of ['leak.json','../../../secret.json']) assert.equal((await fetch(`${base}/api/file?run=2026-10-29-0530&path=${encodeURIComponent(path)}`)).status,404)
    assert.equal((await fetch(`${base}/api/dashboard`,{method:'POST'})).status,405)
    const remoteStatus = await new Promise<number | undefined>((resolve,reject) => {
      get(`${base}/api/dashboard`,{headers:{host:'evil.example'}}, response => { response.resume(); resolve(response.statusCode) }).on('error',reject)
    })
    assert.equal(remoteStatus,403)
    assert.equal((await fetch(`${base}/.env`)).status,404)
    const log = join(folder,'logs/pm.log'); writeFileSync(log,'x'.repeat(1024*1024+10))
    assert.match(await (await fetch(`${base}/api/file?run=2026-10-29-0530&path=logs/pm.log`)).text(),/^\[Showing the last 1 MiB/)
    assert.equal(process.env.AGENTS_DATA_DIR,data)
  } finally { await new Promise<void>((resolve,reject) => server.close(error => error ? reject(error) : resolve())) }
})


test('dashboard aggregates token usage per agent and preserves missing-attempt coverage', () => {
  const {folder} = fixture()
  const tokens = {inputTokens:100,outputTokens:20,cacheReadTokens:50,cacheWriteTokens:0,totalTokens:120,complete:true}
  writeFileSync(join(folder,'logs/pm.log'), [
    `pm failed on codex (model, high) after 1s: invalid answer [tokens=${JSON.stringify(tokens)}]`,
    `pm answered on claude-code (opus, medium) in 2s [tokens=${JSON.stringify(tokens)}]`,
    'repo-a: reviewer answered on codex (model, high) in 3s',
  ].join('\n'))
  const usage = dashboardRun('2026-10-29-0530')!.tokenUsage
  assert.equal(usage.tokens?.totalTokens,240)
  assert.equal(usage.complete,false)
  assert.equal(usage.agents.find(agent => agent.agent === 'pm')?.tokens?.totalTokens,240)
  assert.equal(usage.agents.find(agent => agent.agent === 'pm')?.complete,true)
  assert.equal(usage.agents.find(agent => agent.agent === 'reviewer')?.tokens,null)
})
