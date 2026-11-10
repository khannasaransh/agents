import type { Schedule } from '../src/schedule.ts'

const stocks: Schedule = {
  pipeline: 'stocks',
  machine: 'windows',
  // After both markets' previous closes, before India opens.
  days: ['tuesday', 'wednesday', 'thursday', 'friday', 'saturday'],
  // On the Windows machine's clock, which is on Singapore time: 06:00 IST.
  time: '08:30',
}

export default stocks
