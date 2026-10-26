import assert from 'node:assert/strict'
import { afterEach, test } from 'node:test'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { readJson, writeJson } from '../src/files.ts'
import { makeWorkspace, replayDiscord, type RecordedResponse, type Workspace } from './helpers.ts'

let ws: Workspace
/** The files in a folder of the data area, such as the APK inbox. */
const dataFiles = (folder: string) => (existsSync(join(ws.dataDir, folder)) ? readdirSync(join(ws.dataDir, folder)).sort() : [])
let api: Awaited<ReturnType<typeof replayDiscord>> | undefined
let cdn: Awaited<ReturnType<typeof replayDiscord>> | undefined
afterEach(() => {
  ws.cleanup()
  api?.close()
  cdn?.close()
  api = undefined
  cdn = undefined
})

const runId = '2026-10-22-0530'
const guildId = '1029384756473829100'
const saransh = { id: '480123456789012345', username: 'saransh', global_name: 'Saransh', avatar: null, discriminator: '0', public_flags: 0, flags: 0 }
const priya = { id: '590123456789012345', username: 'priya.k', global_name: 'Priya', avatar: null, discriminator: '0', public_flags: 0, flags: 0 }
const envFile = `DISCORD_BOT_TOKEN=bot-token\nDISCORD_CHANNEL_IDS=1100000000000000001\nDISCORD_USER_ID=${saransh.id}\n`

/** The Discord snowflake for a time: milliseconds since Discord's epoch, shifted past the worker, process and increment bits. */
const snowflake = (time: string) => String((BigInt(Date.parse(time)) - 1420070400000n) << 22n)

/** A text channel on the company server, as GET /channels/{id} answers. */
const channel = (id: string, name: string) => ({
  id,
  type: 0,
  guild_id: guildId,
  name,
  position: 3,
  parent_id: '1100000000000000000',
  topic: null,
  last_message_id: null,
  rate_limit_per_user: 0,
  nsfw: false,
  permission_overwrites: [],
  flags: 0,
})

/** A file to attach to a message: its name as Discord gives it, its type and what it holds. */
interface Upload {
  filename: string
  contentType: string
  content: string
}

/**
 * Starts the stand-in for Discord's file CDN serving these files, and gives each as Discord lists it
 * among a message's attachments, at a signed CDN URL.
 */
async function uploaded(channelId: string, ...files: Upload[]) {
  const withIds = files.map((f, n) => ({ ...f, id: String(1400000000000000001n + BigInt(n)) }))
  const path = (f: (typeof withIds)[number]) => `/attachments/${channelId}/${f.id}/${f.filename}`
  cdn = await replayDiscord(Object.fromEntries(withIds.map((f) => [path(f), { body: Buffer.from(f.content) }])))
  return withIds.map((f) => ({
    id: f.id,
    filename: f.filename,
    size: f.content.length,
    url: `${cdn!.url}${path(f)}?ex=6720a0f0&is=671f4f70&hm=3f9a0c`,
    proxy_url: `https://media.discordapp.net${path(f)}?ex=6720a0f0&is=671f4f70&hm=3f9a0c`,
    content_type: f.contentType,
  }))
}

type Attachment = Awaited<ReturnType<typeof uploaded>>[number]

/** A message, as GET /channels/{id}/messages answers, its ID made from its time as Discord's are. */
const message = (channelId: string, time: string, author: typeof saransh, content: string, mentions: (typeof saransh)[] = [], attachments: Attachment[] = []) => ({
  type: 0,
  id: snowflake(time),
  channel_id: channelId,
  author,
  content,
  timestamp: time.replace('Z', '+00:00'),
  edited_timestamp: null,
  tts: false,
  mention_everyone: false,
  mentions,
  mention_roles: [],
  attachments,
  embeds: [],
  pinned: false,
  components: [],
  flags: 0,
})

/** A public thread, as Discord lists it among a server's active threads or a channel's archived ones. */
const thread = (id: string, parentId: string, name: string, archivedAt: string | null = null) => ({
  id,
  type: 11,
  guild_id: guildId,
  parent_id: parentId,
  owner_id: priya.id,
  name,
  last_message_id: null,
  message_count: 1,
  member_count: 2,
  rate_limit_per_user: 0,
  flags: 0,
  total_message_sent: 1,
  thread_metadata: {
    archived: archivedAt !== null,
    auto_archive_duration: 60,
    archive_timestamp: (archivedAt ?? '2026-10-20T08:00:00.000Z').replace('Z', '+00:00'),
    locked: false,
    create_timestamp: '2026-10-20T08:00:00.000+00:00',
  },
})

type Message = ReturnType<typeof message>
const newestFirst = (messages: Message[]) => messages.toSorted((a, b) => (BigInt(b.id) > BigInt(a.id) ? 1 : -1))

/**
 * What Discord answers for a watched channel: the channel and its messages, newest first; the
 * server's active threads and the channel's archived ones; and each thread's messages.
 */
function watched(
  ch: ReturnType<typeof channel>,
  messages: Message[],
  { active = [], archived = [] }: { active?: [ReturnType<typeof thread>, Message[]][]; archived?: [ReturnType<typeof thread>, Message[]][] } = {},
): Record<string, RecordedResponse> {
  return {
    [`/channels/${ch.id}`]: { body: ch },
    [`/channels/${ch.id}/messages`]: { body: newestFirst(messages) },
    [`/guilds/${guildId}/threads/active`]: { body: { threads: active.map(([t]) => t), members: [] } },
    [`/channels/${ch.id}/threads/archived/public`]: { body: { threads: archived.map(([t]) => t), members: [], has_more: false } },
    ...Object.fromEntries([...active, ...archived].map(([t, inThread]) => [`/channels/${t.id}/messages`, { body: newestFirst(inThread) }])),
  }
}

async function workspaceWithDiscord(recording: Record<string, RecordedResponse | RecordedResponse[]>, env = envFile) {
  api = await replayDiscord(recording)
  ws = makeWorkspace({ AGENTS_DISCORD_API_URL: api.url })
  ws.prepareRun(runId)
  ws.writeEnvFile(env)
}

const discord = () => ws.agents('step', 'discord', '--run', runId)
const readMessages = () => JSON.parse(ws.readRunFile(runId, 'discord.json'))

test('without a bot token, channels and user ID in the env file, the Discord Step is recorded as skipped, not failed', async () => {
  ws = makeWorkspace()
  ws.prepareRun(runId)
  ws.writeEnvFile('SARANSH_GIT_EMAILS=saransh@example.com\nDISCORD_BOT_TOKEN=bot-token\n')

  const result = await discord()

  assert.equal(result.status, 0, result.stderr)
  assert.equal(ws.readRun(runId).steps.find((s) => s.name === 'discord')!.status, 'skipped')
  assert.deepEqual(ws.runFiles(runId, ''), ['logs', 'run.json'])
  assert.match(ws.readRunFile(runId, 'logs', 'discord.log'), /DISCORD_CHANNEL_IDS, DISCORD_USER_ID/)
})

test('the Discord Step reads a watched channel since the last successful read as the bot, flags the messages that mention Saransh, and records the new read time', async () => {
  const payments = channel('1100000000000000001', 'payments')
  const ask = message(payments.id, '2026-10-21T09:15:00.000Z', priya, `<@${saransh.id}> can you check the paywall price?`, [saransh])
  const reply = message(payments.id, '2026-10-21T09:40:00.000Z', saransh, 'Looking at it now.')
  await workspaceWithDiscord(watched(payments, [ask, reply]))
  ws.writeDiscordState({ lastRead: '2026-10-21T00:00:00.000Z' })
  const before = new Date().toISOString()

  const result = await discord()

  assert.equal(result.status, 0, result.stderr)
  const after = new Date().toISOString()
  const read = readMessages()
  assert.equal(read.since, '2026-10-21T00:00:00.000Z')
  assert.ok(before <= read.until && read.until <= after, read.until)
  assert.deepEqual(read.messages, [
    {
      id: ask.id,
      channel: 'payments',
      thread: null,
      dm: false,
      author: 'Priya',
      timestamp: '2026-10-21T09:15:00.000+00:00',
      content: `<@${saransh.id}> can you check the paywall price?`,
      link: `https://discord.com/channels/${guildId}/${payments.id}/${ask.id}`,
      mentionsSaransh: true,
      fromSaransh: false,
      prdFiles: [],
      apkFiles: [],
      otherFiles: [],
      prdLinks: [],
    },
    {
      id: reply.id,
      channel: 'payments',
      thread: null,
      dm: false,
      author: 'Saransh',
      timestamp: '2026-10-21T09:40:00.000+00:00',
      content: 'Looking at it now.',
      link: `https://discord.com/channels/${guildId}/${payments.id}/${reply.id}`,
      mentionsSaransh: false,
      fromSaransh: true,
      prdFiles: [],
      apkFiles: [],
      otherFiles: [],
      prdLinks: [],
    },
  ])
  assert.deepEqual(ws.readDiscordState(), { lastRead: read.until })
  const messagesRequest = api!.requests.find((r) => r.path === `/channels/${payments.id}/messages`)
  assert.deepEqual(messagesRequest?.query, { after: snowflake('2026-10-21T00:00:00.000Z'), limit: '100' })
  assert.ok(api!.requests.every((r) => r.method === 'GET' && r.authorization === 'Bot bot-token'))
})

test("the Discord Step reads a watched channel's active threads and those archived since the last read, and no other threads", async () => {
  const payments = channel('1100000000000000001', 'payments')
  const launch = thread('1200000000000000001', payments.id, 'Paywall launch')
  const priceBug = thread('1200000000000000002', payments.id, 'Price bug', '2026-10-21T12:00:00.000Z')
  const oldThread = thread('1200000000000000003', payments.id, 'Last quarter', '2026-10-01T12:00:00.000Z')
  const elsewhere = thread('1200000000000000004', '1100000000000000009', 'Not watched')
  const inLaunch = message(launch.id, '2026-10-21T10:00:00.000Z', priya, `<@${saransh.id}> does this ship Friday?`, [saransh])
  const inPriceBug = message(priceBug.id, '2026-10-21T11:00:00.000Z', priya, 'Fixed on staging.')
  await workspaceWithDiscord(
    watched(payments, [], {
      active: [
        [launch, [inLaunch]],
        [elsewhere, []],
      ],
      archived: [
        [priceBug, [inPriceBug]],
        [oldThread, []],
      ],
    }),
  )
  ws.writeDiscordState({ lastRead: '2026-10-21T00:00:00.000Z' })

  const result = await discord()

  assert.equal(result.status, 0, result.stderr)
  assert.deepEqual(
    readMessages().messages.map((m: any) => [m.channel, m.thread, m.content, m.mentionsSaransh, m.link]),
    [
      ['payments', 'Paywall launch', inLaunch.content, true, `https://discord.com/channels/${guildId}/${launch.id}/${inLaunch.id}`],
      ['payments', 'Price bug', 'Fixed on staging.', false, `https://discord.com/channels/${guildId}/${priceBug.id}/${inPriceBug.id}`],
    ],
  )
  const asked = api!.requests.map((r) => r.path)
  assert.ok(!asked.includes(`/channels/${oldThread.id}/messages`), asked.join('\n'))
  assert.ok(!asked.includes(`/channels/${elsewhere.id}/messages`), asked.join('\n'))
})

test('the Discord Step asks for archived threads a page at a time, until a page reaches threads archived before the last read', async () => {
  const payments = channel('1100000000000000001', 'payments')
  const latest = thread('1200000000000000001', payments.id, 'Paywall launch', '2026-10-21T15:00:00.000Z')
  const second = thread('1200000000000000002', payments.id, 'Price bug', '2026-10-21T12:00:00.000Z')
  const older = thread('1200000000000000003', payments.id, 'Last quarter', '2026-10-01T12:00:00.000Z')
  const inSecond = message(second.id, '2026-10-21T11:00:00.000Z', priya, `<@${saransh.id}> the PRD is attached`, [saransh])
  const archivedPath = `/channels/${payments.id}/threads/archived/public`
  await workspaceWithDiscord({
    ...watched(payments, [], {
      archived: [
        [latest, []],
        [second, [inSecond]],
        [older, []],
      ],
    }),
    [archivedPath]: [{ body: { threads: [latest], members: [], has_more: true } }, { body: { threads: [second, older], members: [], has_more: true } }],
  })
  ws.writeDiscordState({ lastRead: '2026-10-21T00:00:00.000Z' })

  const result = await discord()

  assert.equal(result.status, 0, result.stderr)
  assert.deepEqual(
    readMessages().messages.map((m: any) => [m.thread, m.content]),
    [['Price bug', inSecond.content]],
  )
  const pages = api!.requests.filter((r) => r.path === archivedPath).map((r) => r.query)
  assert.deepEqual(pages, [{ limit: '100' }, { limit: '100', before: latest.thread_metadata.archive_timestamp }])
  assert.ok(!api!.requests.some((r) => r.path === `/channels/${older.id}/messages`))
})

test('the Discord Step waits out a rate limit and asks again', async () => {
  const payments = channel('1100000000000000001', 'payments')
  const ask = message(payments.id, '2026-10-21T09:15:00.000Z', priya, 'Is the paywall live?')
  const recording = watched(payments, [ask])
  const messagesPath = `/channels/${payments.id}/messages`
  await workspaceWithDiscord({
    ...recording,
    [messagesPath]: [
      { status: 429, headers: { 'retry-after': '1', 'x-ratelimit-scope': 'user' }, body: { message: 'You are being rate limited.', retry_after: 0.4, global: false } },
      recording[messagesPath],
    ],
  })
  ws.writeDiscordState({ lastRead: '2026-10-21T00:00:00.000Z' })

  const result = await discord()

  assert.equal(result.status, 0, result.stderr)
  assert.deepEqual(
    readMessages().messages.map((m: any) => m.content),
    ['Is the paywall live?'],
  )
  const [limited, retried, ...more] = api!.requests.filter((r) => r.path === messagesPath)
  assert.deepEqual(more, [])
  assert.ok(retried.at - limited.at >= 400, `asked again after ${retried.at - limited.at}ms`)
})

test('the Discord Step reads every page of a busy channel, a hundred messages at a time', async () => {
  const payments = channel('1100000000000000001', 'payments')
  const minute = (n: number) => new Date(Date.parse('2026-10-21T01:00:00.000Z') + n * 60_000).toISOString()
  const all = Array.from({ length: 103 }, (_, n) => message(payments.id, minute(n), priya, `Message ${n}`))
  const messagesPath = `/channels/${payments.id}/messages`
  // Asked for the messages after an ID, Discord answers with the oldest of them, newest first.
  await workspaceWithDiscord({ ...watched(payments, []), [messagesPath]: [{ body: newestFirst(all.slice(0, 100)) }, { body: newestFirst(all.slice(100)) }] })
  ws.writeDiscordState({ lastRead: '2026-10-21T00:00:00.000Z' })

  const result = await discord()

  assert.equal(result.status, 0, result.stderr)
  assert.deepEqual(
    readMessages().messages.map((m: any) => m.content),
    all.map((m) => m.content),
  )
  const pages = api!.requests.filter((r) => r.path === messagesPath)
  assert.deepEqual(
    pages.map((r) => r.query.after),
    [snowflake('2026-10-21T00:00:00.000Z'), all[99].id],
  )
})

test('a message posted after the read began is left for the next Run, which starts where this read ended', async () => {
  const payments = channel('1100000000000000001', 'payments')
  const earlier = message(payments.id, '2026-10-21T09:15:00.000Z', priya, 'Is the paywall live?')
  // Discord answers with every message there is by the time it is asked, however late.
  const later = message(payments.id, '2099-01-01T00:00:00.000Z', priya, 'Posted while the Step was reading.')
  await workspaceWithDiscord(watched(payments, [earlier, later]))
  ws.writeDiscordState({ lastRead: '2026-10-21T00:00:00.000Z' })

  const result = await discord()

  assert.equal(result.status, 0, result.stderr)
  assert.deepEqual(
    readMessages().messages.map((m: any) => m.content),
    ['Is the paywall live?'],
  )
})

/** A DM with the bot, as GET /channels/{id} answers: it belongs to no server, and lists who the bot talks to there. */
const dmWith = (id: string, user: typeof saransh) => ({ id, type: 1, last_message_id: null, flags: 0, recipients: [user] })

test('a DM with the bot among the configured channels is read by default, with no threads to ask for', async () => {
  const payments = channel('1100000000000000001', 'payments')
  const dm = dmWith('1300000000000000001', priya)
  const ask = message(dm.id, '2026-10-21T09:20:00.000Z', priya, 'Can Saransh look at the refund flow?')
  await workspaceWithDiscord(
    {
      ...watched(payments, []),
      [`/channels/${dm.id}`]: { body: dm },
      [`/channels/${dm.id}/messages`]: { body: [ask] },
    },
    envFile.replace(/^DISCORD_CHANNEL_IDS=.*$/m, `DISCORD_CHANNEL_IDS=${payments.id},${dm.id}`),
  )
  ws.writeDiscordState({ lastRead: '2026-10-21T00:00:00.000Z' })

  const result = await discord()

  assert.equal(result.status, 0, result.stderr)
  assert.deepEqual(readMessages().messages, [
    {
      id: ask.id,
      channel: 'Priya',
      thread: null,
      dm: true,
      author: 'Priya',
      timestamp: '2026-10-21T09:20:00.000+00:00',
      content: 'Can Saransh look at the refund flow?',
      link: `https://discord.com/channels/@me/${dm.id}/${ask.id}`,
      mentionsSaransh: false,
      fromSaransh: false,
      prdFiles: [],
      apkFiles: [],
      otherFiles: [],
      prdLinks: [],
    },
  ])
  const asked = api!.requests.map((r) => r.path)
  assert.deepEqual(
    asked.filter((path) => path.includes(dm.id) || path.includes('undefined')),
    [`/channels/${dm.id}`, `/channels/${dm.id}/messages`],
  )
})

test('with DISCORD_READ_DMS=false a DM among the configured channels is never read: the Step fails before asking for its messages, and the read time stays where it was', async () => {
  const payments = channel('1100000000000000001', 'payments')
  const dm = dmWith('1300000000000000001', saransh)
  await workspaceWithDiscord(
    {
      ...watched(payments, [message(payments.id, '2026-10-21T09:15:00.000Z', priya, 'Is the paywall live?')]),
      [`/channels/${dm.id}`]: { body: dm },
      [`/channels/${dm.id}/messages`]: { body: [message(dm.id, '2026-10-21T09:20:00.000Z', saransh, 'A private message')] },
    },
    `${envFile.replace(/^DISCORD_CHANNEL_IDS=.*$/m, `DISCORD_CHANNEL_IDS=${payments.id},${dm.id}`)}DISCORD_READ_DMS=false\n`,
  )
  ws.writeDiscordState({ lastRead: '2026-10-21T00:00:00.000Z' })

  const result = await discord()

  assert.equal(result.status, 1)
  assert.match(ws.readRunFile(runId, 'logs', 'discord.log'), new RegExp(`${dm.id} is a DM`))
  assert.ok(!api!.requests.some((r) => r.path === `/channels/${dm.id}/messages`))
  assert.ok(!ws.runFiles(runId, '').includes('discord.json'))
  assert.deepEqual(ws.readDiscordState(), { lastRead: '2026-10-21T00:00:00.000Z' })
})

test("a dry run reads Discord but leaves the read time, so the next real Run covers the same messages", async () => {
  const payments = channel('1100000000000000001', 'payments')
  await workspaceWithDiscord(watched(payments, [message(payments.id, '2026-10-21T09:15:00.000Z', priya, 'Is the paywall live?')]))
  ws.prepareRun(runId, { dryRun: true })
  ws.writeDiscordState({ lastRead: '2026-10-21T00:00:00.000Z' })

  const result = await discord()

  assert.equal(result.status, 0, result.stderr)
  assert.deepEqual(
    readMessages().messages.map((m: any) => m.content),
    ['Is the paywall live?'],
  )
  assert.deepEqual(ws.readDiscordState(), { lastRead: '2026-10-21T00:00:00.000Z' })
})

test("re-running the Discord Step after it read asks Discord nothing, unless forced, when it reads the Run's window again", async () => {
  const payments = channel('1100000000000000001', 'payments')
  await workspaceWithDiscord(watched(payments, [message(payments.id, '2026-10-21T09:15:00.000Z', priya, 'Is the paywall live?')]))
  ws.writeDiscordState({ lastRead: '2026-10-21T00:00:00.000Z' })
  await discord()
  const first = readMessages()
  api!.requests.length = 0

  const rerun = await discord()

  assert.equal(rerun.status, 0, rerun.stderr)
  assert.equal(api!.requests.length, 0)
  assert.deepEqual(readMessages(), first)

  const forced = await ws.agents('step', 'discord', '--run', runId, '--force')

  assert.equal(forced.status, 0, forced.stderr)
  const reread = readMessages()
  assert.equal(reread.since, '2026-10-21T00:00:00.000Z')
  assert.deepEqual(reread.messages, first.messages)
  assert.equal(api!.requests.find((r) => r.path === `/channels/${payments.id}/messages`)?.query.after, snowflake('2026-10-21T00:00:00.000Z'))
  assert.deepEqual(ws.readDiscordState(), { lastRead: reread.until })
})

test("the weekly Pipeline's first Discord read covers the last 7 days and leaves the daily read time", async () => {
  const payments = channel('1100000000000000001', 'payments')
  await workspaceWithDiscord(watched(payments, []))
  ws.writeDiscordState({ lastRead: '2026-10-01T00:00:00.000Z' })
  ws.prepareRun(runId, { pipeline: 'weekly' })
  const weekAgo = () => new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString()
  const earliest = weekAgo()

  const result = await discord()

  assert.equal(result.status, 0, result.stderr)
  const latest = weekAgo()
  const { since, until } = readMessages()
  assert.ok(earliest <= since && since <= latest, since)
  assert.equal(api!.requests.find((r) => r.path === `/channels/${payments.id}/messages`)?.query.after, snowflake(since))
  assert.deepEqual(ws.readDiscordState(), { lastRead: '2026-10-01T00:00:00.000Z' })
  assert.deepEqual(readJson(join(ws.dataDir, 'state', 'weekly-discord.json')), { lastRead: until })
})

test('the weekly Pipeline reads Discord since its own last read, not the daily one', async () => {
  const payments = channel('1100000000000000001', 'payments')
  await workspaceWithDiscord(watched(payments, []))
  ws.writeDiscordState({ lastRead: '2026-10-01T00:00:00.000Z' })
  writeJson(join(ws.dataDir, 'state', 'weekly-discord.json'), { lastRead: '2026-10-20T00:00:00.000Z' })
  ws.prepareRun(runId, { pipeline: 'weekly' })

  const result = await discord()

  assert.equal(result.status, 0, result.stderr)
  assert.equal(readMessages().since, '2026-10-20T00:00:00.000Z')
  assert.deepEqual(ws.readDiscordState(), { lastRead: '2026-10-01T00:00:00.000Z' })
})

test('on the first Run the Discord Step covers the last 24 hours', async () => {
  const payments = channel('1100000000000000001', 'payments')
  await workspaceWithDiscord(watched(payments, []))
  const dayAgo = () => new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()
  const earliest = dayAgo()

  const result = await discord()

  assert.equal(result.status, 0, result.stderr)
  const latest = dayAgo()
  const { since } = readMessages()
  assert.ok(earliest <= since && since <= latest, since)
  const messagesRequest = api!.requests.find((r) => r.path === `/channels/${payments.id}/messages`)
  assert.equal(messagesRequest?.query.after, snowflake(since))
})

test('a PDF attached in a watched channel is saved into the PRD inbox, with the link of the message it came from', async () => {
  const payments = channel('1100000000000000001', 'payments')
  const [pdf] = await uploaded(payments.id, { filename: 'Paywall_PRD.pdf', contentType: 'application/pdf', content: '%PDF-1.7\nThe paywall PRD' })
  const post = message(payments.id, '2026-10-21T09:15:00.000Z', priya, 'PRD for the paywall', [], [pdf])
  await workspaceWithDiscord(watched(payments, [post]))
  ws.writeDiscordState({ lastRead: '2026-10-21T00:00:00.000Z' })

  const result = await discord()

  assert.equal(result.status, 0, result.stderr)
  assert.deepEqual(ws.prdInboxFiles(), ['Paywall_PRD.pdf', 'sources.json'])
  assert.equal(ws.readPrdInboxFile('Paywall_PRD.pdf'), '%PDF-1.7\nThe paywall PRD')
  assert.deepEqual(JSON.parse(ws.readPrdInboxFile('sources.json')), {
    'Paywall_PRD.pdf': { message: `https://discord.com/channels/${guildId}/${payments.id}/${post.id}`, attachment: pdf.id },
  })
  assert.ok(cdn!.requests.length && cdn!.requests.every((r) => r.authorization === undefined), 'the bot token never goes to the CDN')
})

test('only Word, PDF and Markdown attachments go into the PRD inbox, APKs go into the APK inbox, and every other file into the other folder', async () => {
  const payments = channel('1100000000000000001', 'payments')
  const files = await uploaded(
    payments.id,
    { filename: 'Refunds.docx', contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', content: 'PK refunds' },
    { filename: 'Old_checkout.doc', contentType: 'application/msword', content: 'old checkout' },
    { filename: 'Wallet.PDF', contentType: 'application/pdf', content: '%PDF-1.4 wallet' },
    { filename: 'onboarding.md', contentType: 'text/markdown; charset=utf-8', content: '# Onboarding' },
    { filename: 'screenshot.png', contentType: 'image/png', content: 'PNG' },
    { filename: 'designs.zip', contentType: 'application/zip', content: 'PK designs' },
    { filename: 'inshorts-release-4.2.0.apk', contentType: 'application/vnd.android.package-archive', content: 'PK apk' },
    { filename: 'inshorts-4.2.0.AAB', contentType: 'application/octet-stream', content: 'PK bundle' },
  )
  const post = message(payments.id, '2026-10-21T09:15:00.000Z', priya, 'Specs, designs and builds', [], files)
  await workspaceWithDiscord(watched(payments, [post]))
  ws.writeDiscordState({ lastRead: '2026-10-21T00:00:00.000Z' })

  const result = await discord()

  assert.equal(result.status, 0, result.stderr)
  assert.deepEqual(ws.prdInboxFiles(), ['Old_checkout.doc', 'Refunds.docx', 'Wallet.PDF', 'onboarding.md', 'sources.json'])
  assert.deepEqual(dataFiles('apk-inbox'), ['inshorts-4.2.0.AAB', 'inshorts-release-4.2.0.apk', 'sources.json'])
  assert.equal(readFileSync(join(ws.dataDir, 'apk-inbox', 'inshorts-release-4.2.0.apk'), 'utf8'), 'PK apk')
  assert.deepEqual(dataFiles('other'), ['designs.zip', 'screenshot.png', 'sources.json'])
  const link = `https://discord.com/channels/${guildId}/${payments.id}/${post.id}`
  assert.deepEqual(readJson(join(ws.dataDir, 'other', 'sources.json')), {
    'screenshot.png': { message: link, attachment: files[4].id },
    'designs.zip': { message: link, attachment: files[5].id },
  })
  const [read] = readMessages().messages
  assert.deepEqual([read.prdFiles, read.apkFiles, read.otherFiles], [
    ['Refunds.docx', 'Old_checkout.doc', 'Wallet.PDF', 'onboarding.md'],
    ['inshorts-release-4.2.0.apk', 'inshorts-4.2.0.AAB'],
    ['screenshot.png', 'designs.zip'],
  ])
})

test('an APK already in the APK inbox from an earlier Run is not saved again', async () => {
  const payments = channel('1100000000000000001', 'payments')
  const [apk] = await uploaded(payments.id, { filename: 'inshorts.apk', contentType: 'application/vnd.android.package-archive', content: 'PK apk' })
  const post = message(payments.id, '2026-10-21T09:15:00.000Z', priya, 'Build to test', [], [apk])
  await workspaceWithDiscord(watched(payments, [post]))
  ws.writeDiscordState({ lastRead: '2026-10-21T00:00:00.000Z' })
  writeJson(join(ws.dataDir, 'apk-inbox', 'sources.json'), { 'tested/inshorts.apk': { message: `https://discord.com/channels/${guildId}/${payments.id}/${post.id}`, attachment: apk.id } })

  const result = await discord()

  assert.equal(result.status, 0, result.stderr)
  assert.deepEqual(dataFiles('apk-inbox'), ['sources.json'])
  assert.equal(cdn!.requests.length, 0)
})

test('a file already in the PRD inbox from an earlier Run is not saved again', async () => {
  const payments = channel('1100000000000000001', 'payments')
  const [pdf] = await uploaded(payments.id, { filename: 'Paywall_PRD.pdf', contentType: 'application/pdf', content: '%PDF-1.7\nThe paywall PRD' })
  await workspaceWithDiscord(watched(payments, [message(payments.id, '2026-10-21T09:15:00.000Z', priya, 'PRD for the paywall', [], [pdf])]))
  ws.writeDiscordState({ lastRead: '2026-10-21T00:00:00.000Z' })
  await discord()
  const sources = ws.readPrdInboxFile('sources.json')
  // As after an earlier Run whose read failed once the file was saved, so the read time stayed.
  ws.writeDiscordState({ lastRead: '2026-10-21T00:00:00.000Z' })
  ws.prepareRun('2026-10-23-0530')

  const result = await ws.agents('step', 'discord', '--run', '2026-10-23-0530')

  assert.equal(result.status, 0, result.stderr)
  assert.deepEqual(ws.prdInboxFiles(), ['Paywall_PRD.pdf', 'sources.json'])
  assert.equal(ws.readPrdInboxFile('sources.json'), sources)
  assert.equal(cdn!.requests.length, 1)
})

test('a file the Docs Agent has moved out of the PRD inbox, into done/ or skipped/, is not saved again', async () => {
  const payments = channel('1100000000000000001', 'payments')
  const [pdf] = await uploaded(payments.id, { filename: 'Paywall_PRD.pdf', contentType: 'application/pdf', content: '%PDF-1.7\nThe paywall PRD' })
  const post = message(payments.id, '2026-10-21T09:15:00.000Z', priya, 'PRD for the paywall', [], [pdf])
  await workspaceWithDiscord(watched(payments, [post]))
  ws.writeDiscordState({ lastRead: '2026-10-21T00:00:00.000Z' })
  const sources = { 'done/Paywall_PRD.pdf': { message: `https://discord.com/channels/${guildId}/${payments.id}/${post.id}`, attachment: pdf.id } }
  ws.writePrdInboxFile('done/Paywall_PRD.pdf', '%PDF-1.7\nThe paywall PRD')
  ws.writePrdInboxFile('sources.json', JSON.stringify(sources))

  const result = await discord()

  assert.equal(result.status, 0, result.stderr)
  assert.deepEqual(ws.prdInboxFiles(), ['done', 'sources.json'])
  assert.deepEqual(JSON.parse(ws.readPrdInboxFile('sources.json')), sources)
  assert.equal(cdn!.requests.length, 0)
})

test('a file Saransh dropped into the PRD inbox by hand is kept, and a different one from Discord with the same name gets a numbered name', async () => {
  const payments = channel('1100000000000000001', 'payments')
  const [pdf] = await uploaded(payments.id, { filename: 'Paywall_PRD.pdf', contentType: 'application/pdf', content: '%PDF-1.7\nThe paywall PRD, v2' })
  const post = message(payments.id, '2026-10-21T09:15:00.000Z', priya, 'Updated paywall PRD', [], [pdf])
  await workspaceWithDiscord(watched(payments, [post]))
  ws.writeDiscordState({ lastRead: '2026-10-21T00:00:00.000Z' })
  ws.writePrdInboxFile('Paywall_PRD.pdf', '%PDF-1.7\nThe paywall PRD, downloaded by hand')

  const result = await discord()

  assert.equal(result.status, 0, result.stderr)
  assert.deepEqual(ws.prdInboxFiles(), ['Paywall_PRD (2).pdf', 'Paywall_PRD.pdf', 'sources.json'])
  assert.equal(ws.readPrdInboxFile('Paywall_PRD.pdf'), '%PDF-1.7\nThe paywall PRD, downloaded by hand')
  assert.equal(ws.readPrdInboxFile('Paywall_PRD (2).pdf'), '%PDF-1.7\nThe paywall PRD, v2')
  assert.deepEqual(JSON.parse(ws.readPrdInboxFile('sources.json')), {
    'Paywall_PRD (2).pdf': { message: `https://discord.com/channels/${guildId}/${payments.id}/${post.id}`, attachment: pdf.id },
  })
})

test('links to documents that need a login, such as Google Docs, are recorded with the message they came from, for the To-dos', async () => {
  const payments = channel('1100000000000000001', 'payments')
  const launch = thread('1200000000000000001', payments.id, 'Paywall launch')
  const docs = message(
    payments.id,
    '2026-10-21T09:15:00.000Z',
    priya,
    'PRD: https://docs.google.com/document/d/1AbC/edit?usp=sharing and the sheet <https://drive.google.com/file/d/9XyZ/view>, code at https://github.com/NewsInShorts/payments/pull/12',
  )
  const wiki = message(launch.id, '2026-10-21T10:00:00.000Z', priya, 'Specs: https://inshorts.atlassian.net/wiki/spaces/PAY/pages/42, https://inshorts.notion.site/Wallet-3f2e and https://inshorts.sharepoint.com/:w:/s/pay/Refunds.')
  const lookalike = message(payments.id, '2026-10-21T11:00:00.000Z', priya, 'Not a doc: https://docs.google.com.example.net/document/d/1AbC')
  const malformed = message(payments.id, '2026-10-21T11:30:00.000Z', priya, 'Half a link: https://% and the doc https://docs.google.com/document/d/2DeF')
  await workspaceWithDiscord(watched(payments, [docs, lookalike, malformed], { active: [[launch, [wiki]]] }))
  ws.writeDiscordState({ lastRead: '2026-10-21T00:00:00.000Z' })

  const result = await discord()

  assert.equal(result.status, 0, result.stderr)
  assert.deepEqual(
    readMessages().messages.map((m: any) => [m.link, m.prdLinks]),
    [
      [`https://discord.com/channels/${guildId}/${payments.id}/${docs.id}`, ['https://docs.google.com/document/d/1AbC/edit?usp=sharing', 'https://drive.google.com/file/d/9XyZ/view']],
      [
        `https://discord.com/channels/${guildId}/${launch.id}/${wiki.id}`,
        ['https://inshorts.atlassian.net/wiki/spaces/PAY/pages/42', 'https://inshorts.notion.site/Wallet-3f2e', 'https://inshorts.sharepoint.com/:w:/s/pay/Refunds'],
      ],
      [`https://discord.com/channels/${guildId}/${payments.id}/${lookalike.id}`, []],
      [`https://discord.com/channels/${guildId}/${payments.id}/${malformed.id}`, ['https://docs.google.com/document/d/2DeF']],
    ],
  )
  assert.deepEqual(ws.prdInboxFiles(), [])
  assert.ok(ws.readDiscordState())
})

test('a dry run lists the PRD files attached in discord.json but saves nothing into the PRD inbox', async () => {
  const payments = channel('1100000000000000001', 'payments')
  const [pdf, png] = await uploaded(
    payments.id,
    { filename: 'Paywall_PRD.pdf', contentType: 'application/pdf', content: '%PDF-1.7\nThe paywall PRD' },
    { filename: 'screenshot.png', contentType: 'image/png', content: 'PNG' },
  )
  await workspaceWithDiscord(watched(payments, [message(payments.id, '2026-10-21T09:15:00.000Z', priya, 'PRD for the paywall', [], [pdf, png])]))
  ws.prepareRun(runId, { dryRun: true })
  ws.writeDiscordState({ lastRead: '2026-10-21T00:00:00.000Z' })

  const result = await discord()

  assert.equal(result.status, 0, result.stderr)
  assert.deepEqual(
    readMessages().messages.map((m: any) => [m.prdFiles, m.otherFiles]),
    [[['Paywall_PRD.pdf'], ['screenshot.png']]],
  )
  assert.deepEqual(ws.prdInboxFiles(), [])
  assert.deepEqual(dataFiles('other'), [])
  assert.equal(cdn!.requests.length, 0)
})
