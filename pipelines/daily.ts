import type { Pipeline } from '../src/pipeline.ts'

const daily: Pipeline = {
  // Brief comes last so its Run health covers every other Step.
  steps: ['fetch', 'review', 'discord', 'pm', 'docs', 'save-state', 'brief'],
  brief: 'brief.md',
}

export default daily
