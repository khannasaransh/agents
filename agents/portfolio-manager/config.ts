import type { AgentConfig } from '../../src/agent.ts'
import { changeKinds, levers } from '../../src/pd.ts'
import type { JsonSchema } from '../../src/schema.ts'

/** The name of the Portfolio Manager's Journal, its Memory file. */
export const journalMemory = 'journal'

/** The Run's files the Portfolio Manager's inputs come from, by input: a Decision record cites a figure by its file. */
export const inputFiles = {
  plans: 'plan.json',
  bookStates: 'book-states.json',
  stages: 'stages.json',
  health: 'health.json',
  review: 'review.json',
} as const

const nullable = (type: 'string' | 'number' | 'integer', description: string): JsonSchema => ({ type: [type, 'null'], description })

const decision: JsonSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['rule_plan', 'instead', 'lever', 'playbook', 'figures', 'expected', 'judged_on'],
  properties: {
    rule_plan: { type: 'string', description: 'What the Rule plan said: its order in words, or its exposure level' },
    instead: { type: 'string', description: 'What goes out instead, in words' },
    lever: { type: 'string', enum: levers },
    playbook: { type: 'string', description: "The Playbook's line the change is within, quoted from the plan's playbook" },
    figures: {
      type: 'array',
      description: 'Each figure the change rests on, as its input file has it. At least one',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['input', 'security', 'field', 'value'],
        properties: {
          input: { type: 'string', enum: Object.values(inputFiles), description: 'The file of the input it came from' },
          security: nullable('string', 'What it is about, as the file names it: a security id (IN:TCS), a Book or market code, an index, a strategy id; null for the top of the file'),
          field: { type: 'string', description: 'Its field in that object, a dotted path where it is nested: rs_rating, reading.breadth' },
          value: { type: ['number', 'string', 'boolean', 'null'], description: 'Its value as the file has it; a number may be rounded' },
        },
      },
    },
    expected: { type: 'string', description: 'What you expect to happen' },
    judged_on: { type: 'string', description: "The session it is judged on, YYYY-MM-DD, after the plan's session" },
  },
}

const book: JsonSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['book', 'plan_id', 'state_id', 'mandate_version', 'playbook_version', 'exposure', 'changes', 'commentary'],
  properties: {
    book: { type: 'string', enum: ['IN', 'US', 'HK'] },
    plan_id: { type: 'string', description: "The paper Book's plan you judged, by its id" },
    state_id: { type: 'string', description: "As that plan names it" },
    mandate_version: { type: 'string', description: 'As that plan names it' },
    playbook_version: { type: 'string', description: 'As that plan names it' },
    exposure: {
      type: 'object',
      additionalProperties: false,
      required: ['level', 'decision'],
      properties: {
        level: { type: 'number', description: "The exposure level for the day: the plan's, or a cut no lower than the Playbook's floor" },
        decision,
      },
    },
    changes: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['kind', 'order', 'security_id', 'sleeve', 'shares', 'multiple', 'sessions', 'wait', 'decision'],
        properties: {
          kind: { type: 'string', enum: changeKinds },
          order: nullable('string', "The Rule plan's order it changes, by id: a drop, resize, swap, wait or skip"),
          security_id: nullable('string', "A swap's Pool name bought; a trim's holding"),
          sleeve: nullable('string', "A trim's Sleeve"),
          shares: nullable('number', "A swap's or a trim's whole shares; a release's, or null for all those waiting"),
          multiple: nullable('number', "A resize's multiple of the order's shares"),
          sessions: nullable('integer', 'How many sessions a wait holds the buy back'),
          wait: nullable('integer', "A release's wait, by its id in the plan's waits"),
          decision,
        },
      },
    },
    commentary: { type: 'string', description: "The Brief's commentary on the Book: what the day means for it, in a few sentences" },
  },
}

const portfolioManager: AgentConfig = {
  // Claude Code first, as the PRD has it; and on Windows, Codex's unelevated sandbox can't enforce the
  // deny-read rules that keep it from the Tools this Agent doesn't declare (see the Health Agent).
  worker: { name: 'claude-code', model: 'opus', effort: 'high' },
  fallbackWorker: { name: 'codex', model: 'gpt-6-astra', effort: 'high' },
  permissions: 'read-only',
  inputs: {
    plans: `The Run's Rule plans, as pd plan printed them (${inputFiles.plans}): the Data gate's verdict and the mode, each market's Market condition and the exposure level it sets, and each Book's plans. A paper Book's plan has its Judgement mode, Playbook, Pool, holdings and the buys waiting. Null on a Saturday whose Plan Step failed: then there is only the review`,
    bookStates: `The state each plan was made from (${inputFiles.bookStates}): holdings, cash, open orders and Disaster stops`,
    stages: `Each Book's Sleeves and their Stages (${inputFiles.stages}); null when they couldn't be read`,
    health: `The Health Agent's diagnosis of the Lake in this Run (${inputFiles.health}); null when the Lake was healthy and it didn't run`,
    review: `On Saturdays, the weekly review's figures (${inputFiles.review}): each Book's paper Book and each Sleeve from Paper up, by its live record against its backtest's range and its benchmark, the demotions the demotion rule made, the promotions due, and each real Book's Reconciliation differences; on a month's first Saturday also the monthly review of the month before (monthly): each paper Book's return attributed to its sources, the correlation between its Sleeves and its drawdown against its limits; null on other days`,
    dossiers: "The dossiers of the Rule plan's names: null until the Feeds and dossiers are built",
    journal: 'Your Journal: the Decision records behind your earlier changes, what each was expected to do, and what is still open. Empty when you have none yet',
  },
  outputs: {
    books: "Your judgement of each paper Book's Rule plan: its exposure level for the day and your changes, each with its Decision record, and the Brief's commentary on it",
    review: "On Saturdays, the weekly review's commentary for the Brief; null on other days",
    monthly: "On a month's first Saturday, the monthly review's commentary for the Brief; null on other days",
    promotions: "The promotions you propose for Saransh's Answer: only those the review lists as due",
    journal: "The Journal's new entries, and the whole list of what is still open",
  },
  outputSchema: {
    type: 'object',
    additionalProperties: false,
    required: ['books', 'review', 'monthly', 'promotions', 'journal'],
    properties: {
      books: { type: 'array', items: book },
      review: nullable('string', "The weekly review's commentary for the Brief, in a few short paragraphs: how each Book and Sleeve stands against its tested range and its benchmark, the demotions and why, the promotions due, and Reconciliation's differences. Null when there is no review"),
      monthly: nullable(
        'string',
        "The monthly review's commentary for the Brief, in a few short paragraphs: where each Book's return over the month came from, what the correlation between its Sleeves and its drawdown against its limits say about its risk, and the promotions due. Null when the review has no monthly figures",
      ),
      promotions: {
        type: 'array',
        description: "Each promotion you propose, from the review's promotions_due. Empty on other days",
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['sleeve', 'why'],
          properties: {
            sleeve: { type: 'integer', description: "The Sleeve's id, as the review gives it" },
            why: { type: 'string', description: 'Why: its time in its Stage, and its record against its tested range and its benchmark, with the figures' },
          },
        },
      },
      journal: {
        type: 'object',
        additionalProperties: false,
        required: ['entries', 'open'],
        properties: {
          entries: { type: 'array', items: { type: 'string' }, description: "Today's entries: each change, why, and what it should do by when" },
          open: { type: 'array', items: { type: 'string' }, description: 'Everything still open after today, carried from your Journal and added today' },
        },
      },
    },
  },
  timeoutSeconds: 1200,
  maxTurns: 30,
}

export default portfolioManager
