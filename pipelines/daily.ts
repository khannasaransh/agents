import type { Pipeline } from '../src/pipeline.ts'

const daily: Pipeline = {
  steps: ['fetch', 'review', 'brief', 'save-state'],
}

export default daily
