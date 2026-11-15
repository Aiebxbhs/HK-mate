import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import ReplyDraftPanel, { gmailComposeUrl } from './ReplyDraftPanel'
import { api } from '../api/client'

vi.mock('../api/client', () => ({ api: { replyDraft: vi.fn() } }))

const draft = {
  body: 'Dear Dr. Wong,\n\nFriday works for me at 【需补充：具体时间】.\n\nBest,\n【需补充：署名】',
  missing_info: ['确认会面地点'],
  to_address: 'awong@example.edu',
  to_name: 'Dr. Alice Wong',
  subject: 'Re: Project meeting',
  mailbox: 'reader@example.com',
  model: 'qwen',
  elapsed_seconds: 8.2,
}

beforeEach(() => {
  localStorage.clear()
  api.replyDraft.mockResolvedValue(draft)
})
afterEach(() => {
  cleanup()
  vi.resetAllMocks()
})

it('generates a draft with the chosen intent and options, and flags what is missing', async () => {
  render(<ReplyDraftPanel connectionId="c1" messageId="m1" />)
  const user = userEvent.setup()
  await user.click(screen.getByLabelText('约时间'))
  await user.type(screen.getByLabelText('补充说明（可选）'), '周五下午可以')
  await user.selectOptions(screen.getByLabelText('语气'), 'friendly')
  await user.selectOptions(screen.getByLabelText('语言'), 'en')
  await user.type(screen.getByLabelText('署名'), 'Sam')
  await user.click(screen.getByRole('button', { name: '生成草稿' }))

  expect(api.replyDraft).toHaveBeenCalledWith('c1', 'm1', {
    intent: 'schedule',
    note: '周五下午可以',
    tone: 'friendly',
    language: 'en',
    signature: 'Sam',
  })
  const editor = await screen.findByLabelText('回复草稿')
  expect(editor).toHaveValue(draft.body)
  expect(screen.getByText('Dr. Alice Wong <awong@example.edu>')).toBeVisible()
  expect(screen.getByText('Re: Project meeting')).toBeVisible()
  expect(screen.getByText(/还有 2 处需要你补充/)).toBeVisible()
  expect(within(screen.getByRole('list', { name: '发送前请核实' })).getByText('确认会面地点'))
  expect(screen.getByText(/发件人为 reader@example.com/)).toBeVisible()
  expect(localStorage.getItem('hkmate.reply.signature')).toBe('Sam')

  // Editing updates the warnings, the Gmail link and the regenerate label.
  fireEvent.change(editor, {
    target: { value: 'Dear Dr. Wong,\n\nFriday 3pm works.\n\nBest,\nSam' },
  })
  expect(screen.queryByText(/需要你补充/)).not.toBeInTheDocument()
  const link = screen.getByRole('link', { name: '在 Gmail 中打开' })
  const url = new URL(link.getAttribute('href'))
  expect(url.origin + url.pathname).toBe('https://mail.google.com/mail/')
  expect(url.searchParams.get('authuser')).toBe('reader@example.com')
  expect(url.searchParams.get('to')).toBe('awong@example.edu')
  expect(url.searchParams.get('su')).toBe('Re: Project meeting')
  expect(url.searchParams.get('body')).toBe('Dear Dr. Wong,\n\nFriday 3pm works.\n\nBest,\nSam')
  expect(link).toHaveAttribute('rel', 'noopener noreferrer')
  expect(screen.getByRole('button', { name: '重新生成（会覆盖修改）' })).toBeVisible()
})

it('requires notes for a custom reply and shows server errors', async () => {
  render(<ReplyDraftPanel connectionId="c1" messageId="m1" />)
  const user = userEvent.setup()
  await user.click(screen.getByLabelText('自己写要点'))
  await user.click(screen.getByRole('button', { name: '生成草稿' }))
  expect(screen.getByRole('alert')).toHaveTextContent('请先写下想回复的内容要点。')
  expect(api.replyDraft).not.toHaveBeenCalled()

  api.replyDraft.mockRejectedValue(new Error('请启动本地 Ollama 并确认模型已下载。'))
  await user.type(screen.getByLabelText('回复要点'), '说明我会迟交一天')
  await user.click(screen.getByRole('button', { name: '生成草稿' }))
  expect(await screen.findByRole('alert')).toHaveTextContent('请启动本地 Ollama')
  expect(screen.queryByLabelText('回复草稿')).not.toBeInTheDocument()
})

it('copies the edited draft and remembers the signature', async () => {
  localStorage.setItem('hkmate.reply.signature', 'Saved Name')
  render(<ReplyDraftPanel connectionId="c1" messageId="m1" />)
  const user = userEvent.setup()
  // user-event installs its own clipboard stub during setup, so mock after it.
  const writeText = vi.fn().mockResolvedValue()
  Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
  expect(screen.getByLabelText('署名')).toHaveValue('Saved Name')
  await user.click(screen.getByRole('button', { name: '生成草稿' }))
  await screen.findByLabelText('回复草稿')
  await user.click(screen.getByRole('button', { name: '复制草稿' }))
  expect(writeText).toHaveBeenCalledWith(draft.body)
  expect(await screen.findByText('已复制到剪贴板。')).toBeVisible()
})

it('shows a bare address when the sender name is the address itself', async () => {
  api.replyDraft.mockResolvedValue({ ...draft, to_name: 'awong@example.edu' })
  render(<ReplyDraftPanel connectionId="c1" messageId="m1" />)
  fireEvent.click(screen.getByRole('button', { name: '生成草稿' }))
  expect(await screen.findByText('awong@example.edu')).toBeVisible()
  expect(screen.queryByText(/<awong@example.edu>/)).not.toBeInTheDocument()
})

it('builds a Gmail compose link without dropping special characters', () => {
  const url = new URL(
    gmailComposeUrl({ mailbox: 'a@b.com', to: 'x@y.com', subject: 'Re: A & B', body: '50% #1' }),
  )
  expect(url.searchParams.get('su')).toBe('Re: A & B')
  expect(url.searchParams.get('body')).toBe('50% #1')
})
