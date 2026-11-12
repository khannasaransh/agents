import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { createContext, runInContext } from 'node:vm'

/** Rendering tests use a minimal document, without launching a server or loading real run data. */
function page(portfolio = false) {
  const elements = new Map<string, {innerHTML: string; textContent: string; hidden: boolean}>()
  const element = (selector: string) => {
    if (!elements.has(selector)) elements.set(selector,{innerHTML:'',textContent:'',hidden:false})
    return Object.assign(elements.get(selector)!,{addEventListener() {}})
  }
  const context = createContext({
    document: {body:{dataset:{view:portfolio ? 'portfolio' : ''}},querySelector:element,querySelectorAll:() => [],addEventListener() {}},
    location:{search:'?run=fixture'}, URLSearchParams,
    fetch:() => new Promise(() => {}), setInterval() {},
  })
  if (portfolio) runInContext(readFileSync(new URL('../dashboard/portfolio.js',import.meta.url),'utf8'),context)
  runInContext(readFileSync(new URL('../dashboard/dashboard.js',import.meta.url),'utf8'),context)
  const evaluate = (script: string) => runInContext(script,context)
  evaluate(`run = {id:'fixture',pipeline:'${portfolio ? 'stocks' : 'daily'}',status:'failed',steps:[],files:[],reviews:[],fetches:[],tokenUsage:{agents:[]}}; snapshot = {backlog:{},scheduleLog:''}`)
  return {evaluate,element}
}

test('HTML artifacts retain their own path and sandbox instead of opening the main brief', async () => {
  const {evaluate,element} = page()
  await evaluate(`tab = 'artifacts'; showArtifact('reports/extra.html')`)
  assert.equal(evaluate('tab'),'artifacts')
  assert.match(element('#artifact-preview').innerHTML,/src="\/runs\/fixture\/reports\/extra.html"/)
  assert.match(element('#artifact-preview').innerHTML,/sandbox="allow-popups"/)
})

test('a failed correction write does not hide a successful Health diagnosis', () => {
  const {evaluate} = page(true)
  evaluate(`run.steps = [{name:'health',status:'failed'}]; run.portfolio = {health:{status:'diagnosed',diagnosis:'Diagnosis retained',fix:'Fix retained',evidence:[],proposals:{status:'failed',error:'Write failed'}}}`)
  const html = evaluate('portfolioDiagnosis()')
  assert.match(html,/Diagnosis retained/)
  assert.match(html,/Write failed/)
  assert.doesNotMatch(html,/Health agent failed/)
  evaluate(`run.steps = []; run.portfolio = {health:{status:'failed'}}`)
  assert.match(evaluate('portfolioDiagnosis()'),/No diagnosis recorded/)
})

test('untrusted step names render as text and malformed optional arrays do not crash views', () => {
  const {evaluate,element} = page()
  evaluate(`run.steps = [{name:'<img src=x>',status:'failed',attempts:[]}]; run.pm = {highlights:{invalid:true}}; run.reviews = [{findings:{invalid:true}},{findings:[null]}]; snapshot.backlog.daily = 'invalid'; overview()`)
  const html = element('#content').innerHTML
  assert.doesNotMatch(html,/<img/i)
  assert.match(html,/&lt;img src=x&gt;/i)
  assert.match(html,/Review findings \(0\)/)
})

const book = (kind: string, extra = '') => `{book:'US',kind:'${kind}',name:'US ${kind} <b>',currency:'USD',as_of:'2026-10-28',value:1000,cash:400,plan:{status:'planned',why:null,mode:'normal',for_placing:false,session:'2026-10-29',exposure:{condition:'under_pressure',level:1}},holdings:[],orders:[],stops:[],list:null,judgement:null,standing:null,gap:null${extra}}`

test("the Orders tab shows each Book's orders and whether its list was recorded, as text", () => {
  const {evaluate} = page(true)
  evaluate(`run.portfolio = {market:{on:'2026-10-29',gate:{verdict:'pass',reasons:[]},mode:'normal',markets:[]},books:[
    ${book('real',`,orders:[{id:'US-1',sleeve:'gold',security_id:'US:GLD',name:'Gold',side:'BUY',shares:28,price:365,value:10220,limit:376,reason:'first_allocation',cuts:[],role:'entry'}],list:{status:'not_recorded',why:'It starts once a strategy is Real-small',orders:1,superseded:0}`)},
    ${book('paper',`,orders:[{id:'US-paper-1',sleeve:'cw2',security_id:'US:GTLB',name:'<img src=x>',side:'SELL',shares:115,price:47.32,value:5441.8,limit:null,reason:'deferred',cuts:[],role:'exit'}],list:{status:'recorded',why:null,orders:1,superseded:0}`)},
    ${book('rules_only')}]}`)
  const html = evaluate('portfolioOrders()')
  assert.match(html,/Normal mode/)
  assert.match(html,/US:GTLB/)
  assert.match(html,/SELL/)
  assert.match(html,/Not for placing: there is no Order list/)
  assert.match(html,/Real-small/)
  assert.match(html,/US rules_only &lt;b&gt;/)
  assert.doesNotMatch(html,/<img|<b>/)
})

test("the Portfolio Manager tab shows each Book's commentary, changes and Journal, or why there's none", () => {
  const {evaluate} = page(true)
  const decision = `{rule_plan:'Buy 10',instead:'Wait 2 sessions',lever:'timing',playbook:'timing_sessions: 5',figures:[],expected:'Cheaper fill',judged_on:'2026-11-02',views:[]}`
  evaluate(`run.portfolio = {books:[${book('paper',`,judgement:{book:'US',plan_id:'p',exposure:{level:1,decision:${decision}},changes:[{kind:'wait',order:'US-paper-1',security_id:null,shares:null,multiple:null,decision:${decision}}],commentary:'Kept the level <script>'}`)}],
    portfolioManager:{status:'answered',error:null,review:null,monthly:null,promotions:[],narrower:[],expectations:[],lessons:[{lesson:'Wait on gaps',why:'Two fills lost',book:null,lever:null}],journal:{entries:['Entry one'],open:['Open one']}}}`)
  const html = evaluate('portfolioManager()')
  assert.match(html,/Kept the level &lt;script&gt;/)
  assert.match(html,/Wait 2 sessions/)
  assert.match(html,/Wait on gaps/)
  assert.match(html,/Entry one/)
  assert.match(html,/Open one/)
  evaluate(`run.portfolio = {books:[],portfolioManager:{status:'failed',error:'Both Workers failed'}}`)
  assert.match(evaluate('portfolioManager()'),/Portfolio Manager failed[\s\S]*Both Workers failed/)
  evaluate(`run.portfolio = {books:[],portfolioManager:null}`)
  assert.match(evaluate('portfolioManager()'),/No Portfolio Manager answer/)
})

test('a paper Book is valued beside its rules-only Book, and a real Book with no portfolio shows its capital', () => {
  const {evaluate} = page(true)
  evaluate(`run.portfolio = {broker:{books:{books:[]}},books:[${book('real')},${book('paper',`,gap:{value:52,share:0.0005},standing:{nav:97.7,drawdown:-0.0229},holdings:[{security_id:'US:HELD',name:'Held',qty:10,avg_cost:5,close:6,value:60,sleeves:[{sleeve:'cw2',stop:4.5}]}]`)},${book('rules_only',`,value:990`)}]}`)
  const cards = evaluate('portfolioPaperCards()')
  assert.match(cards,/USD 1,000.00/)
  assert.match(cards,/USD 990.00/)
  assert.match(cards,/USD 52.00 \(0.05%\)/)
  assert.match(cards,/-2.29%/)
  assert.match(evaluate('portfolioPaperHoldings()'),/Stop USD 4.50/)
  assert.match(evaluate('portfolioBookCards()'),/Its capital, USD 400.00, is all in cash/)
})

test('portfolio snapshots preserve zero balances, missing books and the latest dated status', () => {
  const {evaluate} = page(true)
  evaluate(`run.portfolio = {status:{checked_at:'invalid'},healthStatus:{checked_at:'2026-10-29T00:00:00Z'},broker:{books:{books:[null,{book:'US',portfolio_id:2,currency:'USD',cash:0,value:0,holdings:[]}]}}}`)
  assert.equal(evaluate('portfolioStatus().checked_at'),'2026-10-29T00:00:00Z')
  const html = evaluate('portfolioBookCards()')
  assert.match(html,/USD 0.00/)
  assert.match(html,/Awaiting a recorded portfolio/)
  assert.doesNotMatch(html,/INR 0.00|HKD 0.00/)
})
