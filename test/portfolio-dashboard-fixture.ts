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
  const decision = (instead: string) => ({rule_plan:'Exposure level 1',instead,lever:'exposure',playbook:'exposure_floor.uptrend: 0.8',figures:[],expected:'Fixture expectation',judged_on:'2026-10-30',views:[]})
  const plan = (kind: string, extra: Record<string, unknown>) => ({id:`plan-${kind}`,book:'US',name:`US fixture ${kind}`,kind,for_placing:kind === 'real',state_id:`state-${kind}`,mandate_version:'m',playbook_version:'p',mode:'normal',status:'planned',why:null,exposure:{condition:'uptrend',level:1},market:'US',currency:'USD',as_of:'2026-10-28',session:'2026-10-29',value:1000,cash:400,orders:[],stops:[],...extra})
  const sale = {id:'US-paper-2026-10-29-001',book:'US',sleeve:'cw2',security_id:'US:SELL',name:'Sold <Co>',side:'SELL',shares:5,price:20,value:100,limit:null,reason:'target',signal:null,cuts:[],role:'exit'}
  write('plan.json',{on:'2026-10-29',gate:{verdict:'pass',reasons:[]},mode:'normal',markets:[{market:'US',book:'US',book_name:'US fixture',status:'read',why:null,reading:{date:'2026-10-28',condition:'uptrend',index:'^GSPC',close:7000,short_average:6900,long_average:6500,breadth:0.6,breadth_of:'SP500',distribution_days:2},exposure_level:1,levels:{uptrend:1,under_pressure:1,correction:1},marketsmith:null}],review:{names:[],risk:[],analysts:[],holdings:[]},plans:[
    plan('real',{orders:[{...sale,id:'US-2026-10-29-001',sleeve:'gold',security_id:'US:GLD',name:'Gold',side:'BUY',limit:21,reason:'first_allocation',role:'entry'}],not_traded:[{security_id:'US:QUARANTINED',name:null,why:'quarantined'}]}),
    plan('paper',{orders:[sale],holdings:[{sleeve:'cw2',security_id:'US:HELD',name:'Held Co',shares:10,close:60,sector:null,rs_rating:90,value:600,stop:50,sellable:true}]}),
    plan('rules_only',{orders:[{...sale,id:'US-rules-2026-10-29-001'}]}),
  ]})
  const state = (kind: string, extra: Record<string, unknown>) => ({id:`state-${kind}`,book:'US',name:`US fixture ${kind}`,paper:kind !== 'real',...(kind === 'real' ? {} : {rules_only:kind === 'rules_only'}),market:'US',currency:'USD',portfolio_id:null,ledger:{transactions:0,last:null},capital:1000,capital_set:true,cash:400,holdings:[],reconciliation:null,unsettled:[],open_orders:[],reserved:0,stops:[],engine:null,...extra})
  const held = {security_id:'US:HELD',name:'Held Co',qty:10,avg_cost:55,legacy:false,kept:false,lots:[],legacy_id:null,answer:null}
  write('book-states.json',{states:[
    state('real',{cash:1000}),
    state('paper',{as_of:'2026-10-28',holdings:[held],engine:{sleeves:{cw2:{holdings:{'US:HELD':{qty:10}}}},stops:{cw2:{'US:HELD':50}}}}),
    state('rules_only',{as_of:'2026-10-28',holdings:[{...held,qty:12}],engine:{sleeves:{cw2:{holdings:{'US:HELD':{qty:12}}}},stops:{cw2:{'US:HELD':48}}}}),
  ]})
  const listed = (kind: string, status: string, why: string | null) => ({book:'US',kind,name:`US fixture ${kind}`,plan_id:`plan-${kind}`,list_id:`plan-${kind}`,session:'2026-10-29',orders:1,superseded:0,judgement:null,status,why})
  write('check.json',{check:{on:'2026-10-29',run:id,dry_run:false,lists:[listed('real','not_recorded','It starts once a strategy is Real-small or Real-full'),listed('paper','recorded',null),listed('rules_only','recorded',null)]},why:null})
  const standing = (value: number) => ({started_on:'2026-10-20',as_of:'2026-10-28',value,cash:400,invested:1000,nav:value / 10,peak:100,drawdown:-0.01,buying:true,halved:false,lists_waiting:[],orders_waiting:1})
  write('paper-books.json',{books:[{book:'US',name:'US fixture',market:'US',currency:'USD',paper:standing(1000),rules_only:standing(990),gap:{value:10,share:0.01},breakers:{no_new_buys_at:null,halve_exposure_at:-0.18},sleeves:[],gold:null,risk_per_trade:0.01,stops_at_risk:[]}],combined:{currency:'INR',value:84000,rates:{USD:84},missing:['IN','HK']}})
  write('portfolio-manager.json',{status:'answered',journalRead:'Fixture journal read',inputs:[],answer:{review:null,monthly:null,promotions:[],narrower:[],expectations:[],lessons:[],journal:{entries:['Fixture journal entry'],open:['Fixture open item']},books:[
    {book:'US',plan_id:'plan-real',state_id:'state-real',mandate_version:'m',playbook_version:'p',exposure:{level:1,decision:decision('The same')},changes:[],commentary:'Fixture real commentary'},
    {book:'US',plan_id:'plan-paper',state_id:'state-paper',mandate_version:'m',playbook_version:'p',exposure:{level:1,decision:decision('The same')},changes:[{kind:'wait',order:'US-paper-2026-10-29-001',security_id:null,sleeve:null,shares:null,multiple:null,sessions:2,wait:null,decision:decision('Wait two sessions')}],commentary:'Fixture paper commentary'},
  ]}})
  write('answers.json',{dryRun:false,files:[]})
  write('brief.html','<!doctype html><title>Portfolio fixture brief</title><h1>Portfolio fixture brief</h1><p>Fixture only</p><a href="logs/health.log">Health log</a>')
  return {id,folder,write}
}
