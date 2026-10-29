// Rule plans, as the Stocks Brief words them: why each order was placed, the signal behind it, and
// each cut a rule made to it.
import type { PdBookState, PdCondition, PdCut, PdPlanOrder, PdRulePlan } from './pd.ts'

const rules: Record<string, string> = {
  position_cap: 'the position cap',
  sector_cap: 'the sector cap',
  order_size_guard: 'the order-size guard',
  limit_price: 'its limit price',
  no_new_buys: 'the breakers (no new buys)',
  half_exposure: 'the breakers (half exposure)',
  exposure_level: 'the exposure level',
  unsettled: 'an open Reconciliation difference',
  quarantined: 'its Quarantine',
  hold: 'Hold mode',
}

const conditions: Record<PdCondition, string> = { uptrend: 'Uptrend', under_pressure: 'Under pressure', correction: 'Correction' }

const indices: Record<string, string> = { NIFTY500: 'the Nifty 500', SP500: 'the S&P 500' }

/** Whose breadth it is: "of the Nifty 500", or "of the market" where the Lake keeps no index membership. */
export const breadthOf = (index: string | null) => `of ${index === null ? 'the market' : (indices[index] ?? index)}`

/** A Market condition as the glossary writes it: Uptrend, Under pressure, Correction. */
export const conditionName = (condition: PdCondition) => conditions[condition]

/** A rule as a sentence names it: "the position cap", "an open Reconciliation difference". */
export const ruleName = (rule: string) => rules[rule] ?? rule.replaceAll('_', ' ')

/** A share of a Book or of a strategy as a sentence gives it: "12.5%". */
export const percent = (share: number) => `${Math.round(share * 1000) / 10}%`

/** A cut in words: "cut from 6775 to 2415 shares by the position cap". */
export function cutText(cut: PdCut): string {
  const allowed = Math.floor(cut.allowed + 1e-9)
  return allowed > 0 ? `cut from ${Math.round(cut.wanted)} to ${allowed} shares by ${ruleName(cut.rule)}` : `${Math.round(cut.wanted)} shares stopped by ${ruleName(cut.rule)}`
}

/** The Book's own reasons for an order, when no strategy's signal is behind it. */
const ownReasons: Record<string, string> = {
  reweighting: "The April weighting, resizing the Sleeve to its share",
  breaker: 'The breakers, trading the Sleeve back to its strategy or selling it down',
  disaster_stop: 'Its Disaster stop, which the last close is under',
  exposure: 'The exposure level, trimming the weakest holdings first',
}

/**
 * The signal behind an order, in words: "India CW2, selected holds it at 12.5% on the close of
 * 2026-10-23", "India CW2, selected's rebalance: add to 10%, signalled on 2026-10-23, ranked 3".
 */
export function signalText(order: PdPlanOrder, plan: PdRulePlan): string {
  const strategy = plan.strategies?.find((s) => s.id === order.sleeve)?.name ?? order.sleeve
  const signal = order.signal
  if (order.sleeve === 'gold') return order.reason === 'first_allocation' ? "Gold's share of the Book" : "Gold's Sleeve, back to its share"
  if (signal?.kind === 'holding') return `${strategy} holds it at ${percent(signal.weight ?? 0)} on the close of ${plan.as_of}`
  if (signal?.kind === 'waiting') return `${strategy}'s order from an earlier session, waiting for a bar`
  if (signal?.kind === 'trade') {
    const parts = [`${strategy}'s ${order.reason.replaceAll('_', ' ')}: ${signal.action} to ${percent(signal.weight ?? 0)}`]
    if (signal.signal_date) parts.push(`signalled on ${signal.signal_date}`)
    if (signal.rank !== undefined) parts.push(`ranked ${signal.rank}`)
    return parts.join(', ')
  }
  return ownReasons[order.reason] ?? order.reason.replaceAll('_', ' ')
}

/** The state a plan was made from: its Book's, or its paper Book's. */
export const stateOf = (states: PdBookState[], plan: Pick<PdRulePlan, 'book' | 'kind'>) => states.find((s) => s.book === plan.book && s.paper === (plan.kind === 'paper'))
