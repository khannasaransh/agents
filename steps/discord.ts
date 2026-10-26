// Discord: reads the watched channels and their threads through a read-only bot over Discord's REST
// API, since the last successful read, and writes their messages to the Run folder with mentions of
// Saransh flagged. A DM with the bot among the channels is read too, unless DISCORD_READ_DMS=false.
// A forwarded message is read as the message it forwards.
// It saves the Word, PDF and Markdown files attached to them into the PRD inbox, the APKs into the APK
// inbox and every other file into the other folder, each with the message it came from in that
// folder's sources.json, and records links to documents that need a login, such as Google Docs, for
// the PM Agent's To-dos. A dry run saves nothing.
// With a sprint channel set, it also reads that channel's latest sprint post, whenever it was posted,
// and writes its tasks as sprint.json, with every message posted since in the watched channels, the
// sprint channel, and the bot's DMs with Saransh and with each assignee, for the PM Agent's task
// status report. Those messages are read only for the report: their files aren't saved. Saransh's
// own DMs are out of a bot's reach, so he forwards the bot those that say how a task stands. Opening
// the bot's DMs, which Discord asks of it before it can read them, is all it ever asks besides reads.
// It is skipped, not failed, until the env file holds the bot token, the channel list and Saransh's
// Discord user ID.
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { setTimeout } from 'node:timers/promises'
import { discordConfig, type DiscordConfig } from '../src/env.ts'
import { freeName, readJson, writeJson } from '../src/files.ts'
import { apkInboxDir, otherFilesDir, prdInboxDir } from '../src/paths.ts'
import { readInboxSources, writeInboxSources } from '../src/prd-inbox.ts'
import { readRun } from '../src/run.ts'
import { readDiscordState, readWeeklyDiscordState, writeDiscordState, writeWeeklyDiscordState } from '../src/state.ts'
import { latestPost, parseTasks, sprintTitle, type SprintPost } from '../src/sprint.ts'
import { runAsStep, StepSkipped } from '../src/step.ts'
import { isWeekly, weeklyDays } from '../src/weekly.ts'

const api = process.env.AGENTS_DISCORD_API_URL ?? 'https://discord.com/api/v10'
/** How far back the first Run reads, with no earlier read to start from. */
const firstRunHours = 24
/** The most messages Discord gives in one answer. */
const pageSize = 100
/** Word, PDF and Markdown: the kinds of file a PRD comes as. */
const isPrdFile = (filename: string) => /\.(docx?|pdf|md)$/i.test(filename)
/** An Android build: an APK, an app bundle, or a split APK set. */
const isApkFile = (filename: string) => /\.(apk|aab|apks|xapk)$/i.test(filename)

/** Where an attached file is saved. */
type FileKind = 'prd' | 'apk' | 'other'
const kindOf = (filename: string): FileKind => (isPrdFile(filename) ? 'prd' : isApkFile(filename) ? 'apk' : 'other')
const folderOf: Record<FileKind, () => string> = { prd: prdInboxDir, apk: apkInboxDir, other: otherFilesDir }
const folderName: Record<FileKind, string> = { prd: 'PRD inbox', apk: 'APK inbox', other: 'other folder' }
/** Where files need a login, so the Pipeline can't download them and Saransh does by hand. A host counts with its subdomains. */
const loginHosts = ['docs.google.com', 'drive.google.com', 'notion.so', 'notion.site', 'atlassian.net', 'sharepoint.com', 'onedrive.live.com', '1drv.ms', 'dropbox.com']

/** The links in a message's text to files that need a login, without the punctuation of the sentence around them. Text that only looks like a link is left out. */
function loginLinks(content: string): string[] {
  return (content.match(/https?:\/\/[^\s<>]+/g) ?? [])
    .map((link) => link.replace(/[.,;:!?)\]]+$/, ''))
    .filter((link) => {
      const hostname = URL.parse(link)?.hostname
      return !!hostname && loginHosts.some((host) => hostname === host || hostname.endsWith(`.${host}`))
    })
}

interface ApiUser {
  id: string
  username: string
  global_name: string | null
  bot?: boolean
}

/** A file attached to a message, which Discord serves from its CDN at a signed URL. */
interface ApiAttachment {
  id: string
  filename: string
  url: string
}

/** A message as Discord's REST API gives it, reduced to what this Step reads. */
interface ApiMessage {
  id: string
  author: ApiUser
  content: string
  timestamp: string
  /** Each user it mentions, with their nickname on the server when it has one. */
  mentions: (ApiUser & { member?: { nick?: string | null } })[]
  attachments: ApiAttachment[]
  /** For a forwarded message, the message forwarded, which Discord gives without its author. */
  message_snapshots?: { message: { content: string; attachments: ApiAttachment[] } }[]
}

/** A channel on a server. */
interface ApiChannel {
  id: string
  name: string
  guild_id: string
}

/** A DM with the bot, which belongs to no server. */
interface ApiDm {
  id: string
  guild_id?: undefined
  /** Who the bot talks to there. */
  recipients: ApiUser[]
}

/** Where messages are posted: a server's channel, one of its threads, or a DM with the bot. */
interface Conversation {
  id: string
  channel: string
  thread: string | null
  dm: boolean
  /** The server it is on, or `@me` for a DM, as Discord's message links name it. */
  guild: string
}

const displayName = (user: ApiUser) => user.global_name ?? user.username

interface ApiThread {
  id: string
  name: string
  parent_id: string
  thread_metadata: { archive_timestamp: string }
}

/** A message the Discord Step read, as it writes it to the Run folder. */
export interface DiscordMessage {
  id: string
  /** The channel's name, or for a DM with the bot, who the bot talks to there. */
  channel: string
  /** The thread it was posted in, or null when it was posted in the channel itself. */
  thread: string | null
  dm: boolean
  author: string
  timestamp: string
  content: string
  link: string
  mentionsSaransh: boolean
  fromSaransh: boolean
  /** The Word, PDF and Markdown files attached to it, by their names on Discord, which a real Run saves into the PRD inbox. */
  prdFiles: string[]
  /** The APKs attached to it, by their names on Discord, which a real Run saves into the APK inbox to be tested. */
  apkFiles: string[]
  /** Every other file attached to it, by its name on Discord, which a real Run saves into the other folder. */
  otherFiles: string[]
  /**
   * Links in it to files that need a login, such as on Google Drive, for Saransh to download by hand:
   * into the PRD inbox when it is a PRD, and into the APK inbox when it is an app build to test.
   */
  loginLinks: string[]
}

/** The span of time a read covers: from where the last successful read ended to when this one began. */
interface Window {
  since: string
  until: string
}

/** What the Discord Step writes to the Run folder, as discord.json. */
export interface DiscordRead extends Window {
  /** Oldest first. */
  messages: DiscordMessage[]
}

/** A file attached to a message read, where it is saved, and the link of that message. */
interface Attached {
  attachment: ApiAttachment
  kind: FileKind
  message: string
}

/** Discord's IDs grow with time, so a time's ID asks for the messages after it. */
const snowflakeAt = (time: string) => String((BigInt(Date.parse(time)) - 1420070400000n) << 22n)

async function call<T>(config: DiscordConfig, method: 'GET' | 'POST', path: string, query: Record<string, string> = {}, body?: unknown): Promise<T> {
  const url = `${api}${path}${Object.keys(query).length ? `?${new URLSearchParams(query)}` : ''}`
  const init = {
    method,
    headers: { authorization: `Bot ${config.token}`, ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  }
  let response = await fetch(url, init)
  while (response.status === 429) {
    const { retry_after: seconds } = (await response.json()) as { retry_after: number }
    console.log(`Rate limited on ${method} ${path}, waiting ${seconds}s`)
    await setTimeout(seconds * 1000)
    response = await fetch(url, init)
  }
  if (!response.ok) throw new Error(`Discord answered ${response.status} to ${method} ${path}: ${await response.text()}`)
  return (await response.json()) as T
}

const get = <T>(config: DiscordConfig, path: string, query: Record<string, string> = {}) => call<T>(config, 'GET', path, query)

/**
 * The bot's DM with a user. Discord doesn't let a bot list its DMs, but opening one gives the DM
 * there already is, or makes an empty one: it sends nothing, and the user isn't told.
 */
const dmWith = (config: DiscordConfig, userId: string) => call<ApiDm & { id: string }>(config, 'POST', '/users/@me/channels', {}, { recipient_id: userId })

/** The files attached to the messages read so far. */
const attached: Attached[] = []

/** The messages posted within `window` in a conversation. */
async function readMessages(config: DiscordConfig, at: Conversation, window: Window, saveFiles: boolean): Promise<DiscordMessage[]> {
  const messages: ApiMessage[] = []
  for (let after = snowflakeAt(window.since); ; ) {
    const page = await get<ApiMessage[]>(config, `/channels/${at.id}/messages`, { after, limit: String(pageSize) })
    messages.push(...page)
    if (page.length < pageSize) break
    after = page.map((m) => BigInt(m.id)).reduce((a, b) => (a > b ? a : b)).toString()
  }
  // Messages posted since the read began are the next read's.
  const end = BigInt(snowflakeAt(window.until))
  return messages.filter((m) => BigInt(m.id) < end).map((m) => {
    const link = `https://discord.com/channels/${at.guild}/${at.id}/${m.id}`
    // A forward carries the message forwarded, and any comment comes as a message of its own.
    const forwarded = m.message_snapshots?.[0]?.message
    const content = forwarded ? `Forwarded: ${forwarded.content}` : m.content
    const attachments = [...m.attachments, ...(forwarded?.attachments ?? [])]
    if (saveFiles) attached.push(...attachments.map((attachment) => ({ attachment, kind: kindOf(attachment.filename), message: link })))
    const filesOf = (kind: FileKind) => attachments.filter((a) => kindOf(a.filename) === kind).map((a) => a.filename)
    return {
      id: m.id,
      channel: at.channel,
      thread: at.thread,
      dm: at.dm,
      author: displayName(m.author),
      timestamp: m.timestamp,
      content,
      link,
      mentionsSaransh: m.mentions.some((u) => u.id === config.userId),
      fromSaransh: m.author.id === config.userId,
      prdFiles: filesOf('prd'),
      apkFiles: filesOf('apk'),
      otherFiles: filesOf('other'),
      loginLinks: loginLinks(content),
    }
  })
}

/** Downloads each attached file from Discord's CDN into the folder for its kind, recording the message it came from. */
async function saveAttachments(files: Attached[]): Promise<void> {
  for (const { attachment, kind, message } of files) {
    const folder = folderOf[kind]()
    const sources = readInboxSources(folder)
    if (Object.values(sources).some((s) => s.attachment === attachment.id)) {
      console.log(`${attachment.filename} from ${message} is in the ${folderName[kind]} already`)
      continue
    }
    // The URL is signed, so it needs no bot token, and the token stays with Discord's API.
    const response = await fetch(attachment.url)
    if (!response.ok) throw new Error(`Discord's CDN answered ${response.status} for ${attachment.filename} from ${message}`)
    const file = freeName(folder, attachment.filename)
    mkdirSync(folder, { recursive: true })
    writeFileSync(join(folder, file), Buffer.from(await response.arrayBuffer()))
    sources[file] = { message, attachment: attachment.id }
    writeInboxSources(sources, folder)
    console.log(`Saved ${file} from ${message} into the ${folderName[kind]}`)
  }
}

/** Discord lists active threads per server, not per channel, so each server's are asked for once. */
const activeThreads = new Map<string, ApiThread[]>()

/**
 * A channel's threads that can hold messages posted since `since`: its active ones, and those
 * archived since. Discord lists archived threads a page at a time, the latest archived first, so it
 * asks for pages until one reaches a thread archived before `since`, or there are no more.
 */
async function threadsOf(config: DiscordConfig, channel: ApiChannel, { since }: Window): Promise<ApiThread[]> {
  if (!activeThreads.has(channel.guild_id)) {
    activeThreads.set(channel.guild_id, (await get<{ threads: ApiThread[] }>(config, `/guilds/${channel.guild_id}/threads/active`)).threads)
  }
  const active = activeThreads.get(channel.guild_id)!.filter((t) => t.parent_id === channel.id)
  const archived: ApiThread[] = []
  const archivedSince = (t: ApiThread) => Date.parse(t.thread_metadata.archive_timestamp) >= Date.parse(since)
  for (let before: string | undefined; ; ) {
    const query = { limit: String(pageSize), ...(before ? { before } : {}) }
    const page = await get<{ threads: ApiThread[]; has_more?: boolean }>(config, `/channels/${channel.id}/threads/archived/public`, query)
    archived.push(...page.threads.filter(archivedSince))
    if (!page.has_more || !page.threads.length || !page.threads.every(archivedSince)) break
    before = page.threads.at(-1)!.thread_metadata.archive_timestamp
  }
  return [...active, ...archived]
}

/** The messages posted within `window` in a channel and its threads, or a DM with the bot. Their attached files are saved only with `saveFiles`. */
async function readChannel(config: DiscordConfig, channelId: string, window: Window, saveFiles = true): Promise<DiscordMessage[]> {
  const channel = await get<ApiChannel | ApiDm>(config, `/channels/${channelId}`)
  if (channel.guild_id === undefined) {
    if (!config.readDms) throw new Error(`Channel ${channelId} is a DM, and DISCORD_READ_DMS is false. Remove it from DISCORD_CHANNEL_IDS, or turn DMs on.`)
    return readMessages(config, { id: channel.id, channel: channel.recipients.map(displayName).join(', '), thread: null, dm: true, guild: '@me' }, window, saveFiles)
  }
  const at: Conversation = { id: channel.id, channel: channel.name, thread: null, dm: false, guild: channel.guild_id }
  const messages = await readMessages(config, at, window, saveFiles)
  for (const thread of await threadsOf(config, channel, window)) messages.push(...(await readMessages(config, { ...at, id: thread.id, thread: thread.name }, window, saveFiles)))
  return messages
}

/** A message's text with each mention of a user written as `@` and their name on the server. */
const withNames = (m: ApiMessage) =>
  m.content.replace(/<@!?(\d+)>/g, (mention, id: string) => {
    const user = m.mentions.find((u) => u.id === id)
    return user ? `@${user.member?.nick || displayName(user)}` : mention
  })

/**
 * The sprint channel's latest sprint post, from its last messages, whenever it was posted, with every
 * message posted after it until `until` in the watched channels and the sprint channel itself; null
 * when none of its last messages lists tasks.
 */
async function readSprintPost(config: DiscordConfig, channelId: string, until: string): Promise<SprintPost | null> {
  const channel = await get<ApiChannel>(config, `/channels/${channelId}`)
  const messages = (await get<ApiMessage[]>(config, `/channels/${channelId}/messages`, { limit: String(pageSize) }))
    .toSorted((a, b) => (BigInt(a.id) < BigInt(b.id) ? -1 : 1))
    .map((m) => ({
      id: m.id,
      authorId: m.author.id,
      author: displayName(m.author),
      timestamp: m.timestamp,
      link: `https://discord.com/channels/${channel.guild_id}/${channel.id}/${m.id}`,
      content: withNames(m),
      assigneeIds: m.mentions.filter((u) => !u.bot).map((u) => u.id),
    }))
  const post = latestPost(messages)
  if (!post) return null
  const kept = post.map(({ authorId, assigneeIds, ...m }) => m)
  const last = kept.at(-1)!
  const window = { since: new Date(Date.parse(last.timestamp)).toISOString(), until }
  const updates: DiscordMessage[] = []
  for (const id of new Set([...config.channelIds, channelId])) updates.push(...(await readChannel(config, id, window, false)))
  // The bot's DMs with Saransh, who forwards it the updates he is sent in his own DMs, and with each
  // assignee, who can tell it how their task stands.
  if (config.readDms) {
    const read = new Set(config.channelIds)
    for (const userId of new Set([config.userId, ...post.flatMap((m) => m.assigneeIds)])) {
      const dm = await dmWith(config, userId)
      if (read.has(dm.id)) continue
      read.add(dm.id)
      updates.push(...(await readMessages(config, { id: dm.id, channel: dm.recipients.map(displayName).join(', '), thread: null, dm: true, guild: '@me' }, window, false)))
    }
  }
  const after = updates.filter((m) => BigInt(m.id) > BigInt(last.id)).sort((a, b) => (BigInt(a.id) < BigInt(b.id) ? -1 : 1))
  return {
    channel: channel.name,
    author: kept[0].author,
    postedAt: kept[0].timestamp,
    link: kept[0].link,
    title: sprintTitle(kept),
    messages: kept,
    tasks: parseTasks(kept),
    updates: after,
  }
}

await runAsStep(async ({ runId, runFolder, force }) => {
  const out = join(runFolder, 'discord.json')
  const earlier = existsSync(out) ? readJson<DiscordRead>(out) : null
  if (earlier && !force) {
    console.log('Discord already read in this Run, skipping')
    return
  }
  const config = discordConfig()
  if ('missing' in config) throw new StepSkipped(`Discord isn't set up: the env file has no ${config.missing.join(', ')}`)
  const now = new Date()
  const until = now.toISOString()
  const weekly = isWeekly(readRun(runId).pipeline)
  const readState = weekly ? readWeeklyDiscordState : readDiscordState
  // A forced re-read starts where this Run's read did, since that read has moved the read time on.
  // The weekly Pipeline's first read covers the week; the daily Pipeline's covers the last day.
  const firstReadHours = weekly ? weeklyDays * 24 : firstRunHours
  const since = earlier?.since ?? readState()?.lastRead ?? new Date(now.getTime() - firstReadHours * 60 * 60 * 1000).toISOString()
  const messages: DiscordMessage[] = []
  for (const channelId of config.channelIds) messages.push(...(await readChannel(config, channelId, { since, until })))
  messages.sort((a, b) => (BigInt(a.id) < BigInt(b.id) ? -1 : 1))
  // Read before anything is written, so a failure leaves the whole read to the Step's re-run.
  const sprint = config.sprintChannelId ? await readSprintPost(config, config.sprintChannelId, until) : undefined
  const dryRun = readRun(runId).dryRun
  if (!dryRun) await saveAttachments(attached)
  if (sprint) {
    writeJson(join(runFolder, 'sprint.json'), sprint)
    console.log(`Read the sprint post of ${sprint.postedAt} in #${sprint.channel}: ${sprint.tasks.length} tasks, and ${sprint.updates.length} messages posted since`)
  } else if (sprint === null) console.log('None of the sprint channel\'s last messages lists tasks, so there is no sprint post')
  writeJson(out, { since, until, messages } satisfies DiscordRead)
  console.log(`Read ${messages.length} Discord messages since ${since}, ${messages.filter((m) => m.mentionsSaransh).length} mentioning Saransh`)
  if (dryRun) console.log('A dry run, so no attached file was saved, and the next real Run reads these messages again')
  else (weekly ? writeWeeklyDiscordState : writeDiscordState)({ lastRead: until })
})
