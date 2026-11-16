import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import Compose from './Compose'
import { api } from '../api/client'

vi.mock('../api/client', () => ({ api: { connections: vi.fn(), composeDraft: vi.fn() } }))

const draft = {
  subject: 'Extension request for 【需补充：课程编号】',
  body: 'Dear Prof. Chan,\n\nCould I have a one-day extension?\n\nBest regards,\nSam',
  missing_info: ['医生证明的提交方式'],
  model: 'qwen',
  elapsed_seconds: 3,
}

beforeEach(() => {
  localStorage.clear()
  api.connections.mockResolvedValue({
    google_configured: true,
    items: [
      { id: 'c1', email_address: 'me@gmail.com', status: 'connected' },
      { id: 'c2', email_address: 'old@gmail.com', status: 'reauthorization_required' },
    ],
  })
  api.composeDraft.mockResolvedValue(draft)
})
afterEach(() => {
  cleanup()
  vi.resetAllMocks()
})

it('drafts a new email from points without sending the address to the model', async () => {
  render(<Compose />)
  const user = userEvent.setup()
  await user.click(screen.getByRole('button', { name: '生成草稿' }))
  expect(screen.getByRole('alert')).toHaveTextContent('请先写下这封邮件要说的内容。')
  expect(api.composeDraft).not.toHaveBeenCalled()

  await user.click(screen.getByRole('button', { name: /约小组成员这周四下午/ }))
  expect(screen.getByLabelText('想写的内容和要点')).toHaveValue(
    '约小组成员这周四下午讨论项目分工，地点在图书馆讨论室',
  )
  fireEvent.change(screen.getByLabelText('想写的内容和要点'), {
    target: { value: '问 Prof. Chan 能不能延期一天交作业' },
  })
  await user.type(screen.getByLabelText('收件人称呼（可选）'), 'Prof. Chan')
  await user.type(screen.getByLabelText('收件人邮箱（可选）'), 'chan@example.edu')
  await user.selectOptions(screen.getByLabelText('语言'), 'en')
  await user.type(screen.getByLabelText('署名'), 'Sam')
  await user.click(screen.getByRole('button', { name: '生成草稿' }))

  expect(api.composeDraft).toHaveBeenCalledWith({
    purpose: '问 Prof. Chan 能不能延期一天交作业',
    recipient: 'Prof. Chan',
    tone: 'formal',
    language: 'en',
    signature: 'Sam',
  })
  expect(JSON.stringify(api.composeDraft.mock.calls)).not.toContain('chan@example.edu')
  expect(await screen.findByLabelText('主题')).toHaveValue(draft.subject)
  expect(screen.getByLabelText('正文')).toHaveValue(draft.body)
  expect(screen.getByText(/还有 1 处需要你补充：【需补充：课程编号】/)).toBeVisible()
  expect(screen.getByText('医生证明的提交方式')).toBeVisible()

  // Only connected mailboxes can be chosen as the sender.
  expect(screen.getAllByRole('option', { name: /@gmail.com/ }).map((o) => o.value)).toEqual([
    'me@gmail.com',
  ])
  fireEvent.change(screen.getByLabelText('主题'), { target: { value: 'DASC7606 extension' } })
  const url = new URL(screen.getByRole('link', { name: '在 Gmail 中打开' }).getAttribute('href'))
  expect(url.searchParams.get('authuser')).toBe('me@gmail.com')
  expect(url.searchParams.get('to')).toBe('chan@example.edu')
  expect(url.searchParams.get('su')).toBe('DASC7606 extension')
  expect(url.searchParams.get('body')).toBe(draft.body)
  expect(screen.getByRole('button', { name: '重新生成（会覆盖修改）' })).toBeVisible()
})

it('hides the Gmail link for a malformed address or when no mailbox is connected', async () => {
  render(<Compose />)
  const user = userEvent.setup()
  fireEvent.change(screen.getByLabelText('想写的内容和要点'), { target: { value: '约见导师' } })
  await user.type(screen.getByLabelText('收件人邮箱（可选）'), 'not-an-address')
  await user.click(screen.getByRole('button', { name: '生成草稿' }))
  await screen.findByLabelText('正文')
  expect(screen.getByText('收件人邮箱格式不正确。')).toBeVisible()
  expect(screen.queryByRole('link', { name: '在 Gmail 中打开' })).not.toBeInTheDocument()

  cleanup()
  api.connections.mockResolvedValue({ google_configured: true, items: [] })
  render(<Compose />)
  fireEvent.change(screen.getByLabelText('想写的内容和要点'), { target: { value: '约见导师' } })
  fireEvent.click(screen.getByRole('button', { name: '生成草稿' }))
  await screen.findByLabelText('正文')
  expect(screen.getByText('在“邮箱管理”连接邮箱后，可直接打开写信页面。')).toBeVisible()
  expect(screen.queryByRole('link', { name: '在 Gmail 中打开' })).not.toBeInTheDocument()
})

it('shows server errors and keeps the user input', async () => {
  api.composeDraft.mockRejectedValue(new Error('本地模型正在处理其他邮件，请稍后重试。'))
  render(<Compose />)
  fireEvent.change(screen.getByLabelText('想写的内容和要点'), { target: { value: '约见导师' } })
  fireEvent.click(screen.getByRole('button', { name: '生成草稿' }))
  expect(await screen.findByRole('alert')).toHaveTextContent('本地模型正在处理其他邮件')
  expect(screen.getByLabelText('想写的内容和要点')).toHaveValue('约见导师')
  expect(screen.queryByLabelText('正文')).not.toBeInTheDocument()
})
