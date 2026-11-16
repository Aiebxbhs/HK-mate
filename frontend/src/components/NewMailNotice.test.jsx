import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { api } from '../api/client'
import NewMailNotice, { MAIL_NOTICES_CHANGED } from './NewMailNotice'

vi.mock('../api/client', () => ({
  api: {
    notifications: vi.fn(),
    checkNotifications: vi.fn(),
    dismissNotification: vi.fn(),
    retryNotification: vi.fn(),
    message: vi.fn(),
    createCalendarEvent: vi.fn(),
  },
}))
const empty = {
  enabled: true,
  connection_count: 1,
  total_count: 0,
  items: [],
  errors: [],
  last_checked_at: null,
  next_cursor: null,
}
const mail = {
  id: 'notification-test',
  connection_id: 'connection-test',
  message_id: 'message-test',
  sender: 'teacher@example.com',
  mailbox: 'reader@example.com',
  subject: 'Synthetic assignment',
  status: 'pending',
  summary: null,
  error: null,
}
const ready = {
  ...mail,
  status: 'ready',
  summary: {
    overview: '课程团队发布了新作业，请您核对要求。',
    category: '学校邮件',
    uncertainties: [],
    actions: [],
  },
}

beforeEach(() => {
  vi.resetAllMocks()
  vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] })
})
afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

it('automatically shows arriving mail, then its generated summary and category without clicks', async () => {
  api.notifications
    .mockResolvedValueOnce(empty)
    .mockResolvedValueOnce({ ...empty, total_count: 1, items: [mail] })
    .mockResolvedValue({ ...empty, total_count: 1, items: [ready] })
  const { container } = render(<NewMailNotice />)
  expect(container).toBeEmptyDOMElement()
  await act(async () => {})
  expect(api.notifications).toHaveBeenCalledOnce()
  expect(container).toBeEmptyDOMElement()
  expect(screen.queryByText('界面预览 · 示例内容')).not.toBeInTheDocument()
  await act(async () => {
    await vi.advanceTimersByTimeAsync(3000)
  })
  expect(screen.getByRole('heading', { name: '1 封新邮件' })).toBeVisible()
  expect(screen.getByText('已收到邮件，正在排队生成摘要…')).toBeVisible()
  expect(screen.getByRole('button', { name: '加入日程' })).toBeDisabled()
  await act(async () => {
    await vi.advanceTimersByTimeAsync(3000)
  })
  expect(screen.getByText('课程团队发布了新作业，请您核对要求。')).toBeVisible()
  expect(screen.getByText('学校邮件')).toHaveClass('course')
  expect(screen.getByRole('button', { name: '加入日程' })).toBeEnabled()
})

it('loads all notification pages and clears private data when the session expires', async () => {
  api.notifications
    .mockResolvedValueOnce({ ...empty, total_count: 2, items: [ready], next_cursor: 'cursor-two' })
    .mockResolvedValueOnce({
      ...empty,
      total_count: 2,
      items: [{ ...ready, id: 'second', subject: 'Second synthetic mail' }],
    })
    .mockRejectedValue(Object.assign(new Error('请重新登录'), { status: 401 }))
  render(<NewMailNotice />)
  await screen.findByRole('heading', { name: '2 封新邮件' })
  expect(screen.getAllByRole('article')).toHaveLength(2)
  expect(api.notifications).toHaveBeenNthCalledWith(2, 'cursor-two')
  await act(async () => {
    await vi.advanceTimersByTimeAsync(3000)
  })
  expect(screen.queryByRole('region')).not.toBeInTheDocument()
  expect(screen.queryByRole('article')).not.toBeInTheDocument()
})

it('hides the module after the last notification is ignored and keeps watching for new mail', async () => {
  api.notifications
    .mockResolvedValueOnce({ ...empty, total_count: 1, items: [ready] })
    .mockResolvedValue(empty)
  api.dismissNotification.mockResolvedValue({})
  const { container } = render(<NewMailNotice />)
  await screen.findByRole('heading', { name: '1 封新邮件' })
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: '忽略' }))
  })
  expect(api.dismissNotification).toHaveBeenCalledWith(ready.id)
  expect(container).toBeEmptyDOMElement()
  api.notifications.mockResolvedValue({ ...empty, total_count: 1, items: [mail] })
  await act(async () => {
    await vi.advanceTimersByTimeAsync(3000)
  })
  expect(screen.getByRole('heading', { name: '1 封新邮件' })).toBeVisible()
  expect(screen.getByRole('article')).toBeVisible()
})

it('adds a schedule from a mail notice with the same blank form as My Schedule', async () => {
  if (!HTMLDialogElement.prototype.showModal) {
    HTMLDialogElement.prototype.showModal = function showModal() {
      this.open = true
    }
    HTMLDialogElement.prototype.close = function close() {
      this.open = false
    }
  }
  const withActions = {
    ...ready,
    summary: {
      ...ready.summary,
      actions: [
        { text: '提交项目提案。', evidence: 'Due Nov 20, 6:00 PM.', deadline: 'Nov 20, 6:00 PM' },
      ],
    },
  }
  api.notifications.mockResolvedValue({ ...empty, total_count: 1, items: [withActions] })
  api.createCalendarEvent.mockResolvedValue({
    id: 'created',
    title: '提交提案',
    starts_at: '2026-11-20T17:00:00+08:00',
  })
  const changed = vi.fn()
  window.addEventListener('hkmate:schedule-changed', changed)
  render(<NewMailNotice />)
  await screen.findByRole('heading', { name: '1 封新邮件' })
  fireEvent.click(screen.getByRole('button', { name: '加入日程' }))

  // Nothing is taken from the mail: the user fills the form in.
  expect(screen.getByRole('form', { name: '添加日程' })).toBeVisible()
  expect(screen.getByLabelText('标题')).toHaveValue('')
  expect(screen.getByLabelText('标题')).toHaveFocus()
  expect(screen.getByLabelText('地点（可选）')).toHaveValue('')
  expect(screen.queryByText(/Nov 20/)).not.toBeInTheDocument()
  expect(screen.queryByRole('radiogroup', { name: '选择要加入的待办' })).not.toBeInTheDocument()
  expect(screen.getByRole('radio', { name: '活动' })).toBeChecked()

  fireEvent.change(screen.getByLabelText('标题'), { target: { value: '提交提案' } })
  fireEvent.change(screen.getByLabelText('日期'), { target: { value: '2026-11-20' } })
  fireEvent.change(screen.getByLabelText('开始'), { target: { value: '17:00' } })
  fireEvent.change(screen.getByLabelText('结束'), { target: { value: '18:00' } })
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: '保存日程' }))
  })
  expect(api.createCalendarEvent).toHaveBeenCalledWith({
    kind: 'event',
    title: '提交提案',
    date: '2026-11-20',
    start_time: '17:00',
    end_time: '18:00',
    location: '',
  })
  expect(changed).toHaveBeenCalledOnce()
  expect(screen.getByText(/已加入“我的日程”：提交提案/)).toBeVisible()
  window.removeEventListener('hkmate:schedule-changed', changed)
})

// Moved from the home page tests: notices now live at the top of the inbox.
it('lists each new mail with its category and ignores only the chosen message', async () => {
  const items = [
    { id: 'assignment-test', subject: 'NLP 小组作业已发布', category: '学校邮件' },
    { id: 'promotion-test', subject: '学习工具优惠推荐', category: '广告推广' },
    { id: 'job-test', subject: '暑期实习面试邀请', category: '求职邮件' },
  ].map((item) => ({
    ...item,
    message_id: item.id,
    connection_id: 'connection-test',
    sender: 'synthetic@example.com',
    mailbox: 'reader@example.com',
    status: 'ready',
    summary: {
      overview: '这是一条合成摘要。',
      category: item.category,
      uncertainties: [],
      actions: [],
    },
  }))
  const result = {
    enabled: true,
    connection_count: 1,
    total_count: 3,
    items,
    errors: [],
    last_checked_at: null,
    next_cursor: null,
  }
  api.notifications.mockResolvedValue(result)
  api.dismissNotification.mockImplementation(async (id) => {
    api.notifications.mockResolvedValue({
      ...result,
      total_count: 2,
      items: items.filter((item) => item.id !== id),
    })
  })
  const changes = vi.fn()
  window.addEventListener(MAIL_NOTICES_CHANGED, changes)
  render(<NewMailNotice />)
  const user = userEvent.setup()
  await screen.findByRole('heading', { name: '3 封新邮件' })
  // The "邮件" tab count is told about the first count and every change after it.
  expect(changes).toHaveBeenCalledTimes(1)
  expect(screen.getAllByRole('article')).toHaveLength(3)
  const promotion = screen.getByRole('article', { name: '学习工具优惠推荐' })
  expect(within(promotion).getByText('广告推广')).toBeVisible()
  for (const article of screen.getAllByRole('article')) {
    expect(within(article).getByRole('button', { name: '查看原邮件' })).toBeVisible()
    expect(within(article).getByRole('button', { name: '加入日程' })).toBeVisible()
    expect(within(article).getByRole('button', { name: '忽略' })).toBeVisible()
  }
  expect(screen.getByText('学校邮件')).toBeVisible()
  expect(screen.getByText('求职邮件')).toBeVisible()
  await user.click(within(promotion).getByRole('button', { name: '忽略' }))
  await screen.findByRole('heading', { name: '2 封新邮件' })
  expect(api.dismissNotification).toHaveBeenCalledWith('promotion-test')
  expect(changes).toHaveBeenCalledTimes(2)
  window.removeEventListener(MAIL_NOTICES_CHANGED, changes)
  expect(screen.getAllByRole('article')).toHaveLength(2)
  expect(screen.queryByRole('article', { name: '学习工具优惠推荐' })).not.toBeInTheDocument()
  expect(screen.getByRole('heading', { name: '2 封新邮件' })).toBeVisible()
  await user.click(screen.getByRole('button', { name: '收起新邮件，共 2 封' }))
  expect(screen.queryByRole('article')).not.toBeInTheDocument()
  expect(screen.queryByRole('button', { name: '恢复演示邮件' })).not.toBeInTheDocument()
})

it('prefers the stored label, which can arrive before the summary', async () => {
  const labelled = { ...mail, category: '账单与账户' }
  api.notifications.mockResolvedValue({ ...empty, total_count: 1, items: [labelled] })
  render(<NewMailNotice />)
  await act(async () => {})
  expect(screen.getByText('账单与账户')).toBeVisible()
  expect(screen.queryByText('分类中')).not.toBeInTheDocument()
})

it('shows only the chosen mailbox’s notices and reports the count of every mailbox', async () => {
  const other = { ...ready, id: 'notification-other', connection_id: 'connection-other' }
  const second = { ...ready, id: 'notification-second', subject: 'Second synthetic mail' }
  api.notifications.mockResolvedValue({
    ...empty,
    connection_count: 2,
    total_count: 3,
    items: [ready, other, second],
  })
  const onCounts = vi.fn()
  const { rerender } = render(<NewMailNotice connectionId="connection-other" onCounts={onCounts} />)
  expect(await screen.findByRole('heading', { name: '1 封新邮件' })).toBeVisible()
  expect(screen.getAllByRole('article')).toHaveLength(1)
  expect(onCounts).toHaveBeenLastCalledWith({ 'connection-test': 2, 'connection-other': 1 })
  rerender(<NewMailNotice connectionId="connection-test" onCounts={onCounts} />)
  expect(screen.getByRole('heading', { name: '2 封新邮件' })).toBeVisible()
  expect(screen.getByText('Second synthetic mail')).toBeVisible()
  // A mailbox with nothing new shows no notice block at all.
  rerender(<NewMailNotice connectionId="connection-quiet" onCounts={onCounts} />)
  expect(screen.queryByRole('heading', { name: /封新邮件/ })).toBeNull()
})
