import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { agentsRoot } from '../src/paths.ts'

/** Synthetic portfolio data for HTTP/browser checks, never mixed into real run history. */
export function portfolioFixture(data: string) {
  const id = 'portfolio-fixture'
  const folder = join(data,'runs',id)
  const write = (name: string, value: unknown) => {
    const path = join(folder,name)
    mkdirSync(join(path,'..'),{recursive:true})
    writeFileSync(path,typeof value === 'string' ? value : JSON.stringify(value))
  }
  const steps = ['answers','broker-inbox','marketsmith','lake','health','brief']
  write('run.json',{ id,pipeline:'stocks',status:'succeeded',startedAt:'2026-10-29T01:30:00Z',endedAt:'2026-10-29T01:40:00Z',steps:steps.map(name => ({name,status:name === 'marketsmith' ? 'skipped' : 'succeeded',log:`logs/${name}.log`,startedAt:'2026-10-29T01:30:00Z',endedAt:'2026-10-29T01:31:00Z'})) })
  const usage = {inputTokens:1200,outputTokens:80,cacheReadTokens:700,cacheWriteTokens:0,totalTokens:1280,complete:true}
  for (const step of steps) write(`logs/${step}.log`,`${step} fixture log\n`)
  write('logs/health.log',`health answered on claude-code (test-model, medium) in 20s [tokens=${JSON.stringify(usage)}]\n`)
  const status = JSON.parse(readFileSync(join(agentsRoot,'test/pd/status.healthy.json'),'utf8'))
  write('lake/status.json',status)
  write('health/status.json',{...status,checked_at:'2026-10-29T01:39:00Z'})
  write('lake.json',{dryRun:false,cleared:null,refreshed:true,attempts:[{startedAt:'2026-10-29T01:30:00Z',endedAt:'2026-10-29T01:35:00Z',exitCode:0,timedOut:false}]})
  write('health.json',{status:'diagnosed',why:['Fixture health flags'],inputs:'test',diagnosis:'Fixture diagnosis: investigate the recorded data flags.',fix:'Fixture proposed fix; nothing has been applied.',evidence:[{source:'lake/status.json',shows:'Fixture flags'}],corrections:[],proposals:{status:'dry-run'}})
  write('broker-inbox.json',{dryRun:false,files:[],books:{books:[{book:'IN',name:'India fixture book',broker:'icici_direct',broker_name:'ICICI Direct',currency:'INR',portfolio_id:1,as_of:'2026-10-28',value:100000,cash:25000,holdings:[{security_id:'IN:FIXTURE',name:'Fixture holding <test>',qty:100,avg_cost:700,price:750,priced_on:'2026-10-28',value:75000}],reconciliation:{as_of:'2026-10-28',matched:0,file:'fixture.csv',reconciled_at:'2026-10-29T01:30:00Z',differences:[{kind:'quantity',security_id:'IN:FIXTURE',isin:null,symbol:null,name:null,ledger_qty:100,broker_qty:110,ratio:null}]}},{book:'US',name:'United States fixture book',broker:'moomoo',broker_name:'moomoo',currency:'USD',portfolio_id:2,as_of:'2026-10-28',value:0,cash:0,holdings:[],reconciliation:null},{book:'HK',name:'Hong Kong fixture book',broker:'moomoo',broker_name:'moomoo',currency:'HKD',portfolio_id:null,as_of:null,value:0,cash:0,holdings:[],reconciliation:null}]}})
  write('todos/lake.json',['Fixture task: review the data flags.'])
  write('answers.json',{dryRun:false,files:[]})
  write('brief.html','<!doctype html><title>Portfolio fixture brief</title><h1>Portfolio fixture brief</h1><p>Fixture only</p><a href="logs/health.log">Health log</a>')
  return {id,folder,write}
}
