import { useState } from 'react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import LectureLive from '../pages/LectureLive'
import { LectureIndicator, LectureSessionProvider } from './LectureSession'
import { startLectureStream } from './lecture-stream'

vi.mock('./lecture-stream', async (original) => ({
  ...(await original()),
  startLectureStream: vi.fn(),
}))

vi.mock('../api/client', () => ({
  api: { lectureRecords: vi.fn(), createLectureRecord: vi.fn(), lectureSummary: vi.fn() },
}))

const user = { id: 'user-1' }
const START = new Date('2026-11-12T11:00:00Z')

beforeEach(() => {
  localStorage.clear()
  localStorage.setItem('hkmate.lecture.consent.user-1', '1')
  vi.useFakeTimers({ toFake: ['Date', 'setInterval', 'clearInterval'] })
  vi.setSystemTime(START)
})
afterEach(() => {
  cleanup()
  vi.useRealTimers()
  vi.resetAllMocks()
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

// The same arrangement as Home: the session above, one page at a time below.
function Shell() {
  const [page, setPage] = useState('lecture')
  return (
    <LectureSessionProvider user={user}>
      {page !== 'lecture' && <LectureIndicator onOpen={() => setPage('lecture')} />}
      {page === 'lecture' ? <LectureLive user={user} onOpenRecords={vi.fn()} /> : <p>收件箱</p>}
      <button type="button" onClick={() => setPage('inbox')}>
        去收件箱
      </button>
    </LectureSessionProvider>
  )
}

it('keeps recording and collecting captions while another page is open', async () => {
  const { handlers, handle } = fakeStream()
  const { unmount } = render(<Shell />)
  expect(screen.queryByText(/录音中/)).not.toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: /开始课程/ }))
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: '开始录音' }))
  })
  await act(async () => {
    handlers.onStatus('listening')
    handlers.onCaption({ id: 1, offset: 1, duration: 2, en: 'Gradient descent.' })
    handlers.onTranslation({ id: 1, zh: '梯度下降。' })
  })

  fireEvent.click(screen.getByRole('button', { name: '去收件箱' }))
  expect(screen.getByText('收件箱')).toBeVisible()
  // The microphone was neither stopped nor aborted by leaving the page.
  expect(handle.abort).not.toHaveBeenCalled()
  expect(handle.stop).not.toHaveBeenCalled()
  expect(screen.getByRole('button', { name: '录音中 00:00' })).toBeVisible()

  // Captions that arrive meanwhile are kept, and the pill counts recorded time.
  await act(async () => {
    handlers.onCaption({ id: 2, offset: 6, duration: 2, en: 'Next slide.' })
    handlers.onTranslation({ id: 2, zh: '下一张幻灯片。' })
    vi.setSystemTime(new Date(START.getTime() + 64_000))
    vi.advanceTimersByTime(1000)
  })
  const pill = screen.getByRole('button', { name: '录音中 01:05' })
  expect(startLectureStream).toHaveBeenCalledTimes(1)

  fireEvent.click(pill)
  expect(screen.getByText('梯度下降。')).toBeVisible()
  expect(screen.getByText('下一张幻灯片。')).toBeVisible()
  expect(screen.getByRole('button', { name: '暂停录音' })).toBeEnabled()
  expect(screen.queryByText(/录音中 0/)).not.toBeInTheDocument()

  // Signing out removes the session, which does turn the microphone off.
  unmount()
  expect(handle.abort).toHaveBeenCalledTimes(1)
})

it('shows on other pages that a lecture is running, paused or interrupted', async () => {
  const { handlers } = fakeStream()
  render(<Shell />)
  fireEvent.click(screen.getByRole('button', { name: /开始课程/ }))
  fireEvent.click(screen.getByRole('button', { name: '去收件箱' }))
  expect(screen.getByRole('button', { name: '上课中，未录音' })).toBeVisible()

  fireEvent.click(screen.getByRole('button', { name: '上课中，未录音' }))
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: '开始录音' }))
  })
  await act(async () => {
    handlers.onStatus('listening')
  })
  fireEvent.click(screen.getByRole('button', { name: '去收件箱' }))
  // The connection drops while the inbox is open.
  await act(async () => {
    handlers.onError('无法连接实时字幕服务，请确认本地后端正在运行。')
    handlers.onClosed()
  })
  fireEvent.click(screen.getByRole('button', { name: '录音已中断' }))
  expect(screen.getByRole('alert')).toHaveTextContent('无法连接实时字幕服务')
  expect(screen.getByRole('button', { name: '继续录音' })).toBeEnabled()
})

it('records without noise reduction unless the user turns it on', async () => {
  fakeStream()
  render(<Shell />)
  fireEvent.click(screen.getByRole('button', { name: /开始课程/ }))
  const noiseReduction = screen.getByRole('checkbox', { name: '通话降噪' })
  expect(noiseReduction).not.toBeChecked()
  fireEvent.click(noiseReduction)
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: '开始录音' }))
  })
  expect(startLectureStream.mock.calls[0][2]).toEqual({ deviceId: '', voiceProcessing: true })
  // The setting is fixed while the microphone is on.
  expect(screen.getByRole('checkbox', { name: '通话降噪' })).toBeDisabled()
})
