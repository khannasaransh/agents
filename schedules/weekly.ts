import type { Schedule } from '../src/schedule.ts'

const weekly: Schedule = {
  pipeline: 'weekly',
  machine: 'mac',
  days: ['sunday'],
  // On the Mac's clock, which is on Singapore time, the same morning as the weekday Run: 03:30 IST.
  time: '06:00',
}

export default weekly
