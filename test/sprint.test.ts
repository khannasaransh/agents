import assert from 'node:assert/strict'
import { test } from 'node:test'
import { latestPost, parseTasks, sprintTitle } from '../src/sprint.ts'

const post = [
  'Hello Team,\nhere is the list of tasks for this sprint-(oct 21 - oct 27)\n\n\n\n**Android Team**\n\n@Ravi \n- Public | Audience acquisition experiment. PM - Harshul Mahajan\n- Configurable Navigation Bar. PM - Harshul Mahajan',
  '**Backend Team**\n\n\n@Rahul \n- Public | Audience acquisition experiment. PM - Harshul Mahajan\n- Smaran | Video Feed Algorithm. PM - Arhaan Akhtar\n\n@Neha \n- Football Center. PM - Prakhar Shukla\n- Tender Tracker',
].map((content) => ({ content }))

test('a sprint post becomes its tasks, each once with everyone it is assigned to and their Teams', () => {
  assert.deepEqual(parseTasks(post), [
    {
      id: 'public-audience-acquisition-experiment',
      title: 'Public | Audience acquisition experiment',
      product: 'Public',
      pm: 'Harshul Mahajan',
      assignees: [
        { name: 'Ravi', team: 'Android' },
        { name: 'Rahul', team: 'Backend' },
      ],
    },
    { id: 'configurable-navigation-bar', title: 'Configurable Navigation Bar', product: null, pm: 'Harshul Mahajan', assignees: [{ name: 'Ravi', team: 'Android' }] },
    { id: 'smaran-video-feed-algorithm', title: 'Smaran | Video Feed Algorithm', product: 'Smaran', pm: 'Arhaan Akhtar', assignees: [{ name: 'Rahul', team: 'Backend' }] },
    { id: 'football-center', title: 'Football Center', product: null, pm: 'Prakhar Shukla', assignees: [{ name: 'Neha', team: 'Backend' }] },
    { id: 'tender-tracker', title: 'Tender Tracker', product: null, pm: null, assignees: [{ name: 'Neha', team: 'Backend' }] },
  ])
  assert.equal(sprintTitle(post), 'here is the list of tasks for this sprint-(oct 21 - oct 27)')
})

test('lines before any assignee, and chat that lists no tasks, are not tasks', () => {
  assert.deepEqual(parseTasks([{ content: 'inme abhi kuch nai krna hai na? @Subhash \nTender Tracker\n- just a thought' }]), [])
})

const message = (id: string, authorId: string, timestamp: string, content: string) => ({ id, authorId, author: authorId, timestamp, link: `https://discord.com/channels/1/2/${id}`, content })

test("the latest post is the newest message that lists tasks and its author's messages around it, an hour apart at most", () => {
  const older = message('1', 'subhash', '2026-10-14T12:00:00Z', '**Backend**\n@Rahul\n- Old task')
  const intro = message('2', 'subhash', '2026-10-21T12:05:26Z', 'Hello Team,\nhere is the list of tasks for this sprint')
  const backend = message('3', 'subhash', '2026-10-21T12:05:45Z', post[1].content)
  const ios = message('4', 'subhash', '2026-10-21T12:12:16Z', '**iOS Team**\n@Asha\n- Inshorts In-app feedback status. PM - Prakhar Shukla')
  const question = message('5', 'saransh', '2026-10-21T12:30:00Z', 'Is Tender Tracker on this sprint?')
  const later = message('6', 'subhash', '2026-10-21T14:00:00Z', 'Reminder: standup at 4')

  assert.deepEqual(latestPost([older, intro, backend, ios, question, later])?.map((m) => m.id), ['2', '3', '4'])
  assert.equal(latestPost([question, later]), null)
})
