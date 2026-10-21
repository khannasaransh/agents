// The fake Worker: answers Agent calls with canned answers instead of starting a CLI, for tests
// and dry runs. Canned answers come from the JSON file named by AGENTS_FAKE_ANSWERS, listed per
// Agent; the first whose `when` matches the call's inputs is used. Without one, it gives the
// smallest answer the Agent's output schema allows.
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { readJson } from '../files.ts'
import type { JsonSchema } from '../schema.ts'
import type { Worker } from '../worker.ts'

export interface CannedAnswer {
  when?: Record<string, unknown>
  answer?: unknown
  /** Answer with the JSON in this file of the folder the call runs in, as if the Agent read it there. */
  answerFrom?: string
  /** Fail the call with this message, as a quota limit or crash would. */
  error?: string
}

function cannedAnswers(): Record<string, CannedAnswer[]> {
  const file = process.env.AGENTS_FAKE_ANSWERS
  return file && existsSync(file) ? readJson(file) : {}
}

export const fakeWorker: Worker = {
  name: 'fake',
  async call(agent, inputs, { cwd }) {
    const canned = cannedAnswers()[agent.name]?.find((c) => Object.entries(c.when ?? {}).every(([key, value]) => inputs[key] === value))
    if (!canned) return smallestAnswer(agent.config.outputSchema ?? { type: 'string' })
    if (canned.error) throw new Error(canned.error)
    return canned.answerFrom ? readJson(join(cwd, canned.answerFrom)) : canned.answer
  },
}

/** The smallest value `schema` allows: no optional fields, empty lists, and the first choice of each enum. */
function smallestAnswer(schema: JsonSchema): unknown {
  if (schema.enum) return schema.enum[0]
  switch ([schema.type].flat()[0]) {
    case 'object':
      return Object.fromEntries((schema.required ?? []).map((key) => [key, smallestAnswer(schema.properties?.[key] ?? {})]))
    case 'array':
      return []
    case 'integer':
    case 'number':
      return 0
    case 'boolean':
      return false
    case 'null':
      return null
    default:
      return 'Answered by the fake Worker.'
  }
}
