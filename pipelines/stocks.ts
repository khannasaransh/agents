import type { Pipeline } from '../src/pipeline.ts'

const stocks: Pipeline = {
  // Answers comes first, so what Saransh decided counts in this Run's refresh and Brief, then Broker
  // inbox records what he did at his brokers. Brief comes last so its Run health covers every other Step.
  steps: ['answers', 'broker-inbox', 'marketsmith', 'lake', 'health', 'brief'],
  brief: 'brief.html',
}

export default stocks
