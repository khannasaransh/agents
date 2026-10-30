import type { Schedule } from '../src/schedule.ts'

const daily: Schedule = {
  pipeline: 'daily',
  machine: 'mac',
  days: ['tuesday', 'wednesday', 'thursday', 'friday', 'saturday'],
  // On the Mac's clock, which is on Singapore time: 03:30 IST.
  time: '06:00',
}

export default daily
