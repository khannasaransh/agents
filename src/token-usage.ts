/** Normalized token counts. Input includes cache reads and writes; neither is added to total again. */
export interface TokenUsage {
  inputTokens: number
  outputTokens: number
  cacheReadTokens: number | null
  cacheWriteTokens: number | null
  totalTokens: number
  /** False when the process ended before final usage was available. */
  complete: boolean
}

const count = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
const object = (value: unknown): Record<string, unknown> | null => value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null

function normalized(input: unknown, output: unknown, read: unknown, write: unknown, inclusive: boolean, complete: boolean): TokenUsage | null {
  if (!count(input) || !count(output)) return null
  if ((read !== undefined && !count(read)) || (write !== undefined && !count(write))) return null
  const cacheReadTokens = count(read) ? read : null
  const cacheWriteTokens = count(write) ? write : null
  const inputTokens = input + (inclusive ? 0 : (cacheReadTokens ?? 0) + (cacheWriteTokens ?? 0))
  const totalTokens = inputTokens + output
  if (!count(totalTokens) || (inclusive && (cacheReadTokens ?? 0) + (cacheWriteTokens ?? 0) > inputTokens)) return null
  return { inputTokens, outputTokens: output, cacheReadTokens, cacheWriteTokens, totalTokens, complete }
}

/** Read only the final provider usage, never message-by-message estimates or duplicate cumulative events. */
export function workerTokenUsage(worker: 'codex' | 'claude-code', stdout: string, timedOut = false): TokenUsage | null {
  if (worker === 'codex') {
    const events = stdout.split('\n').flatMap(line => { try { return [object(JSON.parse(line))] } catch { return [] } })
    const event = events.findLast(event => event?.type === 'turn.completed')
    const usage = object(event?.usage)
    if (!usage) return null
    const complete = !timedOut && !events.slice(events.lastIndexOf(event!)+1).some(event => event?.type === 'turn.started' || event?.type === 'turn.failed')
    return normalized(usage.input_tokens, usage.output_tokens, usage.cached_input_tokens, usage.cache_write_input_tokens, true, complete)
  }
  let result: Record<string, unknown> | null
  try { result = object(JSON.parse(stdout)) } catch { return null }
  if (!result) return null
  // modelUsage also covers any nested model work. Do not add result.usage to it.
  const models = object(result.modelUsage)
  if (models && Object.keys(models).length) {
    const usage = Object.values(models).map(value => {
      const model = object(value)
      return model && normalized(model.inputTokens, model.outputTokens, model.cacheReadInputTokens, model.cacheCreationInputTokens, false, !timedOut)
    })
    if (usage.some(item => !item)) return null
    return sumUsage(usage as TokenUsage[])
  }
  const usage = object(result.usage)
  return usage ? normalized(usage.input_tokens, usage.output_tokens, usage.cache_read_input_tokens, usage.cache_creation_input_tokens, false, !timedOut) : null
}

/** Validate persisted log metadata, including zero usage; a missing value is never zero. */
export function readTokenUsage(value: unknown): TokenUsage | null {
  const usage = object(value)
  if (!usage || typeof usage.complete !== 'boolean') return null
  const normalizedUsage = normalized(usage.inputTokens, usage.outputTokens, usage.cacheReadTokens ?? undefined, usage.cacheWriteTokens ?? undefined, true, usage.complete)
  return normalizedUsage && usage.totalTokens === normalizedUsage.totalTokens ? normalizedUsage : null
}

function sumUsage(items: TokenUsage[]): TokenUsage {
  const sum = (key: 'inputTokens' | 'outputTokens' | 'totalTokens') => items.reduce((total,item) => total + item[key],0)
  const optionalSum = (key: 'cacheReadTokens' | 'cacheWriteTokens') => items.every(item => item[key] !== null) ? items.reduce((total,item) => total + (item[key] ?? 0),0) : null
  return { inputTokens:sum('inputTokens'), outputTokens:sum('outputTokens'), totalTokens:sum('totalTokens'), cacheReadTokens:optionalSum('cacheReadTokens'), cacheWriteTokens:optionalSum('cacheWriteTokens'), complete:items.every(item => item.complete) }
}

/** Sum known usage, preserving coverage so a partial subtotal cannot look like a complete run total. */
export function summarizeTokenUsage(attempts: { usage: TokenUsage | null }[]) {
  const recorded = attempts.flatMap(attempt => attempt.usage ? [attempt.usage] : [])
  return {
    attempts: attempts.length,
    recordedAttempts: recorded.length,
    complete: attempts.length > 0 && recorded.length === attempts.length && recorded.every(usage => usage.complete),
    tokens: recorded.length ? sumUsage(recorded) : null,
  }
}
