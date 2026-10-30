// Real Books' orders (issue 42), as the Broker inbox Step raises To-dos about them and the Stocks Brief
// shows them: each order proposed until Saransh marks it placed or skipped, and placed until a
// tradebook shows it filled, partly filled or not; each order valid only for its own session.
import { bookName, brokerFiles, brokerName, shares } from './brokers.ts'
import type { PdOrder, PdOrders, PdTrade } from './pd.ts'

/** What each state of an order says in the Brief. */
export const stateNames: Record<PdOrder['state'], string> = {
  proposed: 'to place',
  placed: 'placed',
  skipped: 'skipped',
  filled: 'filled',
  partly_filled: 'partly filled',
  expired: 'expired',
}

/** Why an order expired, in a few words. */
const expiredWhy: Record<string, string> = {
  not_placed: 'not marked placed by the end of its session',
  not_filled: 'the tradebook shows no fill',
}

/** What an order is, without its price: "Buy 2415 Stove Kraft Ltd", "Sell 300 IN:RATEGAIN". */
export const orderWhat = (o: Pick<PdOrder, 'side' | 'shares' | 'name' | 'security_id'>) =>
  `${o.side === 'BUY' ? 'Buy' : 'Sell'} ${shares(o.shares)} ${o.name ?? o.security_id}`

/** Where an order stands, in a sentence: "filled 50 at 472.75", "expired: not marked placed by the end of its session". */
export function stateText(o: PdOrder, price: (n: number) => string = String): string {
  if (o.state === 'filled') return `filled ${shares(o.filled)}${o.fill_price === null ? '' : ` at ${price(o.fill_price)}`}`
  if (o.state === 'partly_filled') return `partly filled: ${shares(o.filled)} of ${shares(o.shares)}${o.fill_price === null ? '' : ` at ${price(o.fill_price)}`}, the rest expired`
  if (o.state === 'expired') return `expired: ${expiredWhy[o.why ?? ''] ?? o.why ?? 'its session is over'}`
  if (o.state === 'placed' && o.session_over) return 'placed: waiting for the tradebook of its session'
  return stateNames[o.state]
}

/** The placed orders whose sessions are over and that no tradebook has shown yet, by Book. */
export function waitingForTradebooks(orders: PdOrders | null) {
  return (orders?.books ?? []).map((b) => ({ book: b, orders: b.orders.filter((o) => o.state === 'placed' && o.session_over) })).filter((b) => b.orders.length)
}

/**
 * One To-do per Book with placed orders no tradebook has shown by this Run, naming the file to drop:
 * "Drop ICICI Direct's tradebook covering 2026-10-29 in the Broker inbox: the India Book's IN-2026-10-29-002
 * (buy 100 Senco Gold Ltd) is placed, and no tradebook has shown whether it filled."
 */
export function missingTradebookTodos(orders: PdOrders | null): string[] {
  return waitingForTradebooks(orders).map(({ book, orders: waiting }) => {
    const sessions = [...new Set(waiting.map((o) => o.session))].sort()
    const listed = waiting.map((o) => `${o.order_id} (${o.side === 'BUY' ? 'buy' : 'sell'} ${shares(o.shares)} ${o.name ?? o.security_id})`).join(', ')
    const placed = waiting.length === 1 ? 'is placed' : 'are placed'
    return `Drop ${brokerName(book.broker)}'s ${brokerFiles(book.broker).tradebook} covering ${sessions.join(', ')} in the Broker inbox: ${bookName(book.book)}'s ${listed} ${placed}, and no tradebook has shown whether ${waiting.length === 1 ? 'it' : 'they'} filled.`
  })
}

/** A trade Saransh made himself, in a sentence: "Bought 100 IDFC First Bank Ltd at 80.98 on 2026-10-29". */
export function ownTradeText(t: PdTrade, price: (n: number) => string = String): string {
  return `${t.side === 'BUY' ? 'Bought' : 'Sold'} ${shares(t.qty)} ${t.name ?? t.security_id ?? "a security the data hasn't got"} at ${price(t.price)} on ${t.day}`
}
