import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import LectureRecords, { lectureMarkdown } from './LectureRecords'
import { api } from '../api/client'

vi.mock('../api/client', () => ({
  api: {
    lectureRecords: vi.fn(),
    lectureRecord: vi.fn(),
    updateLectureRecord: vi.fn(),
    deleteLectureRecord: vi.fn(),
  },
}))

const base = {
  course_code: 'DASC7606',
  duration_seconds: 10200,
  recorded_seconds: 0,
  has_summary: false,
  created_at: '2026-11-12T14:00:00Z',
  updated_at: '2026-11-12T14:00:00Z',
}
const items = [
  {
    ...base,
    id: 'r2',
    course_name: 'Deep Learning',
    started_at: '2026-11-19T11:00:00Z',
    ended_at: '2026-11-19T13:50:00Z',
    note_count: 3,
    important_count: 1,
  },
  {
    ...base,
    id: 'r3',
    course_name: 'NLP',
    course_code: '',
    started_at: '2026-11-15T02:00:00Z',
    ended_at: '2026-11-15T03:00:00Z',
    duration_seconds: 3600,
    note_count: 0,
    important_count: 0,
  },
  {
    ...base,
    id: 'r1',
    course_name: 'Deep Learning',
    started_at: '2026-11-12T11:00:00Z',
    ended_at: '2026-11-12T13:50:00Z',
    note_count: 2,
    important_count: 0,
  },
]
const detail = {
  ...items[2],
  instructor: 'Dr. Synthetic',
  extra_info: '第 9 周',
  notes: [
    { at_seconds: 125, text: '作业二周五截止', important: true },
    { at_seconds: 3725, text: 'Adam = momentum + adaptive lr', important: false },
  ],
  summary: null,
  transcript: null,
}

beforeEach(() => {
  api.lectureRecords.mockResolvedValue({ items })
  api.lectureRecord.mockResolvedValue(detail)
})
afterEach(() => {
  cleanup()
  vi.resetAllMocks()
})

it('shows an empty state that leads to the live page', async () => {
  api.lectureRecords.mockResolvedValue({ items: [] })
  const onStart = vi.fn()
  render(<LectureRecords onStart={onStart} />)
  fireEvent.click(await screen.findByRole('button', { name: '去开始一节课' }))
  expect(onStart).toHaveBeenCalled()
})

it('groups records by course and opens, edits and deletes one', async () => {
  render(<LectureRecords onStart={vi.fn()} />)
  const dl = await screen.findByRole('region', { name: 'Deep Learning' })
  expect(within(dl).getByText('2 节')).toBeVisible()
  expect(
    within(dl)
      .getAllByRole('button')
      .map((b) => b.textContent),
  ).toEqual([
    expect.stringMatching(/^2026年11月19日 周四/),
    expect.stringMatching(/^2026年11月12日 周四/),
  ])
  expect(within(dl).getByRole('heading', { name: /Deep Learning/ })).toBeVisible()
  expect(within(dl).queryByText(/19:00/)).not.toBeInTheDocument()
  expect(within(dl).getByText(/3 条笔记，1 条重点/)).toBeVisible()
  expect(screen.getByRole('region', { name: 'NLP' })).toBeVisible()

  fireEvent.click(within(dl).getAllByRole('button')[1])
  const article = await screen.findByRole('article', { name: 'Deep Learning' })
  expect(api.lectureRecord).toHaveBeenCalledWith('r1')
  expect(within(article).getByText(/19:00–21:50，2 小时 50 分钟，Dr. Synthetic/)).toBeVisible()
  expect(within(article).getByText('作业二周五截止')).toBeVisible()
  expect(within(article).getByText('1:02:05')).toBeVisible()
  expect(within(article).getByText(/这节课没有保存 AI 摘要/)).toBeVisible()

  api.updateLectureRecord.mockImplementation(async (_id, changes) => ({ ...detail, ...changes }))
  fireEvent.click(within(article).getByRole('button', { name: '编辑' }))
  const form = screen.getByRole('form', { name: '编辑课程记录' })
  fireEvent.change(within(form).getByLabelText('课程名称'), {
    target: { value: 'Deep Learning (LEC)' },
  })
  fireEvent.change(within(form).getByLabelText('笔记 1:02:05'), { target: { value: '  ' } })
  await act(async () => {
    fireEvent.click(within(form).getByRole('button', { name: '保存修改' }))
  })
  expect(api.updateLectureRecord).toHaveBeenCalledWith('r1', {
    course_name: 'Deep Learning (LEC)',
    extra_info: '第 9 周',
    notes: [{ at_seconds: 125, text: '作业二周五截止', important: true }],
  })
  expect(screen.getByText('已保存修改。')).toBeVisible()
  expect(screen.getByRole('heading', { name: 'Deep Learning (LEC)' })).toBeVisible()

  api.deleteLectureRecord.mockResolvedValue(null)
  fireEvent.click(screen.getByRole('button', { name: '删除' }))
  const confirm = screen.getByRole('group', { name: '确认删除课程记录' })
  await act(async () => {
    fireEvent.click(within(confirm).getByRole('button', { name: '删除' }))
  })
  expect(api.deleteLectureRecord).toHaveBeenCalledWith('r1')
  expect(await screen.findByText('课程记录已删除。')).toBeVisible()
})

it('exports a readable Markdown file', () => {
  const text = lectureMarkdown(detail)
  expect(text).toContain('# Deep Learning（DASC7606）')
  expect(text).toContain('19:00–21:50（香港时间）')
  expect(text).toContain('- 授课老师：Dr. Synthetic')
  expect(text).toContain('## 其他信息\n\n第 9 周')
  expect(text).toContain('- [02:05] ★ 作业二周五截止')
  expect(text).toContain('- [1:02:05] Adam = momentum + adaptive lr')
  expect(text).not.toContain('AI 摘要')
})

it('shows and exports a saved transcript', async () => {
  const withTranscript = {
    ...detail,
    transcript: [
      { at_seconds: 62.5, en: 'Adam combines momentum.', zh: 'Adam 结合了动量。' },
      { at_seconds: 70, en: 'Next slide.', zh: null },
    ],
  }
  api.lectureRecord.mockResolvedValue(withTranscript)
  render(<LectureRecords onStart={vi.fn()} />)
  const dl = await screen.findByRole('region', { name: 'Deep Learning' })
  fireEvent.click(within(dl).getAllByRole('button')[0])
  const article = await screen.findByRole('article', { name: 'Deep Learning' })
  expect(within(article).getByText('转写与译文（2 段）')).toBeVisible()
  expect(within(article).getByText('（无译文）')).toBeInTheDocument()
  const text = lectureMarkdown(withTranscript)
  expect(text).toContain('## 转写与译文\n\n- [01:02] Adam combines momentum.\n  Adam 结合了动量。')
  expect(text).toContain('- [01:10] Next slide.')
})

it('shows and exports a saved AI summary with times and quotes', async () => {
  const withSummary = {
    ...detail,
    has_summary: true,
    summary: {
      version: 'lecture-summary-v1',
      model: 'qwen3:4b-instruct-2507-q4_K_M',
      generated_at: '2026-11-12T14:00:00+00:00',
      overview: '本节课比较了 SGD 与 Adam。',
      key_points: [
        {
          text: 'Adam 结合了动量与自适应学习率。',
          at_seconds: 3725.4,
          quotes: [{ at_seconds: 3725.4, en: 'Adam combines momentum with adaptive rates.' }],
        },
      ],
      reminders: [{ kind: 'exam', text: '批归一化会考。', at_seconds: 125, quotes: [] }],
      line_count: 40,
      part_count: 1,
      elapsed_seconds: 30,
    },
  }
  api.lectureRecord.mockResolvedValue(withSummary)
  render(<LectureRecords onStart={vi.fn()} />)
  const dl = await screen.findByRole('region', { name: 'Deep Learning' })
  fireEvent.click(within(dl).getAllByRole('button')[0])
  const article = await screen.findByRole('article', { name: 'Deep Learning' })
  const section = within(article).getByRole('region', { name: 'AI 摘要' })
  expect(within(section).getByText('本节课比较了 SGD 与 Adam。')).toBeVisible()
  expect(within(section).getByText('考试')).toBeVisible()
  const points = within(section).getByRole('list', { name: '课程重点' })
  expect(within(points).getAllByText('1:02:05')[0]).toBeVisible()
  const text = lectureMarkdown(withSummary)
  expect(text).toContain('## AI 摘要\n\n本节课比较了 SGD 与 Adam。')
  expect(text).toContain('- [02:05] 考试：批归一化会考。')
  expect(text).toContain('- [1:02:05] Adam 结合了动量与自适应学习率。\n  > Adam combines momentum')
})
