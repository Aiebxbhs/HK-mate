import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import LectureLive from './LectureLive'
import { api } from '../api/client'
import { startLectureStream } from '../components/lecture-stream'

vi.mock('../components/lecture-stream', async (original) => ({
  ...(await original()),
  startLectureStream: vi.fn(),
}))

vi.mock('../api/client', () => ({
  api: { lectureRecords: vi.fn(), createLectureRecord: vi.fn(), lectureSummary: vi.fn() },
}))

const user = { id: 'user-1' }
const START = new Date('2026-11-12T11:00:00Z') // 19:00 in Hong Kong

beforeEach(() => {
  localStorage.clear()
  vi.useFakeTimers({ toFake: ['Date', 'setInterval', 'clearInterval'] })
  vi.setSystemTime(START)
  api.lectureRecords.mockResolvedValue({
    items: [{ course_name: 'Deep Learning' }, { course_name: 'Deep Learning' }],
  })
  api.createLectureRecord.mockImplementation(async (record) => ({ id: 'r1', ...record }))
})
afterEach(() => {
  cleanup()
  vi.useRealTimers()
  vi.resetAllMocks()
})

function confirmEnd() {
  fireEvent.click(screen.getByRole('button', { name: '结束课程' }))
  const ask = screen.getByRole('group', { name: '确认结束课程' })
  fireEvent.click(within(ask).getByRole('button', { name: '结束课程' }))
}

function addNote(text, options = {}) {
  const box = screen.getByPlaceholderText(/写下笔记，按回车添加/)
  fireEvent.change(box, { target: { value: text } })
  fireEvent.keyDown(box, { key: 'Enter', ...options })
}

it('times the lecture and keeps timestamped notes, also across a reload', async () => {
  const { unmount } = render(<LectureLive user={user} onOpenRecords={vi.fn()} />)
  expect(screen.queryByRole('button', { name: /开始录音/ })).not.toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: /开始课程/ }))
  expect(screen.getByText('上课中，19:00 开始，已录音 00:00')).toBeVisible()
  expect(screen.getByRole('button', { name: '开始录音' })).toBeEnabled()

  await act(async () => {
    // advanceTimersByTime also moves the fake clock forward by 1 second.
    vi.setSystemTime(new Date(START.getTime() + 124_000))
    vi.advanceTimersByTime(1000)
  })
  expect(screen.getByLabelText('本节课已进行')).toHaveTextContent('02:05')
  addNote('作业二下周五截止')
  // Enter while composing Chinese input must not add a half-typed note.
  addNote('正在输入', { isComposing: true })
  expect(screen.getAllByRole('listitem')).toHaveLength(1)
  addNote('   ')
  fireEvent.change(screen.getByPlaceholderText(/写下笔记/), { target: { value: '' } })

  await act(async () => {
    vi.setSystemTime(new Date(START.getTime() + 3_724_000))
    vi.advanceTimersByTime(1000)
  })
  addNote('Adam = momentum + adaptive lr')
  const notes = within(screen.getByRole('region', { name: '课堂笔记' })).getAllByRole('listitem')
  expect(notes.map((li) => li.querySelector('.lecture-note-time').textContent)).toEqual([
    '02:05',
    '1:02:05',
  ])
  fireEvent.click(within(notes[1]).getByRole('button', { name: '标为重点' }))
  fireEvent.click(within(notes[0]).getByRole('button', { name: '编辑' }))
  fireEvent.change(screen.getByLabelText('编辑笔记'), {
    target: { value: '作业二周五 23:59 截止' },
  })
  fireEvent.click(screen.getByRole('button', { name: '完成' }))
  expect(screen.getByText('作业二周五 23:59 截止')).toBeVisible()

  const stored = JSON.parse(localStorage.getItem('hkmate.lecture.draft.user-1'))
  expect(stored.startedAt).toBe(START.toISOString())
  expect(stored.notes.map((note) => [note.at_seconds, note.important])).toEqual([
    [125, false],
    [3725, true],
  ])
  expect(localStorage.getItem('hkmate.lecture.draft.user-2')).toBeNull()

  unmount()
  render(<LectureLive user={user} onOpenRecords={vi.fn()} />)
  expect(screen.getByText(/已恢复未结束的课程（19:00 开始）/)).toBeVisible()
  expect(screen.getByText('Adam = momentum + adaptive lr')).toBeVisible()
  fireEvent.click(within(screen.getAllByRole('listitem')[0]).getByRole('button', { name: '删除' }))
  expect(screen.queryByText('作业二周五 23:59 截止')).not.toBeInTheDocument()

  // Another account on the same browser does not see this lecture.
  cleanup()
  render(<LectureLive user={{ id: 'user-2' }} onOpenRecords={vi.fn()} />)
  expect(screen.getByRole('button', { name: /开始课程/ })).toBeVisible()
})

it('ends the course, requires a course name and saves notes with course info', async () => {
  const onOpenRecords = vi.fn()
  render(<LectureLive user={user} onOpenRecords={onOpenRecords} />)
  fireEvent.click(screen.getByRole('button', { name: /开始课程/ }))
  await act(async () => {
    vi.setSystemTime(new Date(START.getTime() + 60_000))
  })
  addNote('第一条')
  await act(async () => {
    vi.setSystemTime(new Date(START.getTime() + 5_400_000))
  })
  // Ending asks first; "继续上课" keeps the lecture going.
  fireEvent.click(screen.getByRole('button', { name: '结束课程' }))
  expect(screen.getByText('确定要结束课程吗？')).toBeVisible()
  fireEvent.click(screen.getByRole('button', { name: '继续上课' }))
  expect(screen.queryByRole('form', { name: '保存课程' })).not.toBeInTheDocument()
  confirmEnd()

  const form = screen.getByRole('form', { name: '保存课程' })
  expect(within(form).getByText(/19:00–20:30，时长 1 小时 30 分钟，\s*1 条笔记/)).toBeVisible()
  expect(within(form).getByLabelText(/AI 摘要与重点/)).toBeDisabled()
  expect(within(form).getByText('这节课没有录音字幕，无法生成 AI 摘要。')).toBeVisible()
  expect(api.lectureSummary).not.toHaveBeenCalled()
  expect(within(form).getByLabelText(/逐句转写与译文/)).toBeDisabled()
  expect(await screen.findAllByRole('option', { hidden: true })).toHaveLength(1)

  fireEvent.click(within(form).getByRole('button', { name: '保存到课程记录' }))
  expect(within(form).getByRole('alert')).toHaveTextContent('请填写课程名称。')
  expect(api.createLectureRecord).not.toHaveBeenCalled()

  fireEvent.change(within(form).getByLabelText('课程名称（必填）'), {
    target: { value: ' Deep Learning ' },
  })
  expect(within(form).queryByLabelText(/课程编号/)).not.toBeInTheDocument()
  expect(within(form).queryByLabelText(/授课老师/)).not.toBeInTheDocument()
  fireEvent.change(within(form).getByLabelText('其他信息（可选）'), {
    target: { value: '第 9 周' },
  })
  await act(async () => {
    fireEvent.click(within(form).getByRole('button', { name: '保存到课程记录' }))
  })
  expect(api.createLectureRecord).toHaveBeenCalledWith({
    course_name: 'Deep Learning',
    extra_info: '第 9 周',
    started_at: START.toISOString(),
    ended_at: new Date(START.getTime() + 5_400_000).toISOString(),
    recorded_seconds: 0,
    summary: null,
    transcript: null,
    notes: [{ at_seconds: 60, text: '第一条', important: false }],
  })
  expect(screen.getByText(/已保存到课程记录：Deep Learning/)).toBeVisible()
  expect(localStorage.getItem('hkmate.lecture.draft.user-1')).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: '查看课程记录' }))
  expect(onOpenRecords).toHaveBeenCalled()
})

it('can return to the lecture, save without notes, or discard after confirming', async () => {
  render(<LectureLive user={user} onOpenRecords={vi.fn()} />)
  fireEvent.click(screen.getByRole('button', { name: /开始课程/ }))
  await act(async () => {
    vi.setSystemTime(new Date(START.getTime() + 30_000))
  })
  addNote('私人笔记')
  confirmEnd()
  fireEvent.click(screen.getByRole('button', { name: '返回课程' }))
  expect(screen.getByText('私人笔记')).toBeVisible()
  expect(JSON.parse(localStorage.getItem('hkmate.lecture.draft.user-1')).endedAt).toBeUndefined()

  confirmEnd()
  fireEvent.click(screen.getByRole('button', { name: '不保存，丢弃' }))
  const confirm = screen.getByRole('group', { name: '确认丢弃本节课' })
  fireEvent.click(within(confirm).getByRole('button', { name: '取消' }))
  fireEvent.click(screen.getByLabelText(/我的笔记/))
  fireEvent.change(screen.getByLabelText('课程名称（必填）'), { target: { value: 'NLP' } })
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: '保存到课程记录' }))
  })
  expect(api.createLectureRecord.mock.calls[0][0].notes).toEqual([])

  fireEvent.click(screen.getByRole('button', { name: /开始课程/ }))
  confirmEnd()
  fireEvent.click(screen.getByRole('button', { name: '不保存，丢弃' }))
  fireEvent.click(
    within(screen.getByRole('group', { name: '确认丢弃本节课' })).getByRole('button', {
      name: '丢弃',
    }),
  )
  expect(screen.getByRole('button', { name: /开始课程/ })).toBeVisible()
  expect(localStorage.getItem('hkmate.lecture.draft.user-1')).toBeNull()
  expect(api.createLectureRecord).toHaveBeenCalledTimes(1)
})

function fakeStream() {
  const handlers = {}
  const handle = { stop: vi.fn(), abort: vi.fn() }
  startLectureStream.mockImplementation(async (given) => {
    Object.assign(handlers, given)
    return handle
  })
  return { handlers, handle }
}

it('asks for permission once, then records segments with bilingual captions', async () => {
  const { handlers, handle } = fakeStream()
  render(<LectureLive user={user} onOpenRecords={vi.fn()} />)
  fireEvent.click(screen.getByRole('button', { name: /开始课程/ }))
  await act(async () => {
    vi.setSystemTime(new Date(START.getTime() + 60_000))
  })
  fireEvent.click(screen.getByRole('button', { name: '开始录音' }))
  const consent = screen.getByRole('group', { name: '录音前确认' })
  expect(startLectureStream).not.toHaveBeenCalled()
  await act(async () => {
    fireEvent.click(within(consent).getByRole('button', { name: '我已确认，开始录音' }))
  })
  expect(localStorage.getItem('hkmate.lecture.consent.user-1')).toBe('1')
  expect(startLectureStream).toHaveBeenCalledTimes(1)

  await act(async () => {
    handlers.onStatus('loading')
  })
  expect(screen.getByText('正在加载语音模型…')).toBeVisible()
  await act(async () => {
    handlers.onStatus('listening')
    handlers.onPartial({ type: 'partial', offset: 2.5, en: 'Adam combines' })
  })
  // While the lecturer is still speaking, the unfinished sentence shows in grey.
  expect(screen.getByText('Adam combines')).toBeVisible()
  expect(screen.getByText('正在听…')).toBeVisible()
  expect(localStorage.getItem('hkmate.lecture.draft.user-1')).not.toContain('Adam combines"')
  await act(async () => {
    handlers.onCaption({ id: 1, offset: 2.5, duration: 3, en: 'Adam combines momentum.' })
  })
  expect(screen.queryByText('Adam combines')).not.toBeInTheDocument()
  expect(screen.queryByText('正在听…')).not.toBeInTheDocument()
  const captions = screen.getByRole('region', { name: '实时字幕' })
  expect(within(captions).getByText('Adam combines momentum.')).toBeVisible()
  expect(within(captions).getByText('翻译中…')).toBeVisible()
  // 60 s into the course + 2.5 s into this recording.
  expect(within(captions).getByText('01:02')).toBeVisible()
  await act(async () => {
    handlers.onTranslation({ id: 1, zh: 'Adam 结合了动量。' })
    handlers.onCaption({ id: 2, offset: 6, duration: 2, en: 'Next slide.' })
    handlers.onTranslation({ id: 2, zh: null })
  })
  expect(within(captions).getByText('Adam 结合了动量。')).toBeVisible()
  expect(within(captions).getByText('（这句没有翻译成功）')).toBeVisible()

  await act(async () => {
    vi.setSystemTime(new Date(START.getTime() + 90_000))
  })
  fireEvent.click(screen.getByRole('button', { name: '暂停录音' }))
  expect(handle.stop).toHaveBeenCalled()
  expect(screen.getByRole('button', { name: '正在暂停…' })).toBeDisabled()
  await act(async () => {
    handlers.onClosed()
  })
  expect(screen.getByText(/已录音 00:30/)).toBeVisible()

  // The second recording continues without asking again.
  fireEvent.click(screen.getByRole('button', { name: '继续录音' }))
  expect(screen.queryByRole('group', { name: '录音前确认' })).not.toBeInTheDocument()
  await act(async () => {})
  expect(startLectureStream).toHaveBeenCalledTimes(2)
  const stored = JSON.parse(localStorage.getItem('hkmate.lecture.draft.user-1'))
  expect(stored.captions.map((c) => [c.at_seconds, c.status])).toEqual([
    [62.5, 'done'],
    [66, 'failed'],
  ])
  expect(stored.segments.length).toBe(2)
})

it('saves the transcript only when ticked, and reports microphone errors', async () => {
  const { handlers } = fakeStream()
  localStorage.setItem('hkmate.lecture.consent.user-1', '1')
  render(<LectureLive user={user} onOpenRecords={vi.fn()} />)
  fireEvent.click(screen.getByRole('button', { name: /开始课程/ }))
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: '开始录音' }))
  })
  await act(async () => {
    handlers.onCaption({ id: 1, offset: 1, duration: 2, en: 'Gradient descent.' })
    handlers.onTranslation({ id: 1, zh: '梯度下降。' })
    vi.setSystemTime(new Date(START.getTime() + 120_000))
  })
  confirmEnd()
  const form = screen.getByRole('form', { name: '保存课程' })
  const transcript = within(form).getByLabelText('逐句转写与译文（1 句）')
  expect(transcript).not.toBeChecked()
  fireEvent.click(transcript)
  fireEvent.change(within(form).getByLabelText('课程名称（必填）'), { target: { value: 'ML' } })
  await act(async () => {
    fireEvent.click(within(form).getByRole('button', { name: '保存到课程记录' }))
  })
  const sent = api.createLectureRecord.mock.calls[0][0]
  expect(sent.transcript).toEqual([{ at_seconds: 1, en: 'Gradient descent.', zh: '梯度下降。' }])
  expect(sent.recorded_seconds).toBe(120)

  cleanup()
  startLectureStream.mockRejectedValue(new Error('浏览器没有获得麦克风权限'))
  render(<LectureLive user={user} onOpenRecords={vi.fn()} />)
  fireEvent.click(screen.getByRole('button', { name: /开始课程/ }))
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: '开始录音' }))
  })
  expect(screen.getByRole('alert')).toHaveTextContent('浏览器没有获得麦克风权限')
  expect(screen.getByRole('button', { name: '开始录音' })).toBeVisible()
  expect(JSON.parse(localStorage.getItem('hkmate.lecture.draft.user-1')).segments).toEqual([])
})

const SUMMARY = {
  version: 'lecture-summary-v1',
  model: 'qwen3:4b-instruct-2507-q4_K_M',
  generated_at: '2026-11-12T11:05:00+00:00',
  overview: '本节课介绍了 Adam 优化器。',
  key_points: [
    {
      text: 'Adam 结合了动量与自适应学习率。',
      at_seconds: 62.5,
      quotes: [{ at_seconds: 62.5, en: 'Adam combines momentum.' }],
    },
  ],
  reminders: [
    {
      kind: 'deadline',
      text: '作业二下周五截止。',
      at_seconds: 66,
      quotes: [{ at_seconds: 66, en: 'Assignment two is due next Friday.' }],
    },
  ],
  line_count: 2,
  part_count: 1,
  elapsed_seconds: 12.3,
}

async function endRecordedCourse(handlers) {
  fireEvent.click(screen.getByRole('button', { name: /开始课程/ }))
  await act(async () => {
    vi.setSystemTime(new Date(START.getTime() + 60_000))
    fireEvent.click(screen.getByRole('button', { name: '开始录音' }))
  })
  await act(async () => {
    handlers.onStatus('listening')
    handlers.onCaption({ id: 1, offset: 2.5, duration: 3, en: 'Adam combines momentum.' })
    handlers.onCaption({ id: 2, offset: 6, duration: 2, en: 'Assignment two is due next Friday.' })
    handlers.onTranslation({ id: 1, zh: 'Adam 结合了动量。' })
  })
  addNote('作业！')
  fireEvent.click(screen.getByRole('button', { name: /重点/ }))
  await act(async () => {
    vi.setSystemTime(new Date(START.getTime() + 120_000))
  })
  confirmEnd()
}

it('generates the summary after the last caption and saves it when kept', async () => {
  const { handlers } = fakeStream()
  localStorage.setItem('hkmate.lecture.consent.user-1', '1')
  let finish
  api.lectureSummary.mockImplementation(() => new Promise((resolve) => (finish = resolve)))
  const { unmount } = render(<LectureLive user={user} onOpenRecords={vi.fn()} />)
  await endRecordedCourse(handlers)

  // Waits while the last sentence is still being recognised and translated.
  const form = screen.getByRole('form', { name: '保存课程' })
  expect(
    within(form).getByText(/AI 课程摘要正在生成，请稍等（正在处理最后一句字幕）/),
  ).toBeVisible()
  expect(api.lectureSummary).not.toHaveBeenCalled()
  await act(async () => {
    handlers.onTranslation({ id: 2, zh: null })
    handlers.onClosed()
  })
  expect(api.lectureSummary).toHaveBeenCalledTimes(1)
  expect(api.lectureSummary).toHaveBeenCalledWith({
    lines: [
      { at_seconds: 62.5, en: 'Adam combines momentum.' },
      { at_seconds: 66, en: 'Assignment two is due next Friday.' },
    ],
    notes: [{ at_seconds: 60, text: '作业！', important: true }],
  })
  expect(within(form).getByText(/AI 课程摘要正在生成，请稍等（预计不到 1 分钟）/)).toBeVisible()
  await act(async () => finish(SUMMARY))

  const keep = within(form).getByLabelText('AI 摘要与重点')
  expect(keep).toBeChecked()
  expect(within(form).getByText('本节课介绍了 Adam 优化器。')).toBeVisible()
  expect(within(form).getByText('截止')).toBeVisible()
  expect(within(form).getByText('Assignment two is due next Friday.')).toBeInTheDocument()

  // A reload keeps the generated summary instead of running the model again.
  unmount()
  render(<LectureLive user={user} onOpenRecords={vi.fn()} />)
  const again = screen.getByRole('form', { name: '保存课程' })
  expect(within(again).getByText('本节课介绍了 Adam 优化器。')).toBeVisible()
  expect(api.lectureSummary).toHaveBeenCalledTimes(1)

  fireEvent.change(within(again).getByLabelText('课程名称（必填）'), { target: { value: 'ML' } })
  await act(async () => {
    fireEvent.click(within(again).getByRole('button', { name: '保存到课程记录' }))
  })
  expect(api.createLectureRecord.mock.calls[0][0].summary).toEqual(SUMMARY)
})

it('can save without the summary, and offers a retry when generation fails', async () => {
  const { handlers } = fakeStream()
  localStorage.setItem('hkmate.lecture.consent.user-1', '1')
  api.lectureSummary.mockRejectedValueOnce(new Error('请启动本地 Ollama 并确认模型已下载。'))
  render(<LectureLive user={user} onOpenRecords={vi.fn()} />)
  await endRecordedCourse(handlers)
  await act(async () => {
    handlers.onTranslation({ id: 2, zh: null })
    handlers.onClosed()
  })
  const form = screen.getByRole('form', { name: '保存课程' })
  expect(within(form).getByRole('alert')).toHaveTextContent(/摘要生成失败：请启动本地 Ollama/)
  expect(within(form).getByLabelText('AI 摘要与重点')).toBeDisabled()

  api.lectureSummary.mockResolvedValueOnce(SUMMARY)
  await act(async () => {
    fireEvent.click(within(form).getByRole('button', { name: '重试' }))
  })
  fireEvent.click(within(form).getByLabelText('AI 摘要与重点'))
  fireEvent.change(within(form).getByLabelText('课程名称（必填）'), { target: { value: 'ML' } })
  await act(async () => {
    fireEvent.click(within(form).getByRole('button', { name: '保存到课程记录' }))
  })
  expect(api.lectureSummary).toHaveBeenCalledTimes(2)
  expect(api.createLectureRecord.mock.calls[0][0].summary).toBeNull()
})
