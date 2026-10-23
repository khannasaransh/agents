// Discord: reads the watched channels and their threads through a read-only bot over Discord's REST
// API, since the last successful read, and writes their messages to the Run folder with mentions of
// Saransh flagged. A DM with the bot among the channels is read too, unless DISCORD_READ_DMS=false.
// It saves the Word, PDF and Markdown files attached to them into the PRD inbox, with the message
// each came from in the inbox's sources.json, and records links to documents that need a login, such
// as Google Docs, for the PM Agent's To-dos. A dry run saves nothing into the inbox.
// It is skipped, not failed, until the env file holds the bot token, the channel list and Saransh's
// Discord user ID.
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { join, parse } from 'node:path'
import { setTimeout } from 'node:timers/promises'
import { discordConfig, type DiscordConfig } from '../src/env.ts'
import { readJson, writeJson } from '../src/files.ts'
import { prdInboxDir } from '../src/paths.ts'
import { readRun } from '../src/run.ts'
import { readDiscordState, writeDiscordState } from '../src/state.ts'
import { runAsStep, StepSkipped } from '../src/step.ts'

const api = process.env.AGENTS_DISCORD_API_URL ?? 'https://discord.com/api/v10'
/** How far back the first Run reads, with no earlier read to start from. */
const firstRunHours = 24
/** The most messages Discord gives in one answer. */
const pageSize = 100
/** Word, PDF and Markdown: the kinds of file a PRD comes as. */
const isPrdFile = (filename: string) => /\.(docx?|pdf|md)$/i.test(filename)
/** Where documents need a login, so the Pipeline can't download them and Saransh does by hand. A host counts with its subdomains. */
const loginHosts = ['docs.google.com', 'drive.google.com', 'notion.so', 'notion.site', 'atlassian.net', 'sharepoint.com', 'onedrive.live.com', '1drv.ms', 'dropbox.com']

/** The links in a message's text to documents that need a login, without the punctuation of the sentence around them. */
function loginLinks(content: string): string[] {
  return (content.match(/https?:\/\/[^\s<>]+/g) ?? [])
    .map((link) => link.replace(/[.,;:!?)\]]+$/, ''))
    .filter((link) => {
      const { hostname } = new URL(link)
      return loginHosts.some((host) => hostname === host || hostname.endsWith(`.${host}`))
    })
}

interface ApiUser {
  id: string
  username: string
  global_name: string | null
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
  mentions: { id: string }[]
  attachments: ApiAttachment[]
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
  /** Links in it to documents that need a login, such as Google Docs, for Saransh to download into the PRD inbox by hand. */
  prdLinks: string[]
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

/** A PRD file attached to a message read, and the link of that message. */
interface Attached {
  attachment: ApiAttachment
  message: string
}

/** Where each file the Discord Step saved into the PRD inbox came from, by its name there, as sources.json in the inbox. */
type InboxSources = Record<string, { message: string; attachment: string }>

/** Discord's IDs grow with time, so a time's ID asks for the messages after it. */
const snowflakeAt = (time: string) => String((BigInt(Date.parse(time)) - 1420070400000n) << 22n)

async function get<T>(config: DiscordConfig, path: string, query: Record<string, string> = {}): Promise<T> {
  const url = `${api}${path}${Object.keys(query).length ? `?${new URLSearchParams(query)}` : ''}`
  let response = await fetch(url, { headers: { authorization: `Bot ${config.token}` } })
  while (response.status === 429) {
    const { retry_after: seconds } = (await response.json()) as { retry_after: number }
    console.log(`Rate limited on GET ${path}, waiting ${seconds}s`)
    await setTimeout(seconds * 1000)
    response = await fetch(url, { headers: { authorization: `Bot ${config.token}` } })
  }
  if (!response.ok) throw new Error(`Discord answered ${response.status} to GET ${path}: ${await response.text()}`)
  return (await response.json()) as T
}

/** The PRD files attached to the messages read so far. */
const attached: Attached[] = []

/** The messages posted within `window` in a conversation. */
async function readMessages(config: DiscordConfig, at: Conversation, window: Window): Promise<DiscordMessage[]> {
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
    const prdFiles = m.attachments.filter((a) => isPrdFile(a.filename))
    attached.push(...prdFiles.map((attachment) => ({ attachment, message: link })))
    return {
      id: m.id,
      channel: at.channel,
      thread: at.thread,
      dm: at.dm,
      author: displayName(m.author),
      timestamp: m.timestamp,
      content: m.content,
      link,
      mentionsSaransh: m.mentions.some((u) => u.id === config.userId),
      fromSaransh: m.author.id === config.userId,
      prdFiles: prdFiles.map((a) => a.filename),
      prdLinks: loginLinks(m.content),
    }
  })
}

/** `filename`, or when the inbox holds a file by that name, the first free `name (n).ext`. */
function freeName(filename: string): string {
  const { name, ext } = parse(filename)
  let free = filename
  for (let n = 2; existsSync(join(prdInboxDir(), free)); n++) free = `${name} (${n})${ext}`
  return free
}

/** Downloads each attached PRD file from Discord's CDN into the PRD inbox, recording the message it came from. */
async function saveToInbox(files: Attached[]): Promise<void> {
  const sourcesFile = join(prdInboxDir(), 'sources.json')
  const sources = existsSync(sourcesFile) ? readJson<InboxSources>(sourcesFile) : {}
  for (const { attachment, message } of files) {
    if (Object.values(sources).some((s) => s.attachment === attachment.id)) {
      console.log(`${attachment.filename} from ${message} is in the PRD inbox already`)
      continue
    }
    // The URL is signed, so it needs no bot token, and the token stays with Discord's API.
    const response = await fetch(attachment.url)
    if (!response.ok) throw new Error(`Discord's CDN answered ${response.status} for ${attachment.filename} from ${message}`)
    const file = freeName(attachment.filename)
    mkdirSync(prdInboxDir(), { recursive: true })
    writeFileSync(join(prdInboxDir(), file), Buffer.from(await response.arrayBuffer()))
    sources[file] = { message, attachment: attachment.id }
    writeJson(sourcesFile, sources)
    console.log(`Saved ${file} from ${message} into the PRD inbox`)
  }
}

/** Discord lists active threads per server, not per channel, so each server's are asked for once. */
const activeThreads = new Map<string, ApiThread[]>()

/** A channel's threads that can hold messages posted since `since`: its active ones, and those archived since. */
async function threadsOf(config: DiscordConfig, channel: ApiChannel, { since }: Window): Promise<ApiThread[]> {
  if (!activeThreads.has(channel.guild_id)) {
    activeThreads.set(channel.guild_id, (await get<{ threads: ApiThread[] }>(config, `/guilds/${channel.guild_id}/threads/active`)).threads)
  }
  const active = activeThreads.get(channel.guild_id)!.filter((t) => t.parent_id === channel.id)
  const { threads: archived } = await get<{ threads: ApiThread[] }>(config, `/channels/${channel.id}/threads/archived/public`, { limit: '100' })
  return [...active, ...archived.filter((t) => Date.parse(t.thread_metadata.archive_timestamp) >= Date.parse(since))]
}

async function readChannel(config: DiscordConfig, channelId: string, window: Window): Promise<DiscordMessage[]> {
  const channel = await get<ApiChannel | ApiDm>(config, `/channels/${channelId}`)
  if (channel.guild_id === undefined) {
    if (!config.readDms) throw new Error(`Channel ${channelId} is a DM, and DISCORD_READ_DMS is false. Remove it from DISCORD_CHANNEL_IDS, or turn DMs on.`)
    return readMessages(config, { id: channel.id, channel: channel.recipients.map(displayName).join(', '), thread: null, dm: true, guild: '@me' }, window)
  }
  const at: Conversation = { id: channel.id, channel: channel.name, thread: null, dm: false, guild: channel.guild_id }
  const messages = await readMessages(config, at, window)
  for (const thread of await threadsOf(config, channel, window)) messages.push(...(await readMessages(config, { ...at, id: thread.id, thread: thread.name }, window)))
  return messages
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
  // A forced re-read starts where this Run's read did, since that read has moved the read time on.
  const since = earlier?.since ?? readDiscordState()?.lastRead ?? new Date(now.getTime() - firstRunHours * 60 * 60 * 1000).toISOString()
  const messages: DiscordMessage[] = []
  for (const channelId of config.channelIds) messages.push(...(await readChannel(config, channelId, { since, until })))
  messages.sort((a, b) => (BigInt(a.id) < BigInt(b.id) ? -1 : 1))
  const dryRun = readRun(runId).dryRun
  if (!dryRun) await saveToInbox(attached)
  writeJson(out, { since, until, messages } satisfies DiscordRead)
  console.log(`Read ${messages.length} Discord messages since ${since}, ${messages.filter((m) => m.mentionsSaransh).length} mentioning Saransh`)
  if (dryRun) console.log('A dry run, so nothing went into the PRD inbox, and the next real Run reads these messages again')
  else writeDiscordState({ lastRead: until })
})
