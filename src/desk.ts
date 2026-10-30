// The Desk (issue 39): three analysts, Events, Chart and Risk, each writing its own view of the names
// `pd plan` asks it to review: no view, a veto, a trim to a given size, or a proposed early exit, each
// with its reasons and the evidence it cites. The analysts can only subtract, and their views are
// evidence in the Portfolio Manager's Decision records. Each reads only its part of a name's dossier,
// with no shares, values or weights in it, so no search it makes can carry Saransh's holdings, sizes
// or amounts. A view is reused, with its date, while nothing its analyst reads for the name has
// changed: the views are kept in the state folder, each with a fingerprint of what was read.
import { createHash } from 'node:crypto'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { readJson, writeJson } from './files.ts'
import { stateDir } from './paths.ts'
import type { PdAnalyst, PdBookState, PdDossier, PdEvent, PdExitDecided, PdFeeds, PdMissingReview, PdPlan, PdReviewList } from './pd.ts'
import { analystName } from './plans.ts'
import type { JsonSchema } from './schema.ts'

/** The analysts, in the order the Desk calls and the Brief shows them. */
export const analysts: PdAnalyst[] = ['events', 'chart', 'risk']

/** What an analyst says of a name: nothing against it, a veto of the buy, a trim of its size, or an early exit of the holding. */
export const viewKinds = ['none', 'veto', 'trim', 'exit'] as const
export type ViewKind = (typeof viewKinds)[number]

/** A piece of evidence a view cites: a field of the name's dossier, an event from the Feeds, or a page found by web search. */
export interface Evidence {
  source: 'dossier' | 'feed' | 'web'
  /** The dossier's field (bars, fundamentals.key_stats.pe_ttm), the event's id, or the page's link. */
  cite: string
  /** What it says, in a sentence. */
  says: string
}

/** A view as an analyst writes it. */
export interface AnalystView {
  book: 'IN' | 'US' | 'HK'
  security_id: string
  view: ViewKind
  /** A trim's size: the multiple of the buy it leaves, above 0 and under 1; null for any other view. */
  size: number | null
  reasons: string
  evidence: Evidence[]
}

/** What an analyst hands back: its views, and each web search it made, by its query and the source it cites. */
export interface AnalystAnswer {
  views: AnalystView[]
  searches: { query: string; source: string }[]
}

/** A view as the Desk keeps it: the analyst's, with whose it is, the name's role, and when it was made. */
export interface DeskView extends AnalystView {
  analyst: PdAnalyst
  name: string | null
  role: 'buy' | 'holding'
  /** When the analyst was given what it read, in UTC without an offset, as `pd plan --last-views` takes it. */
  viewed_at: string
  /** The Run that made it. */
  run: string
  /** Whether it was made in an earlier Run, nothing its analyst reads for the name having changed since. */
  reused: boolean
}

/** What became of an analyst in a Run. */
export interface AnalystOutcome {
  analyst: PdAnalyst
  /** answered: called and answered; reused: every view of its names was reused, so it wasn't called; failed: on both Workers. */
  status: 'answered' | 'reused' | 'failed'
  /** The names it was asked to review this Run, and those whose view was reused. */
  asked: number
  reused: number
  why: string | null
}

/** What the Desk Step writes as desk.json, for the Portfolio Manager, the Check Step and the Brief. */
export interface DeskResult {
  analysts: AnalystOutcome[]
  views: DeskView[]
  /** Each review the review list required that the Desk didn't give. */
  missing: PdMissingReview[]
  /** Each view the Desk refused, as one an analyst may not give, with why: its review counts as missing. */
  refused: { analyst: PdAnalyst; book: string; security_id: string; why: string }[]
  /** Each web search an analyst made, and the amounts from Saransh's Books it carries, if any. */
  searches: { analyst: PdAnalyst; query: string; source: string; amounts: string[] }[]
  /** Each early exit proposed in ash_new, from this Run's views. */
  exits: { analyst: PdAnalyst; book: string; security_id: string; decided: PdExitDecided }[]
}

const evidence: JsonSchema = {
  type: 'array',
  description: 'Each piece of evidence the view rests on. At least one for a veto, a trim or an exit',
  items: {
    type: 'object',
    additionalProperties: false,
    required: ['source', 'cite', 'says'],
    properties: {
      source: { type: 'string', enum: ['dossier', 'feed', 'web'] },
      cite: { type: 'string', description: "The dossier's field (bars, fundamentals.key_stats.pe_ttm), the event's id, or the web page's full link" },
      says: { type: 'string', description: 'What it says, in a sentence' },
    },
  },
}

/** The output schema every analyst answers in. */
export const analystOutputSchema: JsonSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['views', 'searches'],
  properties: {
    views: {
      type: 'array',
      description: 'One view of each name you were asked to review',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['book', 'security_id', 'view', 'size', 'reasons', 'evidence'],
        properties: {
          book: { type: 'string', enum: ['IN', 'US', 'HK'] },
          security_id: { type: 'string' },
          view: { type: 'string', enum: viewKinds, description: "none: nothing against it; veto: don't buy it (a buy only); trim: buy less of it (a buy only); exit: sell the holding now (a holding only)" },
          size: { type: ['number', 'null'], description: "A trim's size: the multiple of the buy to keep, above 0 and under 1, such as 0.5; null for any other view" },
          reasons: { type: 'string', description: 'Why, in a few sentences' },
          evidence,
        },
      },
    },
    searches: {
      type: 'array',
      description: 'Each web search you made: its query, and the link of the source it found. Empty when you made none',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['query', 'source'],
        properties: { query: { type: 'string' }, source: { type: 'string' } },
      },
    },
  },
}

/** What an analyst is given of a name to review: where it is, why, and its part of the dossier. */
export interface NameToReview {
  book: 'IN' | 'US' | 'HK'
  plan: string
  security_id: string
  name: string | null
  role: 'buy' | 'holding'
  held: boolean
  /** Its events' ids in the next 5 sessions, and those new since the Events analyst's last view. */
  coming: string[]
  new: string[]
  /** What the analyst reads of its dossier; null when pd plan wrote none. */
  dossier: Record<string, unknown> | null
}

/** A name's order as an analyst reads it: its side, strategy and signal, without its shares, price or weight. */
function orderRead(order: PdDossier['orders'][number]) {
  const signal = order.signal ? { kind: order.signal.kind, action: order.signal.action ?? null, signal_date: order.signal.signal_date ?? null, rank: order.signal.rank ?? null } : null
  return { side: order.side, strategy: order.sleeve, reason: order.reason, signal, cut_by: order.cuts.map((c) => c.rule) }
}

/** How many of the latest bars Risk reads, for liquidity: about three months. */
const riskBars = 63

/** What `analyst` reads of a dossier: no shares, values or weights. */
export function dossierRead(analyst: PdAnalyst, dossier: PdDossier): Record<string, unknown> {
  const about = { security_id: dossier.security_id, name: dossier.name, market: dossier.market, currency: dossier.currency, sector: dossier.sector, industry: dossier.industry }
  const orders = dossier.orders.map(orderRead)
  if (analyst === 'events') return { ...about, marketsmith: dossier.marketsmith, fundamentals: dossier.fundamentals, events: dossier.events, orders }
  if (analyst === 'chart') return { ...about, as_of: dossier.as_of, bars: dossier.bars, orders }
  return { ...about, as_of: dossier.as_of, bars: dossier.bars.slice(-riskBars), marketsmith: dossier.marketsmith, events: dossier.events, orders }
}

/** A Book's other holdings as Risk reads them, for its concentrations: names, sectors and their results and board meetings to come, no amounts. */
export interface HeldName {
  security_id: string
  name: string | null
  sector: string | null
  coming: { date: string; kind: PdEvent['kind']; title: string }[]
}

/** What one analyst is asked in a Run: the names, and for Risk each reviewed Book's other holdings. */
export interface AnalystWork {
  analyst: PdAnalyst
  names: NameToReview[]
  /** Risk's: by Book, the names its paper Book holds. */
  holdings: Record<string, HeldName[]>
}

/** The kinds of event dated by the day they are about, which may be to come: a holding's are Risk's to weigh. */
const comingKinds: PdEvent['kind'][] = ['board_meeting', 'results']

/**
 * Each analyst's work in this Run, by the review list: Events and Chart by name, Risk over each Book's
 * buys, with its holdings' results and board meetings to come from the Feeds.
 */
export function deskWork(plan: PdPlan, dossierOf: (path: string) => PdDossier | null, feeds: PdFeeds | null = null): AnalystWork[] {
  const review = plan.review
  const toReview = (n: PdReviewList['names'][number], analyst: PdAnalyst): NameToReview => {
    const dossier = n.dossier ? dossierOf(n.dossier) : null
    return {
      book: n.book,
      plan: n.plan,
      security_id: n.security_id,
      name: n.name,
      role: n.role === 'holding' ? 'holding' : 'buy',
      held: n.held,
      coming: n.coming,
      new: n.new,
      dossier: dossier && dossierRead(analyst, dossier),
    }
  }
  return review.analysts.map((analyst) => {
    if (analyst !== 'risk') return { analyst, names: review.names.filter((n) => n.analysts.some((a) => a.analyst === analyst)).map((n) => toReview(n, analyst)), holdings: {} }
    const names = review.risk.flatMap((r) => review.names.filter((n) => n.book === r.book && n.role === 'buy' && r.buys.includes(n.security_id)).map((n) => toReview(n, analyst)))
    const holdings = Object.fromEntries(
      review.risk.map((r) => {
        const paper = plan.plans.find((p) => p.book === r.book && p.kind === 'paper')
        const held = (paper?.holdings ?? []).filter((h) => h.sleeve !== 'gold')
        const coming = (sid: string) =>
          (feeds?.names.find((n) => n.security_id === sid)?.events ?? []).filter((e) => comingKinds.includes(e.kind) && e.date >= plan.on).map(({ date, kind, title }) => ({ date, kind, title }))
        const unique = held.filter((h, i) => held.findIndex((o) => o.security_id === h.security_id) === i)
        return [r.book, unique.map((h) => ({ security_id: h.security_id, name: h.name, sector: h.sector, coming: coming(h.security_id) }))]
      }),
    )
    return { analyst, names, holdings }
  })
}

/** The key of an analyst's review of a name: events:IN:IN:RATEGAIN. */
export const reviewKey = (analyst: PdAnalyst, { book, security_id }: { book: string; security_id: string }) => `${analyst}:${book}:${security_id}`
const hash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex')

/**
 * The fingerprint of what an analyst reads for each of its names. Events and Chart read a name's part
 * of its dossier; Risk weighs a Book's buys together, against its holdings, so a change to any of them
 * is a change to each.
 */
export function fingerprints(work: AnalystWork): Map<string, string> {
  const own = (n: NameToReview) => hash({ role: n.role, held: n.held, dossier: n.dossier })
  const found = new Map<string, string>()
  for (const t of work.names) {
    const print = work.analyst === 'risk' ? hash({ buys: work.names.filter((o) => o.book === t.book).map(own), holdings: work.holdings[t.book] ?? [] }) : own(t)
    found.set(reviewKey(work.analyst, t), print)
  }
  return found
}

/** The views kept from Run to Run, by analyst, Book and security, each with the fingerprint of what was read. */
type ViewStore = Record<string, { view: DeskView; fingerprint: string }>

const viewsFile = () => join(stateDir(), 'desk-views.json')

export function readViews(): ViewStore {
  return existsSync(viewsFile()) ? readJson(viewsFile()) : {}
}

export function writeViews(store: ViewStore): void {
  writeJson(viewsFile(), store)
}

/** The kept view of a name that is still good: one made from what the analyst reads now. */
export function reusable(store: ViewStore, analyst: PdAnalyst, t: NameToReview, fingerprint: string): DeskView | null {
  const kept = store[reviewKey(analyst, t)]
  return kept && kept.fingerprint === fingerprint ? { ...kept.view, role: t.role, name: t.name, reused: true } : null
}

/** Keeps a view, with the fingerprint of what was read. */
export function keepView(store: ViewStore, view: DeskView, fingerprint: string): void {
  store[reviewKey(view.analyst, view)] = { view: { ...view, reused: false }, fingerprint }
}

/** When the Events analyst last viewed each security, for `pd plan --last-views`: an event fetched after it is new. */
export function lastEventsViews(store: ViewStore): Record<string, string> {
  const found: Record<string, string> = {}
  for (const { view } of Object.values(store)) {
    if (view.analyst === 'events' && (found[view.security_id] ?? '') < view.viewed_at) found[view.security_id] = view.viewed_at
  }
  return found
}

/** Why the Desk can't take a view of a name from an analyst, or null when it can. */
export function refusal(analyst: PdAnalyst, view: AnalystView, t: NameToReview): string | null {
  const name = analystName[analyst]
  if ((view.view === 'veto' || view.view === 'trim') && t.role !== 'buy') return `A ${view.view} is of a buy, and the Desk reviews ${t.security_id} as a holding`
  if (view.view === 'exit' && !t.held) return `An early exit sells a holding, and the paper Book doesn't hold ${t.security_id}`
  if (view.view === 'trim' && !(view.size !== null && view.size > 0 && view.size < 1)) return `A trim keeps more than none and less than all of the buy: its size is ${view.size}`
  if (view.view !== 'trim' && view.size !== null) return `Only a trim has a size`
  if (view.view !== 'none' && !view.evidence.length) return `Its ${view.view} cites no evidence`
  const web = view.evidence.filter((e) => e.source === 'web')
  if (web.length && analyst === 'chart') return `${name} has no web access, yet cites the web`
  if (web.some((e) => !/^https?:\/\/\S+$/.test(e.cite))) return 'It cites the web without the link of its source'
  return null
}

/** Each review the review list requires of a buy: Events and Chart by name, Risk over its Book's buys. */
export function requiredReviews(review: PdReviewList): Omit<PdMissingReview, 'why'>[] {
  const byName = review.names.filter((n) => n.role === 'buy').flatMap((n) => n.analysts.map((a) => ({ book: n.book, security_id: n.security_id, analyst: a.analyst as PdAnalyst })))
  const risk = review.risk.flatMap((r) => r.buys.map((security_id) => ({ book: r.book, security_id, analyst: 'risk' as PdAnalyst })))
  return [...byName, ...risk]
}

/** Every amount of Saransh's Books in the Run's plans and Book states: shares, values and cash, each a whole number. */
export function bookAmounts(plan: PdPlan | null, states: { states: PdBookState[] } | null): Set<string> {
  const found = new Set<string>()
  const add = (n: number | null | undefined) => {
    if (typeof n === 'number' && Number.isFinite(n) && Math.abs(n) >= 1) found.add(String(Math.round(Math.abs(n))))
  }
  for (const p of plan?.plans ?? []) {
    ;[p.value, p.cash, p.buys, p.sales, p.reserved].forEach(add)
    for (const o of p.orders ?? []) [o.shares, o.value].forEach(add)
    for (const h of p.holdings ?? []) [h.shares, h.value].forEach(add)
    for (const h of p.legacy ?? []) add(h.qty)
  }
  for (const s of states?.states ?? []) {
    ;[s.cash, s.capital].forEach(add)
    for (const h of s.holdings) add(h.qty)
  }
  return found
}

/** The amounts of Saransh's Books a search query carries: each number in it, but a year, that is one of `amounts`. */
export function amountsIn(query: string, amounts: Set<string>): string[] {
  const numbers = query.match(/\d[\d,]*(\.\d+)?/g) ?? []
  return numbers.filter((n) => {
    const value = Number(n.replaceAll(',', ''))
    const year = Number.isInteger(value) && value >= 1990 && value <= 2100
    return !year && amounts.has(String(Math.round(value)))
  })
}

/** The Feeds' sources as an analyst reads them: which were fetched, and which failed, so their events are as last fetched. */
export function feedsRead(feeds: PdFeeds | null) {
  return feeds ? feeds.sources.map(({ label, market, status, why }) => ({ label, market, status, why })) : null
}

const viewWords: Record<ViewKind, string> = { none: 'no view against it', veto: 'veto the buy', trim: 'trim the buy', exit: 'exit the holding early' }

/** A view's verdict in words: "trim the buy to 0.5×", "no view against it". */
export function viewVerdict(view: Pick<AnalystView, 'view' | 'size'>): string {
  return view.view === 'trim' && view.size !== null ? `${viewWords.trim} to ${view.size}×` : viewWords[view.view]
}

/** A view in a sentence, for the Brief: "Events on Rategain: veto the buy. Results on 29 October." */
export function viewText(view: DeskView): string {
  return `${analystName[view.analyst]} on ${view.name ?? view.security_id}: ${viewVerdict(view)}. ${view.reasons.trim()}`
}
