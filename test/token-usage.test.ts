import assert from 'node:assert/strict'
import { test } from 'node:test'
import { readTokenUsage, summarizeTokenUsage, workerTokenUsage } from '../src/token-usage.ts'
import { agentAttempts } from '../src/dashboard.ts'

const codex = (usage: unknown) => JSON.stringify({ type:'turn.completed', usage })
const usage = { input_tokens:1000, output_tokens:120, cached_input_tokens:700, cache_write_input_tokens:100 }

test('Codex uses final cumulative usage and never adds cached or reasoning tokens twice', () => {
  const stdout = `${codex({ ...usage,input_tokens:800 })}\n${codex({ ...usage,reasoning_output_tokens:80 })}\n`
  assert.deepEqual(workerTokenUsage('codex',stdout), {inputTokens:1000,outputTokens:120,cacheReadTokens:700,cacheWriteTokens:100,totalTokens:1120,complete:true})
  assert.equal(workerTokenUsage('codex',stdout,true)?.complete,false)
  assert.equal(workerTokenUsage('codex',`${stdout}{"type":"turn.started"}\n{"type":"turn.failed"}`)?.complete,false)
})

test('Claude includes read/write cache tokens exactly once and retains error-result usage', () => {
  const result = JSON.stringify({subtype:'error_max_turns',is_error:true,usage:{input_tokens:100,output_tokens:40,cache_read_input_tokens:500,cache_creation_input_tokens:200}})
  assert.deepEqual(workerTokenUsage('claude-code',result), {inputTokens:800,outputTokens:40,cacheReadTokens:500,cacheWriteTokens:200,totalTokens:840,complete:true})
})

test('Claude model totals include nested model work without adding top-level usage again', () => {
  const result = JSON.stringify({ usage:{input_tokens:9999,output_tokens:9999}, modelUsage:{
    opus:{inputTokens:100,outputTokens:30,cacheReadInputTokens:200,cacheCreationInputTokens:50},
    haiku:{inputTokens:20,outputTokens:5,cacheReadInputTokens:10,cacheCreationInputTokens:0},
  }})
  assert.deepEqual(workerTokenUsage('claude-code',result), {inputTokens:380,outputTokens:35,cacheReadTokens:210,cacheWriteTokens:50,totalTokens:415,complete:true})
})

test('missing, malformed, negative and incomplete counters do not turn into zero', () => {
  for (const stdout of ['', '{', codex({}), codex({...usage,input_tokens:-1}), codex({...usage,output_tokens:'120'}), codex({...usage,cached_input_tokens:1001})]) assert.equal(workerTokenUsage('codex',stdout),null)
  assert.equal(workerTokenUsage('claude-code','{"usage":{}}'),null)
  assert.equal(workerTokenUsage('claude-code','{"modelUsage":{"opus":{}},"usage":{"input_tokens":1,"output_tokens":1}}'),null)
  const zero = workerTokenUsage('codex',codex({input_tokens:0,output_tokens:0,cached_input_tokens:0}))!
  assert.equal(zero.totalTokens,0)
  assert.equal(zero.cacheWriteTokens,null)
  assert.deepEqual(readTokenUsage(zero),zero)
  assert.equal(readTokenUsage({...zero,totalTokens:500}),null)
})

test('per-attempt metadata stays attached to the correct repository and fallback', () => {
  const tokens = workerTokenUsage('codex',codex(usage))!
  const attempts = agentAttempts([
    `repo-a: reviewer failed on codex (model, high) after 3s: invalid output; retrying once on claude-code (opus, high) [tokens=${JSON.stringify(tokens)}]`,
    'repo-b: reviewer answered on codex (model, high) in 9s',
    `repo-a: reviewer answered on claude-code (opus, high) in 4s [tokens=${JSON.stringify({...tokens,totalTokens:1120})}]`,
    'pm answered on claude-code (opus, medium) in 10s [tokens={"invalid":true}]',
  ].join('\n'),'review')
  assert.equal(attempts.length,4)
  assert.equal(attempts[0].target,'repo-a')
  assert.equal(attempts[0].usage?.totalTokens,1120)
  assert.equal(attempts[1].usage,null)
  assert.equal(attempts[2].worker,'claude-code')
  assert.equal(attempts[3].usage,null)
  const summary = summarizeTokenUsage(attempts)
  assert.equal(summary.tokens?.totalTokens,2240)
  assert.equal(summary.recordedAttempts,2)
  assert.equal(summary.complete,false)
  assert.equal(summarizeTokenUsage(attempts.slice(0,1)).complete,true)
  assert.equal(summarizeTokenUsage([{usage:{...tokens,complete:false}}]).complete,false)
  assert.equal(summarizeTokenUsage([{usage:null}]).tokens,null)
  assert.equal(summarizeTokenUsage([]).tokens,null)
})
