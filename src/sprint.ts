// The sprint post: the task list a lead posts in the sprint channel at the start of each sprint,
// often split across a few messages sent minutes apart, one per Team. Under a bold Team heading,
// each assignee's mention is followed by their tasks, one `- ` line each, ending in `PM - <name>`:
//
//   **Backend Team**
//   <@294745345890582528>
//   - Smaran | Video Feed Algorithm. PM - Arhaan Akhtar
//
// The Discord Step finds the latest post and parses it into tasks, and reads every message posted
// after it; the PM Agent says how each task stands from them.
import type { DiscordMessage } from '../steps/discord.ts'

/** How far apart the messages of one post can be. */
const postGapMinutes = 60

/** One task of the sprint, with everyone it is assigned to. A task listed under several Teams is one task. */
export interface SprintTask {
  /** Made from the title, unique in the post. */
  id: string
  title: string
  /** The product before ` | ` in the title, such as Smaran, or null when the title names none. */
  product: string | null
  pm: string | null
  assignees: { name: string; team: string | null }[]
}

/** A message of the post, with its mentions written as names. */
export interface SprintMessage {
  id: string
  author: string
  timestamp: string
  link: string
  content: string
}

/** What the Discord Step writes as sprint.json in the Run folder. */
export interface SprintPost {
  channel: string
  author: string
  postedAt: string
  /** The link of the post's first message. */
  link: string
  /** The line that names the sprint, such as `here is the list of tasks for this sprint-(oct 21 - oct 27)`, or null. */
  title: string | null
  messages: SprintMessage[]
  tasks: SprintTask[]
  /** Every message posted after the post, oldest first, in the watched channels and the sprint channel, with their threads. A sprint.json from before they were read has none. */
  updates: DiscordMessage[]
}

const slug = (text: string) =>
  text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')

/** The tasks in a post's messages, in the order first listed. */
export function parseTasks(messages: Pick<SprintMessage, 'content'>[]): SprintTask[] {
  const tasks = new Map<string, SprintTask>()
  let team: string | null = null
  let assignee: string | null = null
  for (const line of messages.flatMap((m) => m.content.split('\n')).map((l) => l.trim())) {
    const heading = /^\*\*(.+?)\*\*$/.exec(line)
    if (heading) {
      team = heading[1].replace(/\s+team$/i, '').trim()
      assignee = null
      continue
    }
    // A line that is only a mention names whose tasks follow.
    const mention = /^@(\S.*)$/.exec(line)
    if (mention) {
      assignee = mention[1].trim()
      continue
    }
    const item = /^[-*•]\s+(.+)$/.exec(line)
    if (!item || !assignee) continue
    const withPm = /^(.*?)[.,]?\s+PM\s*[-–—:]\s*(.+)$/i.exec(item[1])
    const title = (withPm ? withPm[1] : item[1]).trim().replace(/\.$/, '')
    const key = title.toLowerCase().replace(/\s+/g, ' ')
    let task = tasks.get(key)
    if (!task) {
      const product = title.includes(' | ') ? title.split(' | ')[0].trim() : null
      let id = slug(title) || 'task'
      for (let n = 2; [...tasks.values()].some((t) => t.id === id); n++) id = `${slug(title)}-${n}`
      task = { id, title, product, pm: withPm ? withPm[2].trim() : null, assignees: [] }
      tasks.set(key, task)
    }
    if (!task.assignees.some((a) => a.name === assignee && a.team === team)) task.assignees.push({ name: assignee, team })
  }
  return [...tasks.values()]
}

/**
 * The latest post in a channel's messages, oldest first: the newest message that lists tasks, and
 * the messages its author sent around it with no more than an hour between each. Null when no
 * message lists tasks.
 */
export function latestPost<T extends SprintMessage & { authorId: string }>(messages: T[]): T[] | null {
  const at = messages.findLastIndex((m) => parseTasks([m]).length > 0)
  if (at < 0) return null
  const near = (a: T, b: T) => a.authorId === b.authorId && Math.abs(Date.parse(a.timestamp) - Date.parse(b.timestamp)) <= postGapMinutes * 60 * 1000
  let first = at
  let last = at
  while (first > 0 && near(messages[first - 1], messages[first])) first--
  while (last < messages.length - 1 && near(messages[last + 1], messages[last])) last++
  return messages.slice(first, last + 1)
}

/** The line of a post that names the sprint, or null. */
export function sprintTitle(messages: Pick<SprintMessage, 'content'>[]): string | null {
  return (
    messages
      .flatMap((m) => m.content.split('\n'))
      .map((l) => l.trim())
      .find((l) => /sprint/i.test(l)) ?? null
  )
}
