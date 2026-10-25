import assert from 'node:assert/strict'
import { test } from 'node:test'
import { nodeRefusal } from '../src/node-version.ts'

test('a Node older than package.json asks for is refused, naming the version needed and the one running', () => {
  assert.equal(nodeRefusal('25.9.0', '>=26'), 'agents needs Node 26 or later; this is Node 25.9.0')
  assert.equal(nodeRefusal('26.1.9', '>=26.2'), 'agents needs Node 26.2 or later; this is Node 26.1.9')
})

test('the Node package.json asks for, or a newer one, runs the repo', () => {
  assert.equal(nodeRefusal('26.0.0', '>=26'), null)
  assert.equal(nodeRefusal('27.0.0', '>=26'), null)
  assert.equal(nodeRefusal('26.2.0', '>=26.2'), null)
})
