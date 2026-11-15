import { afterEach, expect, it, vi } from 'vitest'
import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import HkuGuide from './HkuGuide'
import { api } from '../api/client'

vi.mock('../api/client', () => ({ api: { hkuGuide: vi.fn(), hkuPlaces: vi.fn() } }))

const guide = {
  audience: '研究生',
  categories: [
    {
      id: 'library',
      title: '图书馆',
      documents: [
        {
          title: '图书馆（研究生）',
          verified: '2026-11-14',
          sources: [
            { label: '港大图书馆：开放时间', url: 'https://lib.hku.hk/general/hours/index.html' },
          ],
          sections: [
            { heading: '开放时间', text: '各馆开放时间按日期变化。' },
            { heading: '研究生借书规则', text: '可借 180 本。' },
          ],
        },
      ],
    },
    { id: 'transport', title: '交通与校园位置', documents: [] },
  ],
}

const printer = (number, extra = {}) => ({
  number,
  wing: 'New Wing',
  print_mode: 'bw',
  copy_mode: 'bw',
  wifi: true,
  scan: false,
  ...extra,
})

const places = {
  verified: '2026-11-14',
  sources: [
    { label: '港大图书馆：复印、打印、扫描', url: 'https://lib.hku.hk/techsupport/photocopy.html' },
  ],
  library: {
    name: 'Main Library',
    intro: 'Main Library 位于 Library Building。',
    floors: [
      {
        id: '2',
        label: '2/F',
        wings: ['Old Wing', 'New Wing'],
        spots: [
          { kind: 'service', wing: 'New Wing', name: 'Lending Services Counter', text: '借还书。' },
        ],
        printers: [printer('30', { print_mode: 'colour', scan: true })],
      },
      {
        id: 'G',
        label: 'G/F',
        wings: ['Old Wing', 'New Wing'],
        spots: [{ kind: 'study', wing: null, name: 'Think Tank', text: '安静自习。' }],
        printers: [printer('1')],
      },
    ],
  },
}

afterEach(() => {
  cleanup()
  vi.resetAllMocks()
})

it('shows a category with its official sources', async () => {
  api.hkuGuide.mockResolvedValue(guide)
  api.hkuPlaces.mockResolvedValue(places)
  render(<HkuGuide category="library" />)
  const page = await screen.findByRole('region', { name: '图书馆' })
  expect(within(page).getByText('以下内容针对研究生，整理自港大官方网站。')).toBeVisible()
  expect(within(page).getByRole('heading', { name: '研究生借书规则' })).toBeVisible()
  expect(within(page).getByText('可借 180 本。')).toBeVisible()
  const [floorSources, textSources] = within(page).getAllByRole('complementary', {
    name: '资料来源',
  })
  // The floor view lists only the library pages it was built from.
  expect(within(floorSources).getByRole('link')).toHaveAttribute(
    'href',
    'https://lib.hku.hk/techsupport/photocopy.html',
  )
  expect(within(textSources).getByRole('link')).toHaveAttribute(
    'href',
    'https://lib.hku.hk/general/hours/index.html',
  )
})

it('says a category is still being prepared and reports errors', async () => {
  api.hkuGuide.mockResolvedValue(guide)
  render(<HkuGuide category="services" />)
  expect(await screen.findByText(/正在整理中，内容只会采用港大官方资料/)).toBeVisible()
  expect(api.hkuPlaces).not.toHaveBeenCalled()
  cleanup()
  api.hkuGuide.mockRejectedValue(new Error('暂时无法连接服务。'))
  render(<HkuGuide category="library" />)
  expect(await screen.findByRole('alert')).toHaveTextContent('暂时无法连接服务。')
})

it('browses library floors and highlights floors with a facility', async () => {
  const user = userEvent.setup()
  api.hkuGuide.mockResolvedValue(guide)
  api.hkuPlaces.mockResolvedValue(places)
  render(<HkuGuide category="library" />)
  const floors = await screen.findByRole('region', { name: 'Main Library 逐层设施' })
  // Starts on the ground floor.
  expect(within(floors).getByRole('heading', { name: /G\/F/ })).toBeVisible()
  expect(within(floors).getByText('Think Tank')).toBeVisible()

  await user.click(within(floors).getByRole('button', { name: '彩色打印' }))
  // Jumps to the first floor that has one and marks it.
  expect(within(floors).getByRole('heading', { name: /2\/F/ })).toBeVisible()
  expect(within(floors).getByText('彩色打印、黑白复印、Wi-Fi 打印、扫描到邮箱')).toBeVisible()
  const tabs = within(floors).getByRole('group', { name: '选择楼层' })
  expect(within(tabs).getByRole('button', { name: '2/F' })).toHaveAttribute('aria-pressed', 'true')

  await user.click(within(tabs).getByRole('button', { name: 'G/F' }))
  expect(within(floors).getByText('这一层没有“彩色打印”。')).toBeVisible()
})

it('shows the official campus map with the transport guide', async () => {
  api.hkuGuide.mockResolvedValue({
    ...guide,
    categories: [
      guide.categories[0],
      {
        id: 'transport',
        title: '交通与校园位置',
        documents: [
          {
            title: '交通与校园位置（研究生）',
            verified: '2026-11-14',
            sources: [{ label: '港大：HKU Campus Map', url: 'https://www.maps.hku.hk/' }],
            sections: [
              {
                heading: '坐港铁到 Main Campus',
                text: '- 出口：Exit A1 或 A2\n- 怎么走：按 FB 层',
              },
              {
                heading: '坐巴士和绿色专线小巴',
                text: '以下路线由港大社会科学学院列出。\n- Central 小巴：22、22S、55\n请以营办商资料为准。',
              },
            ],
          },
        ],
      },
    ],
  })
  render(<HkuGuide category="transport" />)
  const page = await screen.findByRole('region', { name: '交通与校园位置' })
  const map = within(page).getByRole('region', { name: 'HKU Campus Map' })
  expect(within(map).getByTitle('HKU Campus Map（港大官方校园地图）')).toHaveAttribute(
    'src',
    'https://www.maps.hku.hk/',
  )
  expect(within(map).getByRole('img', { name: /港大主校园平面图/ })).toHaveAttribute(
    'src',
    '/guide/hku-main-campus-map-2025.jpg',
  )
  expect(within(page).getByRole('heading', { name: '坐港铁到 Main Campus' })).toBeVisible()
  // Facts are shown as labelled rows, and route numbers as separate tags.
  expect(within(page).getByText('出口')).toHaveClass('guide-fact-label')
  expect(within(page).getByText('Exit A1 或 A2')).toBeVisible()
  expect(within(page).getByText('22S')).toHaveClass('guide-route')
  expect(within(page).getByText('请以营办商资料为准。')).toBeVisible()
  // The transport page needs no library floor data.
  expect(api.hkuPlaces).not.toHaveBeenCalled()
})

it('puts every card on its own row when a guide asks for rows', async () => {
  const short = (heading) => ({ heading, text: '- 地点：Room 123\n- 联系：3910 3200' })
  api.hkuGuide.mockResolvedValue({
    ...guide,
    categories: [
      guide.categories[0],
      guide.categories[1],
      {
        id: 'services',
        title: '学生服务与联系方式',
        documents: [
          {
            title: '学生服务与联系方式（研究生）',
            verified: '2026-11-15',
            layout: 'rows',
            sources: [],
            sections: [short('残障与特殊学习需要'), short('住宿、非本地生与就业')],
          },
        ],
      },
    ],
  })
  render(<HkuGuide category="services" />)
  const page = await screen.findByRole('region', { name: '学生服务与联系方式' })
  for (const name of ['残障与特殊学习需要', '住宿、非本地生与就业'])
    expect(within(page).getByRole('heading', { name }).closest('section')).toHaveClass('wide')
})
