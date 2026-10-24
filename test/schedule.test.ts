import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'
import { agentsRoot } from '../src/paths.ts'
import { launchdEntry, loadSchedules, type NamedSchedule } from '../src/schedule.ts'
import { makeWorkspace } from './helpers.ts'

const install = { node: '/opt/homebrew/bin/node', shellPath: '/opt/homebrew/bin:/usr/bin:/bin', dataDir: '/Users/saransh/agents/data' }

/** The text of the plist value right after `<key>name</key>`. */
function valueOf(plist: string, key: string): string | undefined {
  return plist.match(new RegExp(`<key>${key}</key>\\s*(<(\\w+)>[\\s\\S]*?</\\2>|<\\w+/>)`))?.[1]
}

/** The calendar times in a plist's StartCalendarInterval, as [Weekday, Hour, Minute]. */
function calendarTimes(plist: string): number[][] {
  const intervals = valueOf(plist, 'StartCalendarInterval') ?? ''
  return [...intervals.matchAll(/<dict>([\s\S]*?)<\/dict>/g)].map(([, dict]) =>
    ['Weekday', 'Hour', 'Minute'].map((key) => Number(dict.match(new RegExp(`<key>${key}</key>\\s*<integer>(\\d+)</integer>`))?.[1])),
  )
}

/** The daily Schedule, from this repo's Schedule definitions. */
async function dailySchedule(): Promise<NamedSchedule> {
  const daily = (await loadSchedules()).find((schedule) => schedule.name === 'daily')
  assert.ok(daily, 'there is a daily Schedule')
  return daily
}

test('the daily Schedule runs the daily Pipeline Monday to Friday at 05:30', async () => {
  assert.deepEqual(await dailySchedule(), { name: 'daily', pipeline: 'daily', days: ['monday', 'tuesday', 'wednesday', 'thursday', 'friday'], time: '05:30' })
})

test("the daily Schedule's launchd entry starts a scheduled Run of the daily Pipeline Monday to Friday at 05:30", async () => {
  const daily = await dailySchedule()

  const entry = launchdEntry(daily, install)

  assert.equal(entry.label, 'local.agents.daily')
  assert.match(valueOf(entry.plist, 'Label')!, /<string>local\.agents\.daily<\/string>/)
  assert.deepEqual(
    [...valueOf(entry.plist, 'ProgramArguments')!.matchAll(/<string>(.*?)<\/string>/g)].map(([, arg]) => arg),
    ['/opt/homebrew/bin/node', join(agentsRoot, 'src', 'cli.ts'), 'run', 'daily', '--scheduled'],
  )
  assert.deepEqual(calendarTimes(entry.plist), [
    [1, 5, 30],
    [2, 5, 30],
    [3, 5, 30],
    [4, 5, 30],
    [5, 5, 30],
  ])
})

test("a launchd entry runs with the installing shell's PATH, since launchd doesn't load the shell profile, from the agents repo", async () => {
  const daily = await dailySchedule()

  const { plist } = launchdEntry(daily, {
    node: '/Users/saransh/.nvm/versions/node/v25.2.0/bin/node',
    shellPath: '/Users/saransh/.local/bin:/opt/homebrew/bin:/usr/bin',
    dataDir: '/Users/saransh/agents/data',
  })

  // The Worker CLIs are node scripts, so node's folder must be on it even when the shell found node another way.
  assert.equal(
    valueOf(valueOf(plist, 'EnvironmentVariables')!, 'PATH'),
    '<string>/Users/saransh/.nvm/versions/node/v25.2.0/bin:/Users/saransh/.local/bin:/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin</string>',
  )
  assert.equal(valueOf(plist, 'WorkingDirectory'), `<string>${agentsRoot}</string>`)
  // A scheduled Run uses the data area the entry was installed for, as its launchd output does.
  assert.equal(valueOf(valueOf(plist, 'EnvironmentVariables')!, 'AGENTS_DATA_DIR'), '<string>/Users/saransh/agents/data</string>')
  assert.equal(valueOf(plist, 'StandardOutPath'), `<string>${join('/Users/saransh/agents/data', 'launchd', 'daily.log')}</string>`)
  assert.equal(valueOf(plist, 'StandardErrorPath'), `<string>${join('/Users/saransh/agents/data', 'launchd', 'daily.log')}</string>`)
})

test("a launchd entry's PATH lists each folder once", async () => {
  const daily = await dailySchedule()

  const { plist } = launchdEntry(daily, install)

  assert.equal(valueOf(valueOf(plist, 'EnvironmentVariables')!, 'PATH'), '<string>/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin</string>')
})

test('a launchd entry starts only at its calendar times, so a time missed while the Mac slept runs once on wake, and installing it starts nothing', async () => {
  const daily = await dailySchedule()

  const { plist } = launchdEntry(daily, install)

  // launchd starts a StartCalendarInterval job on wake for a time it slept through, coalescing several missed times into one start.
  assert.ok(valueOf(plist, 'StartCalendarInterval'))
  assert.equal(valueOf(plist, 'StartInterval'), undefined)
  assert.equal(valueOf(plist, 'RunAtLoad'), undefined)
  assert.equal(valueOf(plist, 'KeepAlive'), undefined)
})

test("a launchd entry names launchd's weekdays and the Schedule's hour and minute", () => {
  const weekend: NamedSchedule = { name: 'weekend', pipeline: 'daily', days: ['saturday', 'sunday'], time: '09:05' }

  const { label, plist } = launchdEntry(weekend, install)

  assert.equal(label, 'local.agents.weekend')
  assert.deepEqual(calendarTimes(plist), [
    [6, 9, 5],
    [0, 9, 5],
  ])
})

test('a Schedule whose time is not a time of day has no launchd entry', () => {
  for (const time of ['5:30', '24:00', '05:60', '05:30pm']) {
    assert.throws(() => launchdEntry({ name: 'daily', pipeline: 'daily', days: ['monday'], time }, install), /Schedule daily: time .* is not HH:MM/)
  }
})

test('a scheduled start records the Run it started and how the Run ended', async () => {
  const ws = makeWorkspace()
  try {
    ws.writeRepoList()

    await ws.agents('run', 'daily', '--scheduled', '--dry-run')

    const [id] = ws.runIds()
    assert.equal(readFileSync(join(ws.dataDir, 'scheduled-starts.log'), 'utf8').replace(/^\S+Z /, ''), `daily: started Run ${id}, which ended ${ws.readRun(id).status}\n`)
  } finally {
    ws.cleanup()
  }
})

test('a Run started by hand records no scheduled start', async () => {
  const ws = makeWorkspace()
  try {
    ws.writeRepoList()

    await ws.agents('run', 'daily', '--dry-run')

    assert.equal(existsSync(join(ws.dataDir, 'scheduled-starts.log')), false)
  } finally {
    ws.cleanup()
  }
})
