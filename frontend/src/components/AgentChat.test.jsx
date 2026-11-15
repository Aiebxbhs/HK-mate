import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import AgentChat, { plainText } from './AgentChat'
import { api } from '../api/client'

vi.mock('../api/client', () => ({
  api: {
    agentStatus: vi.fn(),
    agentChat: vi.fn(),
    connections: vi.fn(),
    agentConversations: vi.fn(),
    agentConversation: vi.fn(),
    deleteAgentConversation: vi.fn(),
    agentMemories: vi.fn(),
    deleteAgentMemory: vi.fn(),
    clearAgentMemories: vi.fn(),
  },
}))

const ready = {
  available: true,
  provider: 'openai',
  provider_label: 'OpenAI（ChatGPT）',
  model: 'test-model',
  problem: null,
  message: '',
}

beforeEach(() => {
  localStorage.clear()
  api.agentStatus.mockResolvedValue(ready)
})
afterEach(() => {
  cleanup()
  vi.resetAllMocks()
})

it('opens straight into the chat without a notice', async () => {
  render(<AgentChat />)
  expect(await screen.findByLabelText('给 AI 助手的消息')).toBeVisible()
  expect(screen.queryByRole('group', { name: '使用前说明' })).not.toBeInTheDocument()
  expect(screen.getByRole('button', { name: '明天有什么课？' })).toBeVisible()
})

it('shows why the assistant is unavailable', async () => {
  api.agentStatus.mockResolvedValue({ ...ready, available: false, message: 'API Key 无效。' })
  render(<AgentChat />)
  expect(await screen.findByText('API Key 无效。')).toBeVisible()
  expect(screen.queryByLabelText('给 AI 助手的消息')).not.toBeInTheDocument()
})

it('streams tool steps, cards and the answer, and continues the saved conversation', async () => {
  let emit
  let finish
  api.agentChat.mockImplementation(
    (payload, onEvent) =>
      new Promise((resolve) => {
        emit = onEvent
        finish = resolve
      }),
  )
  render(<AgentChat />)
  localStorage.setItem('hkmate.reply.signature', 'Sam')
  fireEvent.click(await screen.findByRole('button', { name: '明天有什么课？' }))
  expect(api.agentChat.mock.calls[0][0]).toEqual({
    message: '明天有什么课？',
    conversationId: undefined,
    signature: 'Sam',
  })
  expect(screen.getByText('正在思考…')).toBeVisible()
  expect(screen.getByRole('button', { name: '发送' })).toBeDisabled()

  await act(async () => {
    emit('conversation', { id: 'c1', title: '明天有什么课？' })
    emit('step', { tool: 'list_schedule', label: '正在查询你的日程', state: 'running' })
  })
  expect(screen.getByText('明天有什么课？', { selector: '.agent-toolbar-title' })).toBeVisible()
  expect(screen.getByText('正在查询你的日程…')).toBeVisible()
  expect(screen.queryByText('正在思考…')).not.toBeInTheDocument()
  await act(async () => {
    emit('step', { tool: 'list_schedule', label: '正在查询你的日程', state: 'done' })
    emit('card', {
      type: 'schedule',
      start_date: '2026-11-15',
      days: 1,
      items: [
        {
          title: 'COMP7607 LE1',
          course_name: 'NLP',
          type: 'class',
          starts: '2026-11-15 09:30',
          ends: '2026-11-15 11:20',
          location: 'CPD-3.04',
          done: false,
        },
        {
          title: 'Essay',
          course_name: '',
          type: 'deadline',
          starts: '2026-11-15 23:59',
          ends: null,
          location: '',
          done: false,
        },
      ],
    })
    emit('answer', { text: '明天 **09:30** 有 NLP 课。', stopped: 'answered' })
    emit('done', {})
    finish()
  })
  expect(screen.getByText('已查询你的日程')).toBeVisible()
  const card = screen.getByRole('group', { name: '日程 2026-11-15' })
  expect(within(card).getByText('11-15 09:30–11:20')).toBeVisible()
  expect(within(card).getByText(/COMP7607 LE1 NLP/)).toBeVisible()
  expect(within(card).getByText('截止')).toBeVisible()
  expect(screen.getByText('明天 09:30 有 NLP 课。')).toBeVisible()

  api.agentChat.mockResolvedValue(undefined)
  const box = screen.getByLabelText('给 AI 助手的消息')
  fireEvent.change(box, { target: { value: '那后天呢' } })
  fireEvent.keyDown(box, { key: 'Enter', isComposing: true })
  expect(api.agentChat).toHaveBeenCalledTimes(1)
  await act(async () => fireEvent.keyDown(box, { key: 'Enter' }))
  // Only the new message is sent; the server keeps the history.
  expect(api.agentChat.mock.calls[1][0]).toEqual({
    message: '那后天呢',
    conversationId: 'c1',
    signature: 'Sam',
  })
  // The second reply ended without an answer.
  expect(screen.getByText('AI 助手没有给出回答，请重试。')).toBeVisible()
  fireEvent.click(screen.getByRole('button', { name: '新对话' }))
  expect(screen.getByRole('button', { name: '明天有什么课？' })).toBeVisible()
})

it('shows errors in the conversation', async () => {
  api.agentChat.mockImplementationOnce(async (payload, onEvent) => {
    onEvent('error', {
      code: 'AGENT_REGION_UNSUPPORTED',
      message: '所选 AI 服务不支持当前所在地区。',
    })
    onEvent('done', {})
  })
  render(<AgentChat />)
  const box = await screen.findByLabelText('给 AI 助手的消息')
  fireEvent.change(box, { target: { value: '你好' } })
  await act(async () => fireEvent.click(screen.getByRole('button', { name: '发送' })))
  expect(screen.getByRole('alert')).toHaveTextContent('不支持当前所在地区')

  api.agentChat.mockRejectedValueOnce(new Error('提问太频繁了，请稍等一会儿再试。'))
  fireEvent.change(box, { target: { value: '再试' } })
  await act(async () => fireEvent.click(screen.getByRole('button', { name: '发送' })))
  expect(api.agentChat.mock.calls[1][0].message).toBe('再试')
  expect(screen.getAllByRole('alert')[1]).toHaveTextContent('提问太频繁')
})

it('turns light Markdown into plain text', () => {
  expect(plainText('## 标题\n- **一**\n* 二')).toBe('标题\n• 一\n• 二')
})

it('quick replies appear under the answer and send the chosen option', async () => {
  api.agentChat.mockImplementationOnce(async (payload, onEvent) => {
    onEvent('card', { type: 'choices', options: ['中餐', '甜品', '你帮我推荐'] })
    onEvent('answer', { text: '可以啊！想吃点什么？', stopped: 'answered' })
    onEvent('done', {})
  })
  render(<AgentChat />)
  const start = await screen.findByRole('button', { name: '帮我找找西营盘美食' })
  await act(async () => fireEvent.click(start))
  const choices = screen.getByRole('group', { name: '快捷回复' })
  const text = screen.getByText('可以啊！想吃点什么？')
  // The buttons come after the question.
  expect(text.compareDocumentPosition(choices) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()

  api.agentChat.mockImplementationOnce(async (payload, onEvent) => {
    onEvent('answer', { text: '好，帮你挑一家。', stopped: 'answered' })
    onEvent('done', {})
  })
  await act(async () =>
    fireEvent.click(within(choices).getByRole('button', { name: '你帮我推荐' })),
  )
  expect(api.agentChat.mock.calls[1][0].message).toBe('你帮我推荐')
  // Older choices can no longer be used.
  expect(within(choices).getByRole('button', { name: '中餐' })).toBeDisabled()
})

it('puts official sources after the answer text', async () => {
  api.agentChat.mockImplementationOnce(async (payload, onEvent) => {
    onEvent('card', {
      type: 'knowledge',
      guides: ['香港身份证（HKID）登记'],
      verified: '2026-11-14',
      sources: [{ label: '入境事务处：登记 / 补领香港身份证', url: 'https://www.immd.gov.hk/' }],
    })
    onEvent('answer', { text: '一般需要办理。', stopped: 'answered' })
    onEvent('done', {})
  })
  render(<AgentChat />)
  const box = await screen.findByLabelText('给 AI 助手的消息')
  fireEvent.change(box, { target: { value: '要办身份证吗' } })
  await act(async () => fireEvent.click(screen.getByRole('button', { name: '发送' })))
  const text = screen.getByText('一般需要办理。')
  const sources = screen.getByRole('complementary', { name: '资料来源' })
  expect(text.compareDocumentPosition(sources) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
})

it('opens a saved conversation from history and deletes one after confirming', async () => {
  api.agentConversations.mockResolvedValue({
    items: [
      { id: 'c2', title: '找吃的', updated_at: '2026-11-14T10:00:00Z' },
      { id: 'c1', title: '请假邮件', updated_at: '2026-11-13T02:00:00Z' },
    ],
  })
  api.agentConversation.mockResolvedValue({
    id: 'c2',
    title: '找吃的',
    updated_at: '2026-11-14T10:00:00Z',
    messages: [
      { role: 'user', content: '找吃的', cards: [], error: '' },
      {
        role: 'assistant',
        content: '推荐了两家。',
        cards: [{ type: 'places_expired', query: '川菜' }],
        error: '',
      },
    ],
  })
  render(<AgentChat />)
  fireEvent.click(await screen.findByRole('button', { name: '历史' }))
  const history = await screen.findByRole('region', { name: '历史对话' })
  expect(within(history).getByText('只保留最近 20 个对话', { exact: false })).toBeVisible()
  expect(within(history).getByText('11/14 18:00')).toBeVisible()

  api.deleteAgentConversation.mockResolvedValue(null)
  fireEvent.click(within(history).getByRole('button', { name: '删除对话 请假邮件' }))
  const confirm = within(history).getByRole('group', { name: '确认删除对话' })
  await act(async () => fireEvent.click(within(confirm).getByRole('button', { name: '删除' })))
  expect(api.deleteAgentConversation).toHaveBeenCalledWith('c1')
  expect(within(history).queryByText('请假邮件')).not.toBeInTheDocument()

  await act(async () => fireEvent.click(within(history).getByRole('button', { name: /^找吃的/ })))
  expect(screen.queryByRole('region', { name: '历史对话' })).not.toBeInTheDocument()
  expect(screen.getByText('推荐了两家。')).toBeVisible()
  expect(screen.getByText(/曾有“川菜”的地点结果/)).toBeVisible()

  api.agentChat.mockResolvedValue(undefined)
  const box = screen.getByLabelText('给 AI 助手的消息')
  fireEvent.change(box, { target: { value: '换一家' } })
  await act(async () => fireEvent.keyDown(box, { key: 'Enter' }))
  expect(api.agentChat.mock.calls[0][0]).toMatchObject({ message: '换一家', conversationId: 'c2' })

  fireEvent.click(screen.getByRole('button', { name: '新对话' }))
  expect(screen.getByText('新对话', { selector: '.agent-toolbar-title' })).toBeVisible()
  expect(screen.getByRole('button', { name: '明天有什么课？' })).toBeVisible()
})

it('memory panel lists, forgets and clears what the AI remembers', async () => {
  api.agentMemories.mockResolvedValue({
    items: [
      { id: 'm1', fact: '不吃辣', updated_at: '2026-11-14T10:00:00Z' },
      { id: 'm2', fact: '读 MSc CS', updated_at: '2026-11-14T10:00:00Z' },
    ],
  })
  api.deleteAgentMemory.mockResolvedValue(null)
  api.clearAgentMemories.mockResolvedValue(null)
  render(<AgentChat />)
  fireEvent.click(await screen.findByRole('button', { name: '记忆' }))
  const panel = await screen.findByRole('region', { name: 'AI 的记忆' })
  expect(within(panel).getByText(/会随每次对话发送给 AI 服务/)).toBeVisible()
  await act(async () => fireEvent.click(within(panel).getByRole('button', { name: '忘掉 不吃辣' })))
  expect(api.deleteAgentMemory).toHaveBeenCalledWith('m1')
  expect(within(panel).queryByText('不吃辣')).not.toBeInTheDocument()
  fireEvent.click(within(panel).getByRole('button', { name: '全部清空' }))
  const confirm = within(panel).getByRole('group', { name: '确认清空记忆' })
  await act(async () => fireEvent.click(within(confirm).getByRole('button', { name: '清空' })))
  expect(api.clearAgentMemories).toHaveBeenCalled()
  expect(within(panel).getByText(/还没有记住任何内容/)).toBeVisible()
})

it('shows what was remembered with an undo', async () => {
  api.agentChat.mockImplementationOnce(async (payload, onEvent) => {
    onEvent('card', { type: 'memory_saved', id: 'm9', fact: '不吃辣', replaced: false })
    onEvent('answer', { text: '记住了。', stopped: 'answered' })
    onEvent('done', {})
  })
  api.deleteAgentMemory.mockResolvedValue(null)
  render(<AgentChat />)
  const box = await screen.findByLabelText('给 AI 助手的消息')
  fireEvent.change(box, { target: { value: '我不吃辣' } })
  await act(async () => fireEvent.click(screen.getByRole('button', { name: '发送' })))
  expect(screen.getByText('已记住：不吃辣')).toBeVisible()
  await act(async () => fireEvent.click(screen.getByRole('button', { name: '撤销' })))
  expect(api.deleteAgentMemory).toHaveBeenCalledWith('m9')
  expect(screen.getByText('已撤销，不会再记住“不吃辣”。')).toBeVisible()
})
