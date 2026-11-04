import assert from 'node:assert/strict'
import { test } from 'node:test'
import { managedId, sashRequest, syncSash, type SashExport, type SashRequest } from '../src/sash.ts'

const user = '00000000-0000-0000-0000-000000000000'
const snapshot = (): SashExport => ({ books: ['IN', 'US', 'HK'].map(book => ({ book, name: book, portfolio_id: 1, holdings: [], transactions: [] })) })

test('managed lists preserve regional symbols, deduplicate sleeves and send only executed trades through the atomic RPC', async () => {
  const input = snapshot()
  input.books[2].holdings = [{ security_id: 'HK:00700', name: 'Tencent', qty: 3 }, { security_id: 'HK:00700', name: 'Tencent', qty: 2 }, { security_id: 'US:BIL', name: 'BIL', qty: 1 }]
  input.books[0].transactions = [{ id: 1, date: '2026-10-29', security_id: 'IN:ABC', name: 'ABC', side: 'BUY', qty: 2, price: 10 }, { id: 2, date: '2026-10-29', security_id: null, name: null, side: 'DEPOSIT', qty: 100, price: 1 }]
  const calls: { path: string; method: string; body: any }[] = []
  const request: SashRequest = async (path, method = 'GET', body) => { calls.push({ path, method, body }); return [] }
  const result = await syncSash(input, user, request)
  const trade = calls.find(call => call.path === 'rpc/add_transaction_with_trade_sync')!.body
  assert.equal(trade.p_quantity, 2)
  assert.equal(trade.p_type, 'BUY')
  assert.equal(trade.p_id, managedId(`${managedId(`${user}:IN:real`)}:transaction:1:1`))
  const members = calls.find(call => call.path.startsWith('watchlist_stocks?on_conflict'))!.body
  assert.deepEqual(members.map((row: any) => [row.exchange, row.symbol]), [['HK', '00700'], ['US', 'BIL']])
  assert.equal(result[0].omittedCashEntries, 1)
  assert.ok(calls.every(call => !/alerts|alarm/.test(call.path)))
})

test('fractional trades and unsupported corporate actions fail before any write, rather than silently altering real holdings', async () => {
  for (const [side, qty] of [['BUY', 1.5], ['SPLIT', 2]] as const) {
    const input = snapshot()
    input.books[0].transactions = [{ id: 1, date: '2026-10-29', security_id: 'IN:ABC', name: null, side, qty, price: 10 }]
    let called = false
    await assert.rejects(syncSash(input, user, async () => { called = true; return [] }), /cannot be represented/)
    assert.equal(called, false)
  }
})

test('a managed header with another owner or name stops synchronization without overwriting it', async () => {
  const methods: string[] = []
  await assert.rejects(syncSash(snapshot(), user, async (_path, method = 'GET') => {
    methods.push(method)
    return [{ user_id: user, name: 'My personal list' }]
  }), /was changed/)
  assert.deepEqual(methods, ['GET'])
})

test('an unchanged ledger is not inserted again, but its trades are rebuilt after a possible interrupted run', async () => {
  const input = snapshot()
  input.books[0].transactions = [{ id: 1, date: '2026-10-29', security_id: 'IN:ABC', name: 'ABC', side: 'BUY', qty: 2, price: 10 }]
  const portfolio = managedId(`${user}:IN:real`)
  const paths: string[] = []
  await syncSash(input, user, async path => {
    paths.push(path)
    if (path.startsWith(`transactions?portfolio_id=eq.${portfolio}`)) return [{ id: managedId(`${portfolio}:transaction:1:1`), portfolio_id: portfolio, symbol: 'ABC', exchange: 'IN', type: 'BUY', price: '10', quantity: 2, date: '2026-10-29' }]
    return []
  })
  assert.ok(!paths.includes('rpc/add_transaction_with_trade_sync'))
  assert.ok(paths.includes('rpc/rebuild_trades_for_stock'))
})

test('remote ledger divergence is reported before new transactions are written', async () => {
  const paths: string[] = []
  await assert.rejects(syncSash(snapshot(), user, async path => {
    paths.push(path)
    return path.startsWith('transactions?') ? [{ id: 'unexpected' }] : []
  }), /ledger differs/)
  assert.ok(!paths.some(path => path.startsWith('rpc/')))
})

test('REST reads paginate and errors never reveal the service credential or response body', async () => {
  const urls: string[] = []
  const fake = (async (url: string | URL | Request) => {
    urls.push(String(url))
    return new Response(JSON.stringify(urls.length === 1 ? Array(500).fill({ id: 1 }) : [{ id: 2 }]))
  }) as typeof fetch
  const rows = await sashRequest({ url: 'https://example.com', key: 'SECRET' }, fake)('transactions?select=id')
  assert.equal(rows.length, 501)
  assert.match(urls[1], /offset=500/)
  const denied = (async () => new Response('SECRET', { status: 403 })) as typeof fetch
  await assert.rejects(sashRequest({ url: 'https://example.com', key: 'SECRET' }, denied)('portfolios'), error => String(error).includes('403') && !String(error).includes('SECRET'))
})
