#!/usr/bin/env node
import './node-version.ts'
import { join } from 'node:path'
import { parseArgs } from 'node:util'
import { acquireLock } from './lock.ts'
import { decideProposal, memoryFile, pendingProposals, proposalDiff } from './memory.ts'
import { runDir } from './paths.ts'
import { runPipeline, runSingleStep } from './pipeline.ts'
import { installSchedules, recordScheduledStart } from './schedule.ts'
import { captureConfig, defaultRoot, setupMachine } from './setup.ts'

const usage = `Usage:
  agents run <pipeline> [--dry-run]         Start a Run of a Pipeline, such as daily; a dry run
             [--scheduled]                  runs every Agent on the fake Worker; a scheduled one,
                                            as a Schedule starts it, records in the data area's
                                            scheduled-starts.log how it ended or why it didn't start
  agents step <name> --run <id> [--force]   Run one Step inside an existing Run
  agents memory                             List the Memory changes Agents proposed, waiting for you
  agents memory accept <agent> <name>       Make a proposed change the Memory the next Run reads
  agents memory reject <agent> <name>       Drop a proposed change, leaving the Memory as it is
  agents schedule install                   Install every Schedule into launchd, replacing what an
                                            earlier install wrote; it runs with this shell's PATH
  agents setup [--team <team,...>]          Prepare this machine: clone each Repo of the named Teams
               [--root <folder>]            (all of them by default) into a folder named for its
                                            Team, in the folder holding this repo unless given one;
                                            check the tools; install the Workers' config from this
                                            repo, backing up what it replaces; list what's left to
                                            do by hand
  agents setup capture [--root <folder>]    Copy this machine's Workers' config into this repo, with
                                            the paths to its home and root folders made portable
                                            and its secrets left out, for setup to install elsewhere`

async function main(argv: string[]): Promise<number> {
  const [command, ...rest] = argv
  switch (command) {
    case 'run': {
      const { values, positionals } = parseArgs({
        args: rest,
        allowPositionals: true,
        options: { 'dry-run': { type: 'boolean', default: false }, scheduled: { type: 'boolean', default: false } },
      })
      const [pipeline] = positionals
      if (!pipeline) return fail(usage)
      const run = await runPipeline(pipeline, { dryRun: values['dry-run'] }).catch((error: unknown) => {
        if (values.scheduled) recordScheduledStart(pipeline, { error })
        throw error
      })
      if (values.scheduled) recordScheduledStart(pipeline, { run })
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
      return step.status === 'failed' ? 1 : 0
    }
    case 'memory': {
      const [action, agent, name, ...extra] = rest
      if (action === 'accept' || action === 'reject') {
        if (!agent || !name || extra.length) return fail(usage)
        // Under the Run lock, so no Run's Save state queues a proposal for this Memory meanwhile.
        const release = acquireLock()
        let run: string
        try {
          run = decideProposal(agent, name, action === 'accept' ? 'accepted' : 'rejected').run
        } finally {
          release()
        }
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
    case 'schedule': {
      if (rest.length !== 1 || rest[0] !== 'install') return fail(usage)
      const { files, missing } = await installSchedules()
      for (const file of files) console.log(`Installed ${file}`)
      if (missing.length) console.error(`Not found on the Schedule's PATH, so a scheduled Run can't use them: ${missing.join(', ')}`)
      return 0
    }
    case 'setup': {
      const { values, positionals } = parseArgs({
        args: rest,
        allowPositionals: true,
        options: { team: { type: 'string', multiple: true, default: [] }, root: { type: 'string', default: defaultRoot } },
      })
      if (positionals.length === 1 && positionals[0] === 'capture' && !values.team.length) {
        captureConfig({ root: values.root })
        return 0
      }
      if (positionals.length) return fail(usage)
      const teams = values.team.flatMap((list) => list.split(',')).map((team) => team.trim()).filter(Boolean)
      return (await setupMachine({ root: values.root, teams })) ? 0 : 1
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
