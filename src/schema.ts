/**
 * The part of JSON Schema that Agent configs and output schemas use. Output schemas stay within
 * what the Workers' CLIs accept for a schema-checked final answer.
 */
export interface JsonSchema {
  type?: JsonType | JsonType[]
  enum?: readonly unknown[]
  /** The value must match at least one; `description` then says what is allowed. */
  anyOf?: JsonSchema[]
  properties?: Record<string, JsonSchema>
  required?: string[]
  /** false forbids properties not listed; a schema checks each one that isn't listed. */
  additionalProperties?: boolean | JsonSchema
  items?: JsonSchema
  minimum?: number
  description?: string
}

export type JsonType = 'object' | 'array' | 'string' | 'integer' | 'number' | 'boolean' | 'null'

/** What is wrong with `value` against `schema`: one message per problem, each naming where it is. */
export function schemaErrors(value: unknown, schema: JsonSchema, path = 'answer'): string[] {
  if (schema.anyOf && !schema.anyOf.some((option) => !schemaErrors(value, option, path).length))
    return [`${path} must be ${schema.description ?? 'one of the allowed forms'} (got ${JSON.stringify(value)})`]
  if (schema.enum && !schema.enum.includes(value)) return [`${path} must be one of ${schema.enum.join(', ')} (got ${JSON.stringify(value)})`]
  const types = schema.type === undefined ? [] : [schema.type].flat()
  if (types.length && !types.some((type) => isType(value, type))) return [`${path} must be ${types.join(' or ')} (got ${JSON.stringify(value)})`]

  const errors: string[] = []
  if (isType(value, 'object')) {
    const object = value as Record<string, unknown>
    for (const key of schema.required ?? []) if (!(key in object)) errors.push(`${path}.${key} is missing`)
    for (const [key, item] of Object.entries(object)) {
      const property = schema.properties?.[key]
      const extra = schema.additionalProperties
      if (property) errors.push(...schemaErrors(item, property, `${path}.${key}`))
      else if (extra === false) errors.push(`${path}.${key} is not allowed`)
      else if (typeof extra === 'object') errors.push(...schemaErrors(item, extra, `${path}.${key}`))
    }
  }
  if (Array.isArray(value) && schema.items) value.forEach((item, i) => errors.push(...schemaErrors(item, schema.items!, `${path}[${i}]`)))
  if (typeof value === 'number' && schema.minimum !== undefined && value < schema.minimum) errors.push(`${path} must be at least ${schema.minimum}`)
  return errors
}

function isType(value: unknown, type: JsonType): boolean {
  switch (type) {
    case 'object':
      return typeof value === 'object' && value !== null && !Array.isArray(value)
    case 'array':
      return Array.isArray(value)
    case 'integer':
      return Number.isInteger(value)
    case 'null':
      return value === null
    default:
      return typeof value === type
  }
}
