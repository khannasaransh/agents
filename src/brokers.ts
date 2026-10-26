// The Broker inbox's files and the Books' real money, as the Broker inbox Step logs and raises them and
// the Stocks Brief shows them: what became of each file `pd broker import` was handed, and each
// Reconciliation difference.
import type { PdBook, PdBrokerFile, PdDifference } from './pd.ts'

const brokerNames: Record<string, string> = { icici_direct: 'ICICI Direct', moomoo: 'moomoo' }
const bookNames: Record<string, string> = { IN: 'the India Book', US: 'the US Book', HK: 'the Hong Kong Book' }
const fileNames: Record<string, { tradebook: string; holdings: string }> = {
  icici_direct: { tradebook: 'tradebook', holdings: 'holdings' },
  moomoo: { tradebook: 'trade history', holdings: 'positions' },
}

/** A broker as a sentence names it: "ICICI Direct", "moomoo". */
export const brokerName = (broker: string | null) => brokerNames[broker ?? ''] ?? broker ?? ''

/** A Book as a sentence names it: "the India Book", "the Hong Kong Book". */
export const bookName = (book: string | null) => bookNames[book ?? ''] ?? book ?? ''

/** What a broker calls its tradebook and its holdings ("trade history", "positions"). */
export const brokerFiles = (broker: string | null) => fileNames[broker ?? ''] ?? fileNames.icici_direct

/** A number of shares as a sentence gives it: 48, 12.5. */
export const shares = (n: number) => String(Math.round(n * 1e6) / 1e6)

/**
 * A security in a sentence: "Delhivery Ltd (IN:DELHIVERY)", or for one the data hasn't got, by what its
 * broker's export names it by: "NEW LISTING LTD (ISIN INE000Z01010)", "iShares Latin America 40 ETF (symbol ILF)".
 */
export function securityName(d: Pick<PdDifference, 'security_id' | 'isin' | 'symbol' | 'name'>): string {
  const id = d.security_id ?? (d.isin ? `ISIN ${d.isin}` : `symbol ${d.symbol}`)
  return d.name ? `${d.name} (${id})` : id
}

/**
 * What became of a file, as the Step logs it: "orderBook.csv: ICICI Direct's tradebook, 6 trades
 * recorded in the India Book, 1 in its ledger already". A file of several Books (moomoo's, the US Book's
 * and the Hong Kong Book's) has a line for each.
 */
export function fileLine(f: PdBrokerFile): string {
  const broker = brokerName(f.broker)
  const book = bookName(f.book)
  const files = brokerFiles(f.broker)
  if (f.status === 'unreadable') return f.book ? `${f.file}: can't be read for ${book}: ${f.why}` : `${f.file}: can't be read: ${f.why}`
  if (f.status === 'seen') return `${f.file}: seen before, not recorded again: ${f.why}`
  if (f.status === 'recorded' && f.trades) {
    const { recorded, in_ledger, set_aside } = f.trades
    const notes = [in_ledger && `${in_ledger} in its ledger already`, set_aside && `${set_aside} row${set_aside === 1 ? '' : 's'} set aside as not the Book's trades`].filter(Boolean)
    return `${f.file}: ${broker}'s ${files.tradebook}, ${recorded} trade${recorded === 1 ? '' : 's'} recorded in ${book}${notes.length ? `, ${notes.join(', ')}` : ''}`
  }
  const r = f.reconciliation!
  const differences = `${r.differences.length} difference${r.differences.length === 1 ? '' : 's'}`
  return `${f.file}: ${broker}'s ${files.holdings} of ${r.as_of}, reconciled with ${book}: ${r.matched} match, ${differences}`
}

/** A difference in a few words, as the Brief's table and the To-do say it, the Book's broker named. */
export function differenceText(d: PdDifference, book: Pick<PdBook, 'broker' | 'broker_name'>): string {
  const broker = book.broker_name
  const tradebook = brokerFiles(book.broker).tradebook
  const name = securityName(d)
  if (d.kind === 'unknown_security') return `${broker} holds ${shares(d.broker_qty)} of ${name}, which ash_new's securities table hasn't got, so it can't be reconciled.`
  if (d.kind === 'not_in_ledger') return `${broker} holds ${shares(d.broker_qty)} of ${name}, which its ledger has none of. Drop the ${tradebook} with its buys in the Broker inbox.`
  if (d.kind === 'not_at_broker') return `its ledger holds ${shares(d.ledger_qty ?? 0)} of ${name}, which ${broker} holds none of. Drop the ${tradebook} with its sales in the Broker inbox.`
  const held = `${broker} holds ${shares(d.broker_qty)} of ${name}, its ledger ${shares(d.ledger_qty ?? 0)}`
  if (d.ratio) return `${held}: ${d.ratio}, as a split or bonus the Lake hasn't got would give.`
  return `${held}. Drop the ${tradebook} with the missing ${d.broker_qty > (d.ledger_qty ?? 0) ? 'buys' : 'sales'} in the Broker inbox.`
}

/** One To-do per difference in a Book's latest Reconciliation. */
export function reconciliationTodos(book: PdBook): string[] {
  const r = book.reconciliation
  if (!r) return []
  return r.differences.map((d) => `Reconciliation, ${book.name}, as of ${r.as_of}: ${differenceText(d, book)}`)
}
