import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { api } from '../api/client'
import Mailboxes from './Mailboxes'
import Inbox from './Inbox'

vi.mock('../api/client', () => ({
  api: {
    connections: vi.fn(),
    authorizeGoogle: vi.fn(),
    disconnectMailbox: vi.fn(),
    messages: vi.fn(),
    message: vi.fn(),
    summarizeMessage: vi.fn(),
  },
}))
const mailbox = {
  id: 'connection-1',
  email_address: 'first@example.com',
  provider: 'google',
  status: 'connected',
  created_at: '2026-11-12T10:00:00Z',
}
const message = {
  id: 'message-1',
  connection_id: mailbox.id,
  mailbox: mailbox.email_address,
  sender: 'sender@example.com',
  subject: '测试邮件',
  snippet: '测试预览',
  received_at: '2026-11-12T10:00:00Z',
  unread: true,
}

beforeEach(() => {
  vi.resetAllMocks()
  api.connections.mockResolvedValue({ items: [mailbox], google_configured: true })
  api.messages.mockResolvedValue({ items: [message], next_cursor: null, issues: [] })
})
afterEach(cleanup)

it('generates a real summary only when requested and allows retry after failure', async () => {
  api.message.mockResolvedValue({
    ...message,
    recipients: mailbox.email_address,
    body: 'Synthetic forwarded school notification',
    attachments: [],
  })
  api.summarizeMessage.mockRejectedValueOnce(new Error('本地模型暂不可用')).mockResolvedValue({
    summary: { overview: '课程团队提醒您参加明天下午的项目讨论。', uncertainties: [] },
  })
  render(<Inbox onManage={vi.fn()} />)
  const user = userEvent.setup()
  await user.click(await screen.findByRole('button', { name: /测试邮件/ }))
  await screen.findByText('Synthetic forwarded school notification')
  expect(api.summarizeMessage).not.toHaveBeenCalled()
  await user.click(screen.getByRole('button', { name: '生成摘要' }))
  expect(await screen.findByRole('alert')).toHaveTextContent('本地模型暂不可用')
  await user.click(screen.getByRole('button', { name: '生成摘要' }))
  expect(await screen.findByText('课程团队提醒您参加明天下午的项目讨论。')).toBeVisible()
  expect(api.summarizeMessage).toHaveBeenLastCalledWith(mailbox.id, message.id)
})

it('puts summary and reply tools in their own column beside the original mail', async () => {
  api.message.mockResolvedValue({
    ...message,
    recipients: mailbox.email_address,
    body: 'Synthetic forwarded school notification',
    attachments: [],
  })
  render(<Inbox onManage={vi.fn()} />)
  const user = userEvent.setup()
  await user.click(await screen.findByRole('button', { name: /测试邮件/ }))
  const reader = await screen.findByRole('region', { name: '邮件正文' })
  await within(reader).findByText('Synthetic forwarded school notification')
  const assistant = screen.getByRole('complementary', { name: 'AI 助手' })
  expect(within(reader).queryByRole('button', { name: '生成摘要' })).not.toBeInTheDocument()
  expect(within(assistant).getByRole('button', { name: '生成摘要' })).toBeVisible()
  // The reply form is ready without an extra click, below the summary.
  expect(within(assistant).getByRole('button', { name: '生成草稿' })).toBeVisible()
  const headings = within(assistant)
    .getAllByRole('heading', { level: 3 })
    .map((item) => item.textContent)
  expect(headings).toEqual(['邮件摘要', '回复草稿'])
  await user.click(screen.getByRole('button', { name: '关闭邮件正文' }))
  expect(screen.queryByRole('complementary', { name: 'AI 助手' })).not.toBeInTheDocument()
})

it('shows linked mailbox and confirms disconnect before making the request', async () => {
  api.disconnectMailbox.mockResolvedValue(null)
  const onInbox = vi.fn()
  render(<Mailboxes onInbox={onInbox} />)
  const user = userEvent.setup()
  expect(await screen.findByText(mailbox.email_address)).toBeVisible()
  await user.click(screen.getByRole('button', { name: '查看邮件' }))
  expect(onInbox).toHaveBeenCalledWith(mailbox.id)
  await user.click(screen.getByRole('button', { name: '解绑' }))
  expect(api.disconnectMailbox).not.toHaveBeenCalled()
  await user.click(screen.getByRole('button', { name: '确认解绑' }))
  expect(api.disconnectMailbox).toHaveBeenCalledWith(mailbox.id)
  expect(await screen.findByRole('status')).toHaveTextContent('邮箱已解绑')
})

it('disables authorization when Google configuration is missing', async () => {
  api.connections.mockResolvedValue({ items: [], google_configured: false })
  render(<Mailboxes onInbox={vi.fn()} />)
  expect(await screen.findByText('还没有连接邮箱')).toBeVisible()
  expect(screen.getByRole('button', { name: '添加 Google 邮箱' })).toBeDisabled()
})

it('shows an authorization failure without pretending the mailbox was added', async () => {
  api.authorizeGoogle.mockRejectedValue(new Error('Google 暂时不可用'))
  render(<Mailboxes onInbox={vi.fn()} />)
  const button = await screen.findByRole('button', { name: '添加 Google 邮箱' })
  await userEvent.click(button)
  expect(await screen.findByRole('alert')).toHaveTextContent('Google 暂时不可用')
})

it('opens plain-text message detail and never renders email HTML', async () => {
  const body = '<script>tracking()</script> 这只是邮件中的文字'
  api.message.mockResolvedValue({
    ...message,
    recipients: mailbox.email_address,
    body,
    attachments: ['test.pdf'],
  })
  render(<Inbox onManage={vi.fn()} />)
  await userEvent.click(await screen.findByRole('button', { name: /测试邮件/ }))
  expect(api.message).toHaveBeenCalledWith(mailbox.id, message.id)
  expect(await screen.findByText(body)).toBeVisible()
  expect(document.querySelector('script')).toBeNull()
  expect(screen.getByText('test.pdf')).toBeVisible()
  await userEvent.click(screen.getByRole('button', { name: '关闭邮件正文' }))
  expect(screen.queryByRole('region', { name: '邮件正文' })).not.toBeInTheDocument()
})

it('loads another page and applies mailbox and scope filters', async () => {
  api.messages
    .mockResolvedValueOnce({ items: [message], next_cursor: 'cursor-2', issues: [] })
    .mockResolvedValueOnce({
      items: [{ ...message, id: 'message-2', subject: '第二封邮件' }],
      next_cursor: null,
      issues: [],
    })
    .mockResolvedValue({ items: [], next_cursor: null, issues: [] })
  render(<Inbox onManage={vi.fn()} />)
  const user = userEvent.setup()
  await user.click(await screen.findByRole('button', { name: '加载更多邮件' }))
  expect(await screen.findByRole('button', { name: /第二封邮件/ })).toBeVisible()
  expect(api.messages).toHaveBeenCalledWith({
    scope: 'inbox',
    connectionId: '',
    cursor: 'cursor-2',
  })
  await user.selectOptions(screen.getByLabelText('邮件范围'), 'received')
  expect(api.messages).toHaveBeenLastCalledWith({ scope: 'received', connectionId: '' })
  await user.selectOptions(screen.getByLabelText('邮箱'), mailbox.id)
  expect(api.messages).toHaveBeenLastCalledWith({ scope: 'received', connectionId: mailbox.id })
})

it('labels today’s mail with a time and older mail with a date, in Hong Kong time', async () => {
  const { receivedLabel } = await import('./Inbox')
  const now = new Date('2026-11-15T12:00:00Z') // 20:00 in Hong Kong
  expect(receivedLabel('2026-11-15T01:30:00Z', now)).toBe('09:30')
  expect(receivedLabel('2026-11-14T15:59:00Z', now)).toBe('11月14日') // 23:59 the day before
  expect(receivedLabel('2026-11-14T16:00:00Z', now)).toBe('00:00')
})

it('tags each mail with its category, and shows when a label is still pending', async () => {
  api.messages.mockResolvedValue({
    items: [
      { ...message, id: 'school', category: '学校邮件', category_status: 'done' },
      { ...message, id: 'queued', subject: '排队中的邮件', category_status: 'pending' },
      { ...message, id: 'older', subject: '更早的邮件' },
    ],
    next_cursor: null,
    issues: [],
  })
  render(<Inbox />)
  const list = await screen.findByLabelText('邮件列表')
  const rows = await within(list).findAllByRole('button')
  expect(within(rows[0]).getByText('学校邮件')).toHaveClass('course')
  expect(within(rows[1]).getByText('分类中')).toBeVisible()
  // Mail older than the labelled window simply has no tag.
  expect(rows[2].querySelector('.mail-category')).toBeNull()
})
