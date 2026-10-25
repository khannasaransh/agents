import { existsSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'
import { parseEnv } from 'node:util'
import { agentsRoot } from './paths.ts'

/** The local env file: .env in this repo, never committed, or the file named by AGENTS_ENV_FILE. */
function readEnvFile(): Record<string, string | undefined> {
  const file = process.env.AGENTS_ENV_FILE ?? join(agentsRoot, '.env')
  return existsSync(file) ? parseEnv(readFileSync(file, 'utf8')) : {}
}

/**
 * What the Discord Step reads with: a bot's token, never Saransh's own, the channels it watches, and
 * Saransh's Discord user ID. A bot sees only its own DMs, so a DM here is one with the bot.
 */
export interface DiscordConfig {
  token: string
  channelIds: string[]
  userId: string
  /** Whether a DM with the bot among the channels is read, or fails the Step. On unless DISCORD_READ_DMS=false. */
  readDms: boolean
}

/** The Discord config from the env file, or the keys it is missing. */
export function discordConfig(): DiscordConfig | { missing: string[] } {
  const env = readEnvFile()
  const token = env.DISCORD_BOT_TOKEN?.trim() ?? ''
  const channelIds = (env.DISCORD_CHANNEL_IDS ?? '')
    .split(',')
    .map((id) => id.trim())
    .filter(Boolean)
  const userId = env.DISCORD_USER_ID?.trim() ?? ''
  const missing = [!token && 'DISCORD_BOT_TOKEN', !channelIds.length && 'DISCORD_CHANNEL_IDS', !userId && 'DISCORD_USER_ID'].filter((key) => key !== false)
  const readDms = env.DISCORD_READ_DMS?.trim().toLowerCase() !== 'false'
  return missing.length ? { missing } : { token, channelIds, userId, readDms }
}

/** Saransh's own checkout of the org wiki, from WIKI_FOLDER in the env file, or null when it isn't set. `~` stands for the home folder. */
export function wikiFolder(): string | null {
  const folder = readEnvFile().WIKI_FOLDER?.trim()
  return folder ? folder.replace(/^~(?=\/|$)/, homedir()) : null
}

/** Saransh's git author emails, lowercased, from SARANSH_GIT_EMAILS (comma-separated) in the env file. */
export function saranshEmails(): string[] {
  return (readEnvFile().SARANSH_GIT_EMAILS ?? '')
    .split(',')
    .map((email) => email.trim().toLowerCase())
    .filter(Boolean)
}

/**
 * ash_new's folder, from ASH_NEW_FOLDER in the env file (`~` stands for the home folder), else
 * backend/portfolio-dashboard in the folder holding this repo, where setup's layout puts it.
 */
export function ashNewFolder(): string {
  const folder = readEnvFile().ASH_NEW_FOLDER?.trim()
  return folder ? folder.replace(/^~(?=[\\/]|$)/, homedir()) : resolve(agentsRoot, '..', 'backend', 'portfolio-dashboard')
}
