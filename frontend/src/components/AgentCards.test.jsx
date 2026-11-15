import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import AgentCard from './AgentCards'
import { api } from '../api/client'

vi.mock('../api/client', () => ({
  api: { connections: vi.fn(), createCalendarEvent: vi.fn() },
}))

beforeEach(() => {
  api.connections.mockResolvedValue({
    items: [{ id: 'c1', status: 'connected', email_address: 'me@gmail.example' }],
  })
})
afterEach(() => {
  cleanup()
  vi.resetAllMocks()
})

const draft = {
  type: 'email_draft',
  recipient_name: 'Prof. Chan',
  subject: 'Leave request for COMP7607',
  body: 'Dear Prof. Chan,\n\nI cannot attend because 【需补充：原因】.\n\nBest regards,\nSam',
  missing_info: ['请假原因'],
}

it('email draft: user types the address, edits, copies and opens Gmail', async () => {
  render(<AgentCard card={draft} />)
  const card = screen.getByRole('group', { name: '邮件草稿' })
  expect(within(card).getByText(/给 Prof. Chan/)).toBeVisible()
  expect(within(card).getByText(/还有 1 处需要你补充/)).toBeVisible()
  expect(within(card).getByText('请假原因')).toBeVisible()
  expect(await within(card).findByText('填写收件人邮箱后可在 Gmail 中打开')).toBeVisible()
  expect(within(card).queryByRole('link')).not.toBeInTheDocument()

  const to = within(card).getByLabelText('收件人邮箱（自己填写）')
  fireEvent.change(to, { target: { value: 'not-an-address' } })
  expect(within(card).getByText('邮箱格式不正确。')).toBeVisible()
  fireEvent.change(to, { target: { value: ' chan@hku.example ' } })
  fireEvent.change(within(card).getByLabelText('正文'), {
    target: { value: 'Dear Prof. Chan,\n\nI am unwell.\n\nSam' },
  })
  expect(within(card).queryByText(/需要你补充/)).not.toBeInTheDocument()
  const link = within(card).getByRole('link', { name: '在 Gmail 中打开' })
  const url = new URL(link.href)
  expect(url.origin).toBe('https://mail.google.com')
  expect(url.searchParams.get('to')).toBe('chan@hku.example')
  expect(url.searchParams.get('authuser')).toBe('me@gmail.example')
  expect(url.searchParams.get('body')).toContain('I am unwell.')
  expect(link).toHaveAttribute('rel', 'noopener noreferrer')

  const writeText = vi.fn().mockResolvedValue()
  Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
  await act(async () => fireEvent.click(within(card).getByRole('button', { name: '复制主题' })))
  expect(writeText).toHaveBeenCalledWith('Leave request for COMP7607')
  expect(within(card).getByText('已复制主题。')).toBeVisible()
})

it('email draft without a connected Gmail can still be copied', async () => {
  api.connections.mockResolvedValue({ items: [] })
  render(<AgentCard card={draft} />)
  expect(await screen.findByText('连接 Gmail 后可直接在 Gmail 中打开')).toBeVisible()
})

const proposal = {
  type: 'event_proposal',
  kind: 'deadline',
  title: 'NLP 作业 2',
  date: '2026-11-20',
  start_time: '23:59',
  end_time: null,
  location: '',
}

it('event proposal is saved only after the user confirms', async () => {
  api.createCalendarEvent.mockResolvedValue({ id: 'e1' })
  render(<AgentCard card={proposal} />)
  const card = screen.getByRole('group', { name: '新日程确认' })
  expect(within(card).getByText('新截止事项')).toBeVisible()
  expect(within(card).getByText('2026-11-20 23:59 截止')).toBeVisible()
  expect(api.createCalendarEvent).not.toHaveBeenCalled()
  await act(async () => fireEvent.click(within(card).getByRole('button', { name: '确认添加' })))
  expect(api.createCalendarEvent).toHaveBeenCalledWith({
    kind: 'deadline',
    title: 'NLP 作业 2',
    date: '2026-11-20',
    start_time: '23:59',
    end_time: null,
    location: '',
  })
  expect(within(card).getByText('✓ 已添加到我的日程')).toBeVisible()
  expect(within(card).queryByRole('button')).not.toBeInTheDocument()
})

it('event proposal can be cancelled, and save errors are shown', async () => {
  api.createCalendarEvent.mockRejectedValueOnce(new Error('日期无效。'))
  const event = {
    ...proposal,
    kind: 'event',
    end_time: '16:00',
    start_time: '15:00',
    location: 'Library',
  }
  render(<AgentCard card={event} />)
  const card = screen.getByRole('group', { name: '新日程确认' })
  expect(within(card).getByText('2026-11-20 15:00–16:00 · Library')).toBeVisible()
  await act(async () => fireEvent.click(within(card).getByRole('button', { name: '确认添加' })))
  expect(within(card).getByRole('alert')).toHaveTextContent('日期无效。')
  fireEvent.click(within(card).getByRole('button', { name: '取消' }))
  expect(within(card).getByText('已取消，没有添加。')).toBeVisible()
})

it('course records card links to the records page', () => {
  const onNavigate = vi.fn()
  render(
    <AgentCard
      card={{
        type: 'lectures',
        items: [
          { id: 'r1', course_name: 'Deep Learning', date: '2026-11-12', has_summary: true },
          { id: 'r2', course_name: 'NLP', date: '2026-11-10', has_summary: false },
        ],
      }}
      onNavigate={onNavigate}
    />,
  )
  expect(screen.getByText('无 AI 摘要', { exact: false })).toBeVisible()
  fireEvent.click(screen.getByRole('button', { name: '打开课程记录' }))
  expect(onNavigate).toHaveBeenCalledWith('lecture-records')
})

it('sources block lists each official source on its own row', () => {
  render(
    <AgentCard
      card={{
        type: 'knowledge',
        guides: ['新手行山路线与安全'],
        verified: '2026-11-14',
        sources: [
          {
            label: '香港旅游发展局：新手必去 10 条简易行山路线',
            url: 'https://www.discoverhongkong.com/eng/outdoors/top-10-easy-hikes.html',
          },
          { label: '无机构的标题', url: 'https://www.hiking.gov.hk/' },
          { label: 'bad', url: 'javascript:alert(1)' },
        ],
      }}
    />,
  )
  const sources = screen.getByRole('complementary', { name: '资料来源' })
  expect(within(sources).getByText('核对于 2026-11-14')).toBeVisible()
  const links = within(sources).getAllByRole('link')
  expect(links).toHaveLength(2)
  expect(links[0]).toHaveAttribute(
    'href',
    'https://www.discoverhongkong.com/eng/outdoors/top-10-easy-hikes.html',
  )
  expect(links[0]).toHaveAttribute('rel', 'noopener noreferrer')
  expect(within(links[0]).getByText('香港旅游发展局')).toHaveClass('agent-source-org')
  expect(within(links[0]).getByText('新手必去 10 条简易行山路线')).toHaveClass('agent-source-title')
  expect(within(links[1]).getByText('无机构的标题')).toBeVisible()
  expect(within(sources).getByText('信息可能更新，请以官方网站为准。')).toBeVisible()
})

it('places card shows Google Maps data with attribution and safe links', () => {
  render(
    <AgentCard
      card={{
        type: 'places',
        where: 'near HKU main campus',
        query: '川菜',
        places: [
          {
            name: '合成川菜馆',
            kind: '四川菜馆',
            rating: 4.4,
            rating_count: 812,
            price: '$$',
            open_now: true,
            address: '西营盘第二街 1 号',
            maps_url: 'https://maps.google.com/?cid=1',
            walk_minutes_from_hku: 9,
          },
          {
            name: '合成甜品铺',
            kind: '',
            rating: null,
            rating_count: null,
            price: '',
            open_now: false,
            address: '',
            maps_url: 'javascript:alert(1)',
          },
        ],
      }}
    />,
  )
  const card = screen.getByRole('group', { name: '地点：川菜' })
  expect(within(card).getByText('★ 4.4（812）')).toBeVisible()
  expect(within(card).getByText('营业中')).toBeVisible()
  expect(within(card).getByText('休息中')).toBeVisible()
  expect(within(card).getByText('距港大步行约 9 分钟')).toBeVisible()
  const links = within(card).getAllByRole('link', { name: '在 Google 地图中打开 ↗' })
  expect(links).toHaveLength(1)
  expect(links[0]).toHaveAttribute('href', 'https://maps.google.com/?cid=1')
  expect(within(card).getByText(/数据来自 Google 地图/)).toBeVisible()
})
