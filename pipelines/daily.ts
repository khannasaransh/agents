import type { Pipeline } from '../src/pipeline.ts'

const daily: Pipeline = {
  // Brief comes last so its Run health covers every other Step.
  steps: ['fetch', 'review', 'save-state', 'brief'],
}

export default daily
