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

test('portfolio snapshots preserve zero balances, missing books and the latest dated status', () => {
  const {evaluate} = page(true)
  evaluate(`run.portfolio = {status:{checked_at:'invalid'},healthStatus:{checked_at:'2026-10-29T00:00:00Z'},broker:{books:{books:[null,{book:'US',portfolio_id:2,currency:'USD',cash:0,value:0,holdings:[]}]}}}`)
  assert.equal(evaluate('portfolioStatus().checked_at'),'2026-10-29T00:00:00Z')
  const html = evaluate('portfolioBookCards()')
  assert.match(html,/USD 0.00/)
  assert.match(html,/Awaiting a recorded portfolio/)
  assert.doesNotMatch(html,/INR 0.00|HKD 0.00/)
})
