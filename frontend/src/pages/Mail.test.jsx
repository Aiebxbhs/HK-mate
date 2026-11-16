import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { api } from '../api/client'
import Mailboxes from './Mailboxes'
import Inbox from './Inbox'
import { composeTarget } from '../components/ReplyDraftPanel'

vi.mock('../api/client', () => ({
  api: {
    connections: vi.fn(),
    authorizeGoogle: vi.fn(),
    connectNetease: vi.fn(),
    notifications: vi.fn(),
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

it('connects a 163 mailbox with an authorization code and checks the input first', async () => {
  const user = userEvent.setup()
  api.connections.mockResolvedValue({ items: [], google_configured: false })
  api.connectNetease.mockResolvedValue({})
  render(<Mailboxes onInbox={vi.fn()} />)
  await user.click(await screen.findByRole('button', { name: '添加网易邮箱（163 / 126）' }))
  await user.type(screen.getByLabelText('邮箱地址'), 'someone@example.com')
  await user.type(screen.getByLabelText('授权码'), 'SYNTHETICCODE1234')
  expect(screen.getByLabelText('授权码')).toHaveAttribute('type', 'password')
  await user.click(screen.getByRole('button', { name: '连接' }))
  expect(await screen.findByRole('alert')).toHaveTextContent('163.com')
  expect(api.connectNetease).not.toHaveBeenCalled()
  await user.clear(screen.getByLabelText('邮箱地址'))
  await user.type(screen.getByLabelText('邮箱地址'), 'Synthetic@163.com')
  await user.click(screen.getByRole('button', { name: '连接' }))
  expect(api.connectNetease).toHaveBeenCalledWith('synthetic@163.com', 'SYNTHETICCODE1234')
  expect(await screen.findByRole('status')).toHaveTextContent('网易邮箱已连接')
  expect(screen.queryByLabelText('授权码')).toBeNull()
})

it('opens NetEase drafts in the mail app and Gmail drafts in Gmail', () => {
  const draft = { to: 'to@example.com', subject: '主题 A', body: '正文 & more' }
  const netease = composeTarget({ mailbox: 'me@163.com', ...draft })
  expect(netease.href).toBe(
    'mailto:to%40example.com?subject=%E4%B8%BB%E9%A2%98%20A&body=%E6%AD%A3%E6%96%87%20%26%20more',
  )
  expect(netease.label).toBe('在邮件 App 中打开')
  const gmail = composeTarget({ mailbox: 'me@gmail.com', ...draft })
  expect(gmail.href).toMatch(/^https:\/\/mail\.google\.com\/mail\/\?authuser=me%40gmail\.com/)
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

it('loads another page and applies the scope filter within one mailbox', async () => {
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
    connectionId: mailbox.id,
    cursor: 'cursor-2',
  })
  await user.selectOptions(screen.getByLabelText('邮件范围'), 'received')
  expect(api.messages).toHaveBeenLastCalledWith({ scope: 'received', connectionId: mailbox.id })
  // A single mailbox needs no tabs.
  expect(screen.queryByRole('tablist')).toBeNull()
})

it('keeps each mailbox in its own tab and never requests mixed mail', async () => {
  const second = { ...mailbox, id: 'connection-2', email_address: 'second@163.com' }
  api.connections.mockResolvedValue({ items: [mailbox, second], google_configured: true })
  api.messages.mockImplementation(async ({ connectionId }) => ({
    items: [
      connectionId === second.id
        ? { ...message, id: 'm-2', connection_id: second.id, subject: '网易邮件' }
        : message,
    ],
    next_cursor: null,
    issues: [],
  }))
  render(<Inbox onManage={vi.fn()} />)
  const user = userEvent.setup()
  expect(await screen.findByRole('button', { name: /测试邮件/ })).toBeVisible()
  expect(screen.getByRole('tab', { name: mailbox.email_address })).toHaveAttribute(
    'aria-selected',
    'true',
  )
  await user.click(screen.getByRole('tab', { name: second.email_address }))
  expect(await screen.findByRole('button', { name: /网易邮件/ })).toBeVisible()
  expect(screen.queryByRole('button', { name: /测试邮件/ })).toBeNull()
  expect(api.messages.mock.calls.map(([query]) => query.connectionId)).toEqual([
    mailbox.id,
    second.id,
  ])
})

it('labels each mailbox tab with its new mail and shows notices for the open mailbox', async () => {
  const second = { ...mailbox, id: 'connection-2', email_address: 'second@163.com' }
  const notice = (id, connection, subject) => ({
    id,
    connection_id: connection.id,
    message_id: `m-${id}`,
    sender: 'sender@example.com',
    mailbox: connection.email_address,
    subject,
    status: 'pending',
    summary: null,
    error: null,
  })
  api.connections.mockResolvedValue({ items: [mailbox, second], google_configured: true })
  api.messages.mockResolvedValue({ items: [], next_cursor: null, issues: [] })
  api.notifications.mockResolvedValue({
    enabled: true,
    connection_count: 2,
    total_count: 3,
    errors: [],
    last_checked_at: null,
    next_cursor: null,
    items: [
      notice('a', mailbox, '谷歌新邮件'),
      notice('b', second, '网易新邮件一'),
      notice('c', second, '网易新邮件二'),
    ],
  })
  render(<Inbox onManage={vi.fn()} />)
  const user = userEvent.setup()
  const first = await screen.findByRole('tab', { name: 'first@example.com，1 封新邮件' })
  expect(first).toHaveAttribute('aria-selected', 'true')
  expect(await screen.findByRole('heading', { name: '1 封新邮件' })).toBeVisible()
  expect(screen.getByText('谷歌新邮件')).toBeVisible()
  expect(screen.queryByText('网易新邮件一')).toBeNull()
  // The tabs come before the notices on the page.
  const section = screen.getByRole('region', { name: '统一收件箱' })
  expect(section.firstElementChild).toHaveAttribute('role', 'tablist')
  await user.click(screen.getByRole('tab', { name: 'second@163.com，2 封新邮件' }))
  expect(await screen.findByRole('heading', { name: '2 封新邮件' })).toBeVisible()
  expect(screen.getByText('网易新邮件二')).toBeVisible()
  expect(screen.queryByText('谷歌新邮件')).toBeNull()
})

it('opens the mailbox chosen in Mailboxes and reads nothing when none is connected', async () => {
  const second = { ...mailbox, id: 'connection-2', email_address: 'second@163.com' }
  api.connections.mockResolvedValue({ items: [mailbox, second], google_configured: true })
  api.messages.mockResolvedValue({ items: [], next_cursor: null, issues: [] })
  const { unmount } = render(<Inbox initialConnectionId={second.id} onManage={vi.fn()} />)
  expect(await screen.findByRole('tab', { name: second.email_address })).toHaveAttribute(
    'aria-selected',
    'true',
  )
  expect(api.messages).toHaveBeenLastCalledWith({ scope: 'inbox', connectionId: second.id })
  unmount()
  api.messages.mockClear()
  api.connections.mockResolvedValue({ items: [], google_configured: true })
  render(<Inbox onManage={vi.fn()} />)
  expect(await screen.findByText('先在邮箱管理中添加邮箱，再来查看收件箱。')).toBeVisible()
  expect(api.messages).not.toHaveBeenCalled()
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
