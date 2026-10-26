import type { Schedule } from '../src/schedule.ts'

const weekly: Schedule = {
  pipeline: 'weekly',
  machine: 'mac',
  days: ['sunday'],
  // On the Mac's clock, which is on Singapore time, the same morning as the weekday Run: 03:00 IST.
  time: '05:30',
}

export default weekly
