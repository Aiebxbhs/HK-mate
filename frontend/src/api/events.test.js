import { expect, it } from 'vitest'
import { readEvents } from './client'

function streamOf(...chunks) {
  const encoder = new TextEncoder()
  return {
    body: new ReadableStream({
      start(controller) {
        for (const chunk of chunks) controller.enqueue(encoder.encode(chunk))
        controller.close()
      },
    }),
  }
}

it('parses server-sent events even when split across chunks', async () => {
  const seen = []
  await readEvents(
    streamOf(
      'event: step\ndata: {"tool":"list_sch',
      'edule","state":"running"}\n\nevent: answer\ndata: {"text":"你',
      '好"}\n\nevent: bad\ndata: {oops}\n\nevent: done\ndata: {}\n\n',
    ),
    (name, data) => seen.push([name, data]),
  )
  expect(seen).toEqual([
    ['step', { tool: 'list_schedule', state: 'running' }],
    ['answer', { text: '你好' }],
    ['done', {}],
  ])
})
