#!/usr/bin/env node
import './node-version.ts'
import { join } from 'node:path'
import { parseArgs } from 'node:util'
import { workerNames, type WorkerName } from './agent.ts'
import { acquireLock } from './lock.ts'
import { decideProposal, memoryFile, pendingProposals, proposalDiff } from './memory.ts'
import { runDir } from './paths.ts'
import { loadPipeline, runPipeline, runSingleStep } from './pipeline.ts'
import { installSchedules, recordScheduledStart } from './schedule.ts'
import { captureConfig, defaultRoot, setupMachine } from './setup.ts'

const usage = `Usage:
  agents run <pipeline> [--dry-run]         Start a Run of a Pipeline, such as daily, weekly or stocks. A dry
             [--worker <name>]              run runs every Agent on the fake Worker and changes
             [--scheduled]                  nothing in ash_new. --worker (codex or claude-code) runs
             [--env <name>=<value>]         every Agent on that Worker, using the model the Agent
                                            already names for it, and can't be combined with a dry
                                            run. A scheduled Run, as a Schedule starts it, records
                                            in the data area's scheduled-starts.log how it ended or
                                            why it didn't start. --env sets an environment variable
                                            for the Run, as a Task Scheduler entry does, which can't
                                            set one itself
  agents step <name> --run <id> [--force]   Run one Step inside an existing Run
  agents memory                             List the Memory changes Agents proposed, waiting for you
  agents memory accept <agent> <name>       Make a proposed change the Memory the next Run reads
  agents memory reject <agent> <name>       Drop a proposed change, leaving the Memory as it is
  agents schedule install                   Install this machine's Schedules, into launchd on the
                                            Mac and Task Scheduler on Windows, replacing what an
                                            earlier install wrote; they run with this shell's PATH
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
        options: {
          'dry-run': { type: 'boolean', default: false },
          scheduled: { type: 'boolean', default: false },
          worker: { type: 'string' },
          env: { type: 'string', multiple: true, default: [] },
        },
      })
      const [pipeline] = positionals
      const env = values.env.map((setting) => /^([^=]+)=(.*)$/s.exec(setting))
      const worker = values.worker
      if (!pipeline || env.some((match) => !match)) return fail(usage)
      if (worker !== undefined && !(workerNames as readonly string[]).includes(worker)) return fail(`--worker must be one of ${workerNames.join(', ')}`)
      if (worker === 'antigravity') return fail("antigravity runs only as a fallback Worker, so it can't be --worker")
      if (worker && values['dry-run']) return fail('A dry run uses the fake Worker, so it takes no --worker')
      for (const [, name, value] of env as RegExpExecArray[]) process.env[name] = value
      const run = await runPipeline(pipeline, { dryRun: values['dry-run'], worker: worker as WorkerName | undefined }).catch((error: unknown) => {
        if (values.scheduled) recordScheduledStart(pipeline, { error })
        throw error
      })
      if (values.scheduled) recordScheduledStart(pipeline, { run })
      console.log(`Run ${run.id} ${run.status}${run.dryRun ? ' (dry run)' : ''}: ${runDir(run.id)}`)
      console.log(`Brief: ${join(runDir(run.id), (await loadPipeline(pipeline)).brief)}`)
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
      const { installed, missing, warnings } = await installSchedules()
      for (const entry of installed) console.log(`Installed ${entry}`)
      for (const warning of warnings) console.error(warning)
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
