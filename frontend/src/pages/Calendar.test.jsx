import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import Calendar from './Calendar'
import { api } from '../api/client'

vi.mock('../api/client', () => ({
  api: {
    calendarEvents: vi.fn(),
    createCalendarEvent: vi.fn(),
    updateCalendarEvent: vi.fn(),
    deleteCalendarEvent: vi.fn(),
  },
}))

const course = {
  id: 'hku-course',
  source: 'hku',
  title: 'DASC7606-1B (LEC)',
  course_name: 'Deep learning',
  location: 'LE1',
  description: '<script>not executable</script>',
  starts_at: '2026-11-12T19:00:00+08:00',
  ends_at: '2026-11-12T21:50:00+08:00',
}
const meeting = {
  id: 'manual-meeting',
  source: 'manual',
  title: '小组讨论',
  course_name: '',
  location: 'Library 3F',
  description: '',
  starts_at: '2026-11-13T14:00:00+08:00',
  ends_at: '2026-11-13T15:00:00+08:00',
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-11-12T04:00:00Z')) // 12:00 in Hong Kong
  api.calendarEvents.mockResolvedValue({ items: [course, meeting], total_events: 2 })
})

afterEach(() => {
  cleanup()
  vi.useRealTimers()
  vi.resetAllMocks()
})

it('lists the next 100 days grouped by day with time, place and source', async () => {
  const { container } = render(<Calendar />)
  const today = await screen.findByRole('region', { name: /^今天 11 月 12 日/ })
  expect(within(today).getByText('19:00')).toBeVisible()
  expect(within(today).getByText('LE1')).toBeVisible()
  expect(within(today).getByText('HKU 课表')).toBeVisible()
  expect(within(today).getByText('7 小时后开始')).toBeVisible()
  const tomorrow = screen.getByRole('region', { name: /^明天 11 月 13 日/ })
  expect(within(tomorrow).getByText('小组讨论')).toBeVisible()
  // Only timetable classes are labelled; your own items have edit buttons instead.
  expect(within(tomorrow).queryByText('HKU 课表')).not.toBeInTheDocument()
  expect(within(tomorrow).getByRole('button', { name: '编辑 小组讨论' })).toBeVisible()
  expect(screen.getByText(/共 2 项/)).toBeVisible()
  expect(container.querySelector('script')).toBeNull()
  expect(api.calendarEvents).toHaveBeenCalledWith({
    startDate: '2026-11-12',
    endDate: '2027-02-20',
  })
})

it('adds a schedule in Hong Kong time and refreshes the list', async () => {
  api.createCalendarEvent.mockResolvedValue({ ...meeting, id: 'new' })
  render(<Calendar startAdding />)
  const user = userEvent.setup()
  const form = await screen.findByRole('form', { name: '添加日程' })
  expect(within(form).getByLabelText('标题')).toHaveFocus()
  expect(within(form).getByLabelText('日期')).toHaveValue('2026-11-12')
  expect(within(form).getByLabelText('开始')).toHaveValue('13:00')
  expect(within(form).getByLabelText('结束')).toHaveValue('14:00')

  await user.click(within(form).getByRole('button', { name: '保存日程' }))
  expect(within(form).getByRole('alert')).toHaveTextContent('请填写日程标题。')
  expect(api.createCalendarEvent).not.toHaveBeenCalled()

  await user.type(within(form).getByLabelText('标题'), '  Office hour ')
  fireEvent.change(within(form).getByLabelText('开始'), { target: { value: '14:30' } })
  expect(within(form).getByLabelText('结束')).toHaveValue('15:30')
  await user.type(within(form).getByLabelText('地点（可选）'), 'HW-512')
  await user.click(within(form).getByRole('button', { name: '保存日程' }))

  expect(api.createCalendarEvent).toHaveBeenCalledWith({
    kind: 'event',
    title: 'Office hour',
    date: '2026-11-12',
    start_time: '14:30',
    end_time: '15:30',
    location: 'HW-512',
  })
  expect(await screen.findByText('日程已添加。')).toBeVisible()
  expect(screen.queryByRole('form', { name: '添加日程' })).not.toBeInTheDocument()
  expect(api.calendarEvents).toHaveBeenCalledTimes(2)
})

it('shows a server error and keeps the form open', async () => {
  api.createCalendarEvent.mockRejectedValue(new Error('结束时间需要晚于开始时间。'))
  render(<Calendar startAdding />)
  const user = userEvent.setup()
  const form = await screen.findByRole('form', { name: '添加日程' })
  await user.type(within(form).getByLabelText('标题'), '复习')
  await user.click(within(form).getByRole('button', { name: '保存日程' }))
  expect(await within(form).findByRole('alert')).toHaveTextContent('结束时间需要晚于开始时间。')
  expect(within(form).getByRole('button', { name: '保存日程' })).toBeEnabled()
})

it('confirms before deleting and can cancel', async () => {
  api.deleteCalendarEvent.mockResolvedValue(null)
  render(<Calendar />)
  const user = userEvent.setup()
  await user.click(await screen.findByRole('button', { name: '删除 小组讨论' }))
  const confirm = screen.getByRole('group', { name: '确认删除 小组讨论' })
  await user.click(within(confirm).getByRole('button', { name: '取消' }))
  expect(api.deleteCalendarEvent).not.toHaveBeenCalled()

  await user.click(screen.getByRole('button', { name: '删除 DASC7606-1B (LEC)' }))
  expect(screen.getByText('删除这节课？重新导入课表后会恢复。')).toBeVisible()
  await user.click(
    within(screen.getByRole('group', { name: '确认删除 DASC7606-1B (LEC)' })).getByRole('button', {
      name: '删除',
    }),
  )
  expect(api.deleteCalendarEvent).toHaveBeenCalledWith('hku-course')
  expect(await screen.findByText('日程已删除。')).toBeVisible()
})

it('edits my own schedule items in place, but not HKU courses', async () => {
  api.updateCalendarEvent.mockResolvedValue({ ...meeting, title: '组会' })
  render(<Calendar />)
  const user = userEvent.setup()
  expect(await screen.findByRole('button', { name: '编辑 小组讨论' })).toBeVisible()
  expect(screen.queryByRole('button', { name: '编辑 DASC7606-1B (LEC)' })).not.toBeInTheDocument()

  await user.click(screen.getByRole('button', { name: '编辑 小组讨论' }))
  const form = screen.getByRole('form', { name: '编辑日程' })
  // The form starts from the item's current values, in Hong Kong time.
  expect(within(form).getByLabelText('标题')).toHaveValue('小组讨论')
  expect(within(form).getByLabelText('日期')).toHaveValue('2026-11-13')
  expect(within(form).getByLabelText('开始')).toHaveValue('14:00')
  expect(within(form).getByLabelText('结束')).toHaveValue('15:00')
  expect(within(form).getByLabelText('地点（可选）')).toHaveValue('Library 3F')

  await user.click(within(form).getByRole('button', { name: '取消' }))
  expect(screen.queryByRole('form', { name: '编辑日程' })).not.toBeInTheDocument()
  expect(api.updateCalendarEvent).not.toHaveBeenCalled()

  await user.click(screen.getByRole('button', { name: '编辑 小组讨论' }))
  const again = screen.getByRole('form', { name: '编辑日程' })
  const title = within(again).getByLabelText('标题')
  await user.clear(title)
  await user.type(title, '组会')
  fireEvent.change(within(again).getByLabelText('结束'), { target: { value: '16:30' } })
  await user.click(within(again).getByRole('button', { name: '保存修改' }))
  expect(api.updateCalendarEvent).toHaveBeenCalledWith('manual-meeting', {
    kind: 'event',
    title: '组会',
    date: '2026-11-13',
    start_time: '14:00',
    end_time: '16:30',
    location: 'Library 3F',
  })
  expect(await screen.findByText('日程已修改。')).toBeVisible()
  expect(screen.queryByRole('form', { name: '编辑日程' })).not.toBeInTheDocument()
})

it('shows an empty state that points to adding', async () => {
  api.calendarEvents.mockResolvedValue({ items: [], total_events: 0 })
  render(<Calendar />)
  expect(await screen.findByText(/还没有日程，点击“添加日程”创建一项/)).toBeVisible()
  expect(screen.getByRole('button', { name: '添加日程' })).toBeVisible()
})

it('adds a deadline with a single due time and shows its progress bar', async () => {
  api.createCalendarEvent.mockResolvedValue({ ...meeting, id: 'ddl' })
  render(<Calendar startAdding />)
  const form = await screen.findByRole('form', { name: '添加日程' })
  fireEvent.click(within(form).getByLabelText('截止事项'))
  expect(within(form).queryByLabelText('开始')).not.toBeInTheDocument()
  expect(within(form).getByLabelText('截止时间')).toHaveValue('23:59')
  fireEvent.change(within(form).getByLabelText('标题'), { target: { value: 'Assignment 2' } })
  fireEvent.change(within(form).getByLabelText('日期'), { target: { value: '2026-11-20' } })
  fireEvent.change(within(form).getByLabelText('截止时间'), { target: { value: '18:00' } })
  fireEvent.click(within(form).getByRole('button', { name: '保存日程' }))
  expect(await screen.findByText('日程已添加。')).toBeVisible()
  expect(api.createCalendarEvent).toHaveBeenCalledWith({
    kind: 'deadline',
    title: 'Assignment 2',
    date: '2026-11-20',
    start_time: '18:00',
    location: '',
  })
})

it('shows deadline bars and lets finished items be marked done', async () => {
  api.calendarEvents.mockResolvedValue({
    total_events: 2,
    items: [
      course,
      {
        ...meeting,
        id: 'ddl',
        kind: 'deadline',
        title: 'Project report',
        starts_at: '2026-11-20T18:00:00+08:00',
        ends_at: '2026-11-20T18:00:00+08:00',
      },
    ],
  })
  api.setEventCompleted = vi.fn().mockResolvedValue({})
  render(<Calendar />)
  // 8 days and 6 hours left: two yellow-green cells.
  expect(await screen.findByRole('meter', { name: '截止进度：充裕，还剩 8 天' })).toBeVisible()
  fireEvent.click(screen.getByRole('button', { name: '完成 DASC7606-1B (LEC)' }))
  expect(api.setEventCompleted).toHaveBeenCalledWith('hku-course', true)
})
