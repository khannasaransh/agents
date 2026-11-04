// One-way projections into separate managed Sash lists. Only executed trades reach real portfolios.
// Alarms and existing personal lists are outside this module's write paths.
import { createHash } from 'node:crypto'

export interface SashTrade {
  id: number; date: string; security_id: string | null; name: string | null
  side: string; qty: number; price: number
}
export interface SashBook {
  book: string; name: string; portfolio_id: number | null
  holdings: { security_id: string; name: string | null; qty: number }[]
  transactions: SashTrade[]
}
export interface SashExport { books: SashBook[] }
type Row = Record<string, any>
export type SashRequest = (path: string, method?: string, body?: unknown) => Promise<any>

export function managedId(key: string): string {
  const h = createHash('sha256').update(`agents:sash:v1:${key}`).digest('hex')
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-8${h.slice(13, 16)}-a${h.slice(17, 20)}-${h.slice(20, 32)}`
}

function security(id: string): { symbol: string; exchange: string } {
  const match = /^(IN|US|HK):(.+)$/.exec(id)
  if (!match) throw new Error(`Sash cannot map security ${id}`)
  return { exchange: match[1], symbol: match[2] }
}

export function tradeRow(book: SashBook, tx: SashTrade, portfolio: string): Row | null {
  if (['DEPOSIT', 'WITHDRAW', 'DIV', 'FEE'].includes(tx.side)) return null
  if (!['BUY', 'SELL'].includes(tx.side) || !Number.isSafeInteger(tx.qty) || tx.qty <= 0 || !Number.isFinite(tx.price) || tx.price <= 0 || !tx.security_id) {
    throw new Error(`${book.book}: ledger entry ${tx.id} cannot be represented by Sash's whole-share BUY/SELL ledger (${tx.side})`)
  }
  if (!Number.isSafeInteger(tx.id) || tx.id <= 0 || !/^\d{4}-\d{2}-\d{2}$/.test(tx.date)) throw new Error('Invalid source transaction identity/date')
  return {
    id: managedId(`${portfolio}:transaction:${book.portfolio_id}:${tx.id}`), portfolio_id: portfolio,
    ...security(tx.security_id), company_name: tx.name ?? tx.security_id,
    type: tx.side, price: tx.price, quantity: tx.qty, date: tx.date,
  }
}

/** Fetch all pages: PostgREST's default row limit must never hide stale membership or ledger entries. */
export function sashRequest(config: { url: string; key: string }, fetcher: typeof fetch = fetch): SashRequest {
  return async (path, method = 'GET', body) => {
    const rows: Row[] = []
    for (let offset = 0; ; offset += 500) {
      const page = method === 'GET' ? `${path}${path.includes('?') ? '&' : '?'}limit=500&offset=${offset}` : path
      const response = await fetcher(`${config.url.replace(/\/$/, '')}/rest/v1/${page}`, {
        method, headers: { apikey: config.key, Authorization: `Bearer ${config.key}`, 'Content-Type': 'application/json', Prefer: 'resolution=merge-duplicates,return=representation' },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(30_000),
      })
      if (!response.ok) throw new Error(`Sash ${method} ${path.split('?')[0]} returned HTTP ${response.status}`)
      const text = await response.text()
      const result = text ? JSON.parse(text) : null
      if (method !== 'GET' || !Array.isArray(result)) return result
      rows.push(...result)
      if (result.length < 500) return rows
    }
  }
}

export async function syncSash(snapshot: SashExport, userId: string, request: SashRequest) {
  const results: { book: string; watchlist: string; portfolio: string; holdings: number; transactions: number; omittedCashEntries: number }[] = []
  // Validate every source Book before the first remote mutation.
  const codes = snapshot.books.map(b => b.book).sort()
  if (codes.join(',') !== 'HK,IN,US') throw new Error('Sash export must contain IN, US and HK exactly once')
  const prepared = snapshot.books.map(book => {
    const watchlist = managedId(`${userId}:${book.book}:paper`)
    const portfolio = managedId(`${userId}:${book.book}:real`)
    if (book.transactions.length && book.portfolio_id === null) throw new Error('Ledger has no source portfolio')
    const trades = [...book.transactions].sort((a, b) => a.date.localeCompare(b.date) || a.id - b.id).map(tx => tradeRow(book, tx, portfolio)).filter((t): t is Row => t !== null)
    const holdings = new Map<string, Row>()
    for (const holding of book.holdings) {
      if (!Number.isFinite(holding.qty) || holding.qty < 0) throw new Error('Invalid paper holding quantity')
      if (!holding.qty) continue
      holdings.set(holding.security_id, { id: managedId(`${watchlist}:${holding.security_id}`), watchlist_id: watchlist, ...security(holding.security_id), company_name: holding.name ?? holding.security_id })
    }
    return { book, watchlist, portfolio, trades, holdings: [...holdings.values()] }
  })
  for (const { book, watchlist, portfolio, trades, holdings } of prepared) {
    for (const [table, id, name] of [['watchlists', watchlist, `Agents · ${book.book} · Paper`], ['portfolios', portfolio, `Agents · ${book.book} · Real`]]) {
      const old = await request(`${table}?id=eq.${id}&select=id,user_id,name`)
      if (old.some((row: Row) => row.user_id !== userId || row.name !== name)) throw new Error(`Managed Sash ${table} was changed; review it before syncing`)
      await request(`${table}?on_conflict=id`, 'POST', [{ id, user_id: userId, name, updated_at: new Date().toISOString() }])
    }
    const existing: Row[] = await request(`transactions?portfolio_id=eq.${portfolio}&select=id,portfolio_id,symbol,exchange,company_name,type,price,quantity,date&order=date.asc,id.asc`)
    const expected = new Map(trades.map(row => [row.id, row]))
    for (const row of existing) {
      const wanted = expected.get(row.id)
      if (!wanted || ['portfolio_id', 'symbol', 'exchange', 'type', 'date'].some(k => row[k] !== wanted[k]) || ['price', 'quantity'].some(k => Number(row[k]) !== wanted[k])) {
        throw new Error(`${book.book}: managed Sash ledger differs from ash_new; review before changing transactions`)
      }
    }
    const previous = new Set(existing.map(row => row.id))
    for (const row of trades.filter(row => !previous.has(row.id))) {
      await request('rpc/add_transaction_with_trade_sync', 'POST', Object.fromEntries(Object.entries(row).map(([key, value]) => [`p_${key}`, value])))
    }
    // Rebuild chronologically even after a crash or a backdated broker import.
    const positions = new Map(trades.map(row => [`${row.exchange}:${row.symbol}`, row]))
    for (const row of positions.values()) await request('rpc/rebuild_trades_for_stock', 'POST', { p_portfolio_id: portfolio, p_symbol: row.symbol, p_exchange: row.exchange })
    const members: Row[] = await request(`watchlist_stocks?watchlist_id=eq.${watchlist}&select=id,symbol,exchange&order=id.asc`)
    if (holdings.length) await request('watchlist_stocks?on_conflict=watchlist_id,symbol,exchange', 'POST', holdings)
    const kept = new Set(holdings.map(row => `${row.exchange}:${row.symbol}`))
    for (const old of members.filter(row => !kept.has(`${row.exchange}:${row.symbol}`))) await request(`watchlist_stocks?watchlist_id=eq.${watchlist}&id=eq.${encodeURIComponent(old.id)}`, 'DELETE')
    results.push({ book: book.book, watchlist, portfolio, holdings: holdings.length, transactions: trades.length, omittedCashEntries: book.transactions.length - trades.length })
  }
  return results
}
