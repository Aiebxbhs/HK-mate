import { afterEach, expect, it, vi } from 'vitest'
import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import Timetable, { courseKey, mondayOf, semesterWeeks } from './Timetable'
import { api } from '../api/client'

vi.mock('../api/client', () => ({
  api: { calendarEvents: vi.fn(), calendarCourses: vi.fn(), importTimetable: vi.fn() },
}))

const lecture = (id, date) => ({
  id,
  source: 'hku',
  kind: 'event',
  completed: false,
  title: 'TEST7607-1A (LEC)',
  course_name: 'Synthetic Course',
  location: 'LE1',
  description: '',
  starts_at: `${date}T19:00:00+08:00`,
  ends_at: `${date}T22:00:00+08:00`,
})

const courses = [
  {
    code: 'TEST7607',
    section: '1A',
    course_name: 'Synthetic Course',
    sessions: 2,
    first_date: '2026-11-02',
    last_date: '2026-11-09',
    slots: [{ weekday: 0, start: '19:00', end: '22:00', location: 'LE1', count: 2 }],
    exams: [
      {
        starts_at: '2026-12-10T09:30:00+08:00',
        ends_at: '2026-12-10T11:30:00+08:00',
        location: 'Hall',
      },
    ],
  },
  {
    code: 'DEMO5101',
    section: '1',
    course_name: '',
    sessions: 1,
    first_date: '2026-11-07',
    last_date: '2026-11-07',
    slots: [{ weekday: 5, start: '10:00', end: '11:50', location: 'PAP-706A', count: 1 }],
    exams: [],
  },
]

afterEach(() => {
  cleanup()
  vi.resetAllMocks()
})

it('finds the Monday of a week and the course code of a title', () => {
  expect(mondayOf('2026-11-15')).toBe('2026-11-09')
  expect(mondayOf('2026-11-09')).toBe('2026-11-09')
  expect(courseKey('COMP7607-1A (LEC)')).toBe('COMP7607')
  expect(courseKey('SFEC5101_1')).toBe('SFEC5101')
  expect(courseKey('Orientation Talk')).toBe('Orientation Talk')
})

it('spans whole weeks from the first class to the last exam', () => {
  const weeks = semesterWeeks(courses)
  expect(weeks[0][0]).toBe('2026-11-02')
  expect(weeks[weeks.length - 1]).toEqual([
    '2026-12-07',
    '2026-12-08',
    '2026-12-09',
    '2026-12-10',
    '2026-12-11',
    '2026-12-12',
    '2026-12-13',
  ])
  expect(weeks).toHaveLength(6)
  expect(semesterWeeks([])).toEqual([])
})

it('shows the whole semester as one long calendar', async () => {
  const user = userEvent.setup()
  api.calendarCourses.mockResolvedValue({ courses })
  api.calendarEvents.mockResolvedValue({
    total_events: 3,
    items: [
      lecture('a', '2026-11-02'),
      lecture('b', '2026-11-09'),
      { ...lecture('m', '2026-11-03'), source: 'manual', title: 'Dinner' },
    ],
  })
  render(<Timetable today="2026-11-04" />)
  const page = await screen.findByRole('region', { name: '我的课表' })
  expect(api.calendarEvents).toHaveBeenCalledWith({
    startDate: '2026-11-02',
    endDate: '2026-12-14',
  })
  const grid = within(page).getByRole('table', { name: '学期课表' })
  expect(within(grid).getAllByRole('columnheader')).toHaveLength(7)
  // Six week rows plus the weekday header; no week-by-week paging.
  expect(within(grid).getAllByRole('row')).toHaveLength(7)
  expect(within(page).queryByRole('button', { name: /后 4 周/ })).not.toBeInTheDocument()
  expect(within(page).getByRole('button', { name: '回到本周' })).toBeVisible()
  // Only HKU courses are on the timetable, not manual schedule items.
  expect(within(grid).getAllByRole('button', { name: /TEST7607 1A/ })).toHaveLength(2)
  expect(within(grid).queryByText('Dinner')).not.toBeInTheDocument()
  expect(within(grid).getByText('今天')).toBeVisible()

  await user.click(within(grid).getAllByRole('button', { name: /TEST7607 1A/ })[0])
  const detail = within(page).getByRole('article', { name: '课程详情' })
  expect(detail).toHaveTextContent('Synthetic Course')
  expect(detail).toHaveTextContent('11月2日 19:00–22:00')
  // The details open right under the week of the class.
  expect(within(grid).getAllByRole('row')).toHaveLength(8)

  // The page has only the timetable, no separate course list.
  expect(within(page).queryByRole('region', { name: '课程一览' })).not.toBeInTheDocument()
})

it('asks first-time users for their HKU link, with a tutorial, and imports it', async () => {
  const user = userEvent.setup()
  api.calendarCourses.mockResolvedValueOnce({ courses: [] }).mockResolvedValue({ courses })
  api.calendarEvents.mockResolvedValue({ total_events: 0, items: [] })
  api.importTimetable.mockRejectedValueOnce(new Error('请粘贴 HKU Event Calendar 的订阅链接。'))
  api.importTimetable.mockResolvedValue({ imported: 2, skipped_all_day: 1 })
  render(<Timetable today="2026-11-04" />)
  const panel = await screen.findByRole('region', { name: '导入 HKU 课表' })
  expect(within(panel).getByRole('heading', { name: '如何找到课表链接' })).toBeVisible()
  expect(within(panel).getAllByRole('img')).toHaveLength(4)
  const field = within(panel).getByLabelText('课表订阅链接（Subscription URL）')

  await user.click(within(panel).getByRole('button', { name: '导入课表' }))
  expect(within(panel).getByRole('alert')).toHaveTextContent('请先粘贴课表订阅链接。')
  expect(api.importTimetable).not.toHaveBeenCalled()

  await user.type(field, 'https://evil.example/x')
  await user.click(within(panel).getByRole('button', { name: '导入课表' }))
  expect(await within(panel).findByRole('alert')).toHaveTextContent('订阅链接')

  await user.clear(field)
  await user.type(field, ' webcal://sis.hku.hk/feed ')
  await user.click(within(panel).getByRole('button', { name: '导入课表' }))
  expect(api.importTimetable).toHaveBeenLastCalledWith('webcal://sis.hku.hk/feed')
  expect(await screen.findByRole('region', { name: '我的课表' })).toBeVisible()
  expect(screen.getByRole('status')).toHaveTextContent(
    '已导入 2 节课程和考试，跳过 1 个全天事件（如大学假期）。',
  )
  // Re-importing later uses the same form, with the tutorial folded away.
  await user.click(screen.getByRole('button', { name: '重新导入' }))
  expect(screen.getByRole('region', { name: '导入 HKU 课表' })).toHaveTextContent(
    '重新导入 HKU 课表',
  )
})

it('loads a long semester in parts of at most 100 days', async () => {
  const long = [{ ...courses[0], first_date: '2026-09-01', last_date: '2026-12-19', exams: [] }]
  api.calendarCourses.mockResolvedValue({ courses: long })
  api.calendarEvents.mockResolvedValue({ total_events: 0, items: [] })
  render(<Timetable today="2026-11-04" />)
  await screen.findByRole('region', { name: '我的课表' })
  expect(api.calendarEvents.mock.calls.map(([range]) => range)).toEqual([
    { startDate: '2026-08-31', endDate: '2026-12-07' },
    { startDate: '2026-12-07', endDate: '2026-12-21' },
  ])
})
