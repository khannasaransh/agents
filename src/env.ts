import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { parseEnv } from 'node:util'
import { agentsRoot } from './paths.ts'

/** The local env file: .env in this repo, never committed, or the file named by AGENTS_ENV_FILE. */
function readEnvFile(): Record<string, string | undefined> {
  const file = process.env.AGENTS_ENV_FILE ?? join(agentsRoot, '.env')
  return existsSync(file) ? parseEnv(readFileSync(file, 'utf8')) : {}
}

/** Saransh's git author emails, lowercased, from SARANSH_GIT_EMAILS (comma-separated) in the env file. */
export function saranshEmails(): string[] {
  return (readEnvFile().SARANSH_GIT_EMAILS ?? '')
    .split(',')
    .map((email) => email.trim().toLowerCase())
    .filter(Boolean)
}
