import type { Pipeline } from '../src/pipeline.ts'

const stocks: Pipeline = {
  // Brief comes last so its Run health covers every other Step.
  steps: ['lake', 'health', 'brief'],
  brief: 'brief.html',
}

export default stocks
