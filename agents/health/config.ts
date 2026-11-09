import type { AgentConfig } from '../../src/agent.ts'

const health: AgentConfig = {
  // Codex CLI first, using the provisioned Windows sandbox with deny-read support.
  worker: { name: 'codex', model: 'gpt-6-astra', effort: 'high' },
  fallbackWorker: { name: 'claude-code', model: 'opus', effort: 'high' },
  adversaryWorker: { name: 'cursor', model: 'grok-4.7', effort: 'xhigh' },
  permissions: 'read-only',
  // To find out on exchanges' and the SEC's sites what became of a security the Lake no longer gets prices for.
  webSearch: true,
  inputs: {
    why: 'Why you were called: the Lake Step failed, its status couldn\'t be read, the Data gate failed, the Health report flags something, or this Run\'s MarketSmith fetch went wrong (a region failed, a results calendar couldn\'t be read, or a fetch or a backup wasn\'t whole)',
    lake: 'What the Lake Step did in this Run: the refreshes it cleared, each run of pd daily with its exit code, and whether one succeeded; null when it recorded nothing',
    lakeLog: "The end of the Lake Step's log in this Run, which holds pd daily's output",
    status: "The Lake's status as `pd status` printed it after the refresh: each market's latest session, the last refresh job, the Health report's verdict and flags, the Data gate's verdict with its reasons, the open Quarantines and the Corrections waiting for approval; null when it couldn't be read",
    delistings: "What earlier Runs found out about securities the Lake no longer gets prices for (the agents data area's state/delistings.json), by security: its status (delisted, renamed, trading or unknown), date, successor, why, source and the Run that found it. Empty until one is looked up",
    marketsmith: "What this Run's MarketSmith Step fetched (pd marketsmith's JSON): each region's mode (full or latest), the symbols a latest fetch chose and why, its results calendar, the symbols of the last fetch that weren't whole, and the backups kept and removed; null when MarketSmith wasn't fetched in this Run",
  },
  outputs: {
    diagnosis: 'What went wrong and why, in plain words',
    fix: 'The fix you propose, as text: what Saransh should do or change. It is never applied',
    evidence: 'Each thing you read that the diagnosis rests on: where you read it and what it shows',
    corrections: "The Corrections you propose for corporate actions Yahoo got wrong, in the Corrections file's format; none when no flag is one. They wait for Saransh's approval",
    delistings: 'What you found out in this Run about securities the Lake no longer gets prices for, one per security you looked up; none when you looked up none. They are kept for later Runs',
  },
  outputSchema: {
    type: 'object',
    additionalProperties: false,
    required: ['diagnosis', 'fix', 'evidence', 'corrections', 'delistings'],
    properties: {
      diagnosis: { type: 'string' },
      fix: { type: 'string' },
      evidence: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['source', 'shows'],
          properties: {
            source: { type: 'string', description: "A path from ash_new's folder, or the name of an input" },
            shows: { type: 'string', description: 'What it shows, in one line' },
          },
        },
      },
      corrections: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['security_id', 'kind', 'date', 'ratio', 'value', 'why'],
          properties: {
            security_id: { type: 'string', description: 'As the flag names it: IN:BHAGYANGR' },
            kind: { type: 'string', enum: ['split', 'dividend', 'demerger'] },
            date: { type: 'string', description: 'Its day, YYYY-MM-DD: the ex-date' },
            ratio: { type: ['number', 'null'], description: "A split's shares after per share before (2 for a 2-for-1 split or a 1:1 bonus); a demerger's share of the value the company kept, above 0 and under 1; null for a dividend" },
            value: { type: ['number', 'null'], description: "A dividend's cash per share, or null to drop it; null for a split or demerger" },
            why: { type: 'string', description: 'The evidence it rests on, in a sentence or two' },
          },
        },
      },
      delistings: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['security_id', 'status', 'date', 'successor', 'why', 'source'],
          properties: {
            security_id: { type: 'string', description: 'As the flag names it: US:AVB' },
            status: {
              type: 'string',
              enum: ['delisted', 'renamed', 'trading', 'unknown'],
              description: "delisted: listed under no ticker any more (taken private, bought for cash, liquidated, its listing cancelled); renamed: it, or the shares it became, trade under another ticker; trading: still listed under the same ticker, so the gap is the data source's; unknown: you couldn't find out",
            },
            date: { type: ['string', 'null'], description: 'Its last trading day, or the day the change took effect, YYYY-MM-DD; null when not known' },
            successor: { type: ['string', 'null'], description: 'For renamed, what trades now, as the Lake would name it (US:VMRK); null otherwise' },
            why: { type: 'string', description: 'What happened, in a sentence: the deal and its terms, or the cancellation and why' },
            source: { type: 'string', description: "Where you found it: the filing's or the exchange notice's URL" },
          },
        },
      },
    },
  },
  // Looking securities up on the web takes turns and time beyond the diagnosis.
  timeoutSeconds: 1800,
  maxTurns: 80,
}

export default health
