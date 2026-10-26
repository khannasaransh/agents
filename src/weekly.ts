/** How many days the weekly Pipeline covers on its first Run, before it has a cursor of its own. */
export const weeklyDays = 7

export function isWeekly(pipeline: string): boolean {
  return pipeline === 'weekly'
}

/** The start of a first weekly Run's window: `weeklyDays` before `now`. */
export function weeklyStart(now = new Date()): string {
  return new Date(now.getTime() - weeklyDays * 24 * 60 * 60 * 1000).toISOString()
}
