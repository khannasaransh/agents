import type { Schedule } from '../src/schedule.ts'

const daily: Schedule = {
  pipeline: 'daily',
  machine: 'mac',
  days: ['tuesday', 'wednesday', 'thursday', 'friday', 'saturday'],
  // On the Mac's clock, which is on Singapore time: 03:00 IST.
  time: '05:30',
}

export default daily
