import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { api } from '../api/client'
import TodayHongKong, { salutation } from './TodayHongKong'

vi.mock('../api/client', () => ({
  api: {
    agentStatus: vi.fn(),
    calendarEvents: vi.fn(),
    notifications: vi.fn(),
  },
}))
beforeEach(() => {
  vi.resetAllMocks()
  api.agentStatus.mockResolvedValue({
    available: false,
    provider: 'openai',
    provider_label: 'OpenAI（ChatGPT）',
    model: '',
    problem: 'AGENT_NOT_CONFIGURED',
    message: 'AI 助手尚未配置。',
  })
  api.calendarEvents.mockResolvedValue({ items: [], total_events: 0 })
})
afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

function at(iso) {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date(iso))
}

function event(id, title, starts_at, ends_at, extra = {}) {
  return { id, title, starts_at, ends_at, location: '', kind: 'event', completed: false, ...extra }
}

it('greets by Hong Kong time with the date, then the assistant, and no mail or weather', async () => {
  at('2026-11-15T11:00:00Z') // 19:00 Sunday in Hong Kong
  render(<TodayHongKong name="测试同学" />)
  expect(screen.getByRole('heading', { level: 1, name: '晚上好，测试同学' })).toBeVisible()
  expect(screen.getByText('11 月 15 日 周日')).toBeVisible()
  expect(screen.getByRole('region', { name: 'AI 助手' })).toBeVisible()
  expect(await screen.findByText('AI 助手尚未配置。')).toBeVisible()
  expect(screen.queryByText(/°C/)).not.toBeInTheDocument()
  expect(screen.queryByRole('button', { name: /今日日程/ })).not.toBeInTheDocument()
  expect(api.notifications).not.toHaveBeenCalled()
  expect(api.calendarEvents).toHaveBeenCalledWith({
    startDate: '2026-11-15',
    endDate: '2026-11-20',
  })
})

it('chooses the greeting from the Hong Kong hour', () => {
  expect(salutation(new Date('2026-11-14T21:00:00Z'))).toBe('早上好') // 05:00
  expect(salutation(new Date('2026-11-15T03:59:00Z'))).toBe('早上好') // 11:59
  expect(salutation(new Date('2026-11-15T04:00:00Z'))).toBe('下午好') // 12:00
  expect(salutation(new Date('2026-11-15T10:00:00Z'))).toBe('晚上好') // 18:00
  expect(salutation(new Date('2026-11-15T18:00:00Z'))).toBe('晚上好') // 02:00
})

it('lists the next five days with classes, deadlines and empty days', async () => {
  at('2026-11-15T04:00:00Z') // 12:00 Sunday in Hong Kong
  api.calendarEvents.mockResolvedValue({
    total_events: 7,
    items: [
      event('later', 'COMP7404', '2026-11-16T09:30:00+08:00', '2026-11-16T12:20:00+08:00', {
        location: 'CPD-3.28',
      }),
      event('ended', '早上的课', '2026-11-15T08:00:00+08:00', '2026-11-15T09:00:00+08:00'),
      event('next', 'COMP7607', '2026-11-15T14:10:00+08:00', '2026-11-15T15:00:00+08:00', {
        location: 'LE-1',
      }),
      event('second', '小组讨论', '2026-11-15T16:00:00+08:00', '2026-11-15T17:00:00+08:00'),
      event('essay', 'Essay draft', '2026-11-15T23:59:00+08:00', '2026-11-15T23:59:00+08:00', {
        kind: 'deadline',
      }),
      event('quiz', 'Quiz 2', '2026-11-17T23:59:00+08:00', '2026-11-17T23:59:00+08:00', {
        kind: 'deadline',
      }),
      event('done', 'Reading', '2026-11-18T10:00:00+08:00', '2026-11-18T10:00:00+08:00', {
        kind: 'deadline',
        completed: true,
      }),
    ],
  })
  render(<TodayHongKong name="测试同学" />)
  const week = await screen.findByRole('region', { name: '接下来 5 天' })
  const days = within(week).getAllByRole('listitem', { name: /日$/ })
  expect(days.map((day) => day.getAttribute('aria-label'))).toEqual([
    '今天 15 日',
    '明天 16 日',
    '周二 17 日',
    '周三 18 日',
    '周四 19 日',
  ])
  const today = days[0]
  expect(today.textContent).toMatch(/早上的课.*COMP7607.*小组讨论.*Essay draft/)
  expect(within(today).getByText('早上的课').closest('li')).toHaveClass('is-past')
  // Only the next class today gets a countdown; later ones stay quiet.
  expect(within(today).getByText('2 小时 10 分钟后')).toBeVisible()
  expect(within(today).getAllByText(/分钟后$/)).toHaveLength(1)
  expect(within(today).getByText('LE-1')).toBeVisible()
  expect(within(today).getByText('23:59 截止')).toBeVisible()
  expect(today.querySelector('.week-dot')).toHaveClass('is-urgent')
  expect(days[1]).toHaveTextContent('09:30–12:20COMP7404CPD-3.28')
  expect(days[2].querySelector('.week-dot')).not.toHaveClass('is-urgent')
  expect(within(days[3]).getByText('已完成')).toBeVisible()
  expect(within(days[4]).getByText('没有安排')).toBeVisible()
})

it('marks a class that is running now', async () => {
  at('2026-11-15T06:30:00Z') // 14:30 in Hong Kong
  api.calendarEvents.mockResolvedValue({
    total_events: 1,
    items: [event('now', 'COMP7607', '2026-11-15T14:00:00+08:00', '2026-11-15T15:00:00+08:00')],
  })
  render(<TodayHongKong name="测试同学" />)
  expect(await screen.findByText('进行中')).toBeVisible()
})

it('offers to import the timetable or add an event when there is nothing yet', async () => {
  at('2026-11-15T04:00:00Z')
  const onNavigate = vi.fn()
  const onAddSchedule = vi.fn()
  render(<TodayHongKong name="测试同学" onNavigate={onNavigate} onAddSchedule={onAddSchedule} />)
  const user = userEvent.setup()
  await user.click(await screen.findByRole('button', { name: '导入课表' }))
  expect(onNavigate).toHaveBeenCalledWith('timetable')
  await user.click(screen.getByRole('button', { name: '添加日程' }))
  expect(onAddSchedule).toHaveBeenCalledOnce()
  await user.click(screen.getByRole('button', { name: '全部日程' }))
  expect(onNavigate).toHaveBeenCalledWith('calendar')
})

it('shows a calendar error instead of an empty week', async () => {
  at('2026-11-15T04:00:00Z')
  api.calendarEvents.mockRejectedValue(new Error('日程暂时无法读取。'))
  render(<TodayHongKong name="测试同学" />)
  expect(await screen.findByRole('alert')).toHaveTextContent('日程暂时无法读取。')
})
