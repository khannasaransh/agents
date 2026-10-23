#!/usr/bin/env node
import { join } from 'node:path'
import { parseArgs } from 'node:util'
import { decideProposal, memoryFile, pendingProposals, proposalDiff } from './memory.ts'
import { runDir } from './paths.ts'
import { runPipeline, runSingleStep } from './pipeline.ts'

const usage = `Usage:
  agents run <pipeline> [--dry-run]         Start a Run of a Pipeline, such as daily; a dry run
                                            runs every Agent on the fake Worker
  agents step <name> --run <id> [--force]   Run one Step inside an existing Run
  agents memory                             List the Memory changes Agents proposed, waiting for you
  agents memory accept <agent> <name>       Make a proposed change the Memory the next Run reads
  agents memory reject <agent> <name>       Drop a proposed change, leaving the Memory as it is`

async function main(argv: string[]): Promise<number> {
  const [command, ...rest] = argv
  switch (command) {
    case 'run': {
      const { values, positionals } = parseArgs({ args: rest, allowPositionals: true, options: { 'dry-run': { type: 'boolean', default: false } } })
      const [pipeline] = positionals
      if (!pipeline) return fail(usage)
      const run = await runPipeline(pipeline, { dryRun: values['dry-run'] })
      console.log(`Run ${run.id} ${run.status}${run.dryRun ? ' (dry run)' : ''}: ${runDir(run.id)}`)
      console.log(`Brief: ${join(runDir(run.id), 'brief.md')}`)
      return run.status === 'succeeded' ? 0 : 2
    }
    case 'step': {
      const { values, positionals } = parseArgs({
        args: rest,
        allowPositionals: true,
        options: { run: { type: 'string' }, force: { type: 'boolean', default: false } },
      })
      const [name] = positionals
      if (!name || !values.run) return fail(usage)
      const step = await runSingleStep(values.run, name, { force: values.force })
      console.log(`Step ${name} ${step.status}. Log: ${join(runDir(values.run), step.log)}`)
      return step.status === 'succeeded' ? 0 : 1
    }
    case 'memory': {
      const [action, agent, name, ...extra] = rest
      if (action === 'accept' || action === 'reject') {
        if (!agent || !name || extra.length) return fail(usage)
        const { run } = decideProposal(agent, name, action === 'accept' ? 'accepted' : 'rejected')
        console.log(
          action === 'accept'
            ? `Accepted ${agent} ${name} from Run ${run}: the next Run reads it from ${memoryFile(agent, name)}`
            : `Rejected ${agent} ${name} from Run ${run}: the Memory stays as you have it`,
        )
        return 0
      }
      if (action !== undefined) return fail(usage)
      const pending = pendingProposals()
      if (!pending.length) console.log('No Memory changes are waiting for you.')
      for (const proposal of pending) {
        const { agent, name, run } = proposal
        console.log(`${agent} ${name}, proposed in Run ${run}:\n\n${proposalDiff(proposal)}`)
        console.log(`Accept with: agents memory accept ${agent} ${name}\nReject with: agents memory reject ${agent} ${name}\n`)
      }
      return 0
    }
    default:
      return fail(usage)
  }
}

function fail(message: string): number {
  console.error(message)
  return 1
}

try {
  process.exitCode = await main(process.argv.slice(2))
} catch (error) {
  process.exitCode = fail(error instanceof Error ? error.message : String(error))
}
