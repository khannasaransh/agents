// The Journal: the Portfolio Manager's Memory (the glossary), one Markdown file. It carries what is
// still open, which each Run's answer replaces whole, and the entries of the latest Runs, newest
// last, each Run's under its id.

/** How many Runs' entries the Journal keeps: about three months of weekday Runs. */
export const journalRuns = 60

const openHeading = '## Open'
const entriesHeading = '## Entries'

/** The Journal with a Run's new entries added, its oldest Runs' dropped past `journalRuns`, and what is open replaced. */
export function journalWith(previous: string, run: string, { entries, open }: { entries: string[]; open: string[] }): string {
  const runs = runsIn(previous).filter((r) => r.run !== run)
  if (entries.length) runs.push({ run, lines: entries.map((entry) => `- ${entry}`) })
  const kept = runs.slice(-journalRuns)
  return [
    '# Journal',
    '',
    openHeading,
    '',
    ...(open.length ? open.map((item) => `- ${item}`) : ['Nothing.']),
    '',
    entriesHeading,
    ...kept.flatMap(({ run: id, lines }) => ['', `### ${id}`, '', ...lines]),
    '',
  ].join('\n')
}

/** Each Run's entries in a Journal, oldest first. */
function runsIn(journal: string): { run: string; lines: string[] }[] {
  // Saransh may have edited it on Windows.
  const text = journal.replace(/\r\n?/g, '\n')
  const at = text.indexOf(`\n${entriesHeading}\n`)
  if (at < 0) return []
  const runs: { run: string; lines: string[] }[] = []
  for (const line of text.slice(at + entriesHeading.length + 2).split('\n')) {
    if (line.startsWith('### ')) runs.push({ run: line.slice(4).trim(), lines: [] })
    else if (line.trim() && runs.length) runs.at(-1)!.lines.push(line)
  }
  return runs
}
