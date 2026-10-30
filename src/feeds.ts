// The Feeds (issues 37 and 38), as the Feeds Step logs them, its To-dos say them and the Stocks Brief
// shows them: each source's fetch, and the events coming for the Books' holdings.
import type { PdEvent, PdFeeds } from './pd.ts'

type Source = PdFeeds['sources'][number]

/** How far ahead the Brief shows the holdings' coming events. */
export const comingDays = 30

/** A source's fetch in a line, for the log. */
export function sourceLine(s: Source): string {
  if (s.status === 'cached') return `${s.label}: read from the cache for ${s.names} names (a dry run fetches nothing)`
  if (s.status === 'fetched') return `${s.label}: fetched ${s.fetched} of ${s.names} names, ${s.cached} read from the cache, ${s.new} new events`
  return `${s.label}: ${s.status}: ${s.why}`
}

/**
 * A To-do for each source that failed or skipped itself. A failure keeps the events it fetched before,
 * and NSE's and BSE's endpoints change without notice, so it asks for ash_new's reader to be checked;
 * EDGAR without its contact asks for SEC_CONTACT.
 */
export function feedTodos(feeds: PdFeeds): string[] {
  return feeds.sources.flatMap((s) => {
    if (s.status === 'failed') return [`${s.label} failed this Run (${s.why}), so its events are as last fetched. Its endpoint needs browser-like headers and changes without notice: check that ash_new's pdash.feeds still reads it, then run the Feeds Step again.`]
    if (s.source === 'edgar' && s.status === 'skipped') return [`${s.label} weren't fetched: ${s.why}. Set SEC_CONTACT in the agents repo's .env to your name and email, which EDGAR asks every request to give.`]
    if (s.status === 'skipped') return [`${s.label} weren't fetched: ${s.why}.`]
    return []
  })
}

/** The kinds of event dated by the day they are about, which may be to come: the rest are dated when published. */
const comingKinds: PdEvent['kind'][] = ['board_meeting', 'results']

/** Each holding's meetings and results from the Run's day to comingDays after it, soonest first. */
export function comingEvents(feeds: PdFeeds): { name: PdFeeds['names'][number]; event: PdEvent }[] {
  const last = new Date(`${feeds.on}T00:00:00Z`)
  last.setUTCDate(last.getUTCDate() + comingDays)
  const until = last.toISOString().slice(0, 10)
  return feeds.names
    .filter((n) => n.held_by.length)
    .flatMap((name) => name.events.filter((e) => comingKinds.includes(e.kind) && e.date >= feeds.on && e.date <= until).map((event) => ({ name, event })))
    .sort((a, b) => a.event.date.localeCompare(b.event.date) || a.name.security_id.localeCompare(b.name.security_id))
}

const kindNames: Record<PdEvent['kind'], string> = {
  announcement: 'Announcement',
  board_meeting: 'Board meeting',
  results: 'Results',
  pledge: 'Pledges',
  filing: 'Filing',
  insider: "Insider's trade",
}

/** An event's kind as the Brief names it. */
export const kindName = (kind: PdEvent['kind']) => kindNames[kind]
