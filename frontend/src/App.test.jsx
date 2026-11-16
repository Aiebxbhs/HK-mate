import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import App from './App'
import { api } from './api/client'
import { setLanguage } from './i18n'

vi.mock('./api/client', () => ({
  api: {
    me: vi.fn(),
    login: vi.fn(),
    register: vi.fn(),
    logout: vi.fn(),
    agentStatus: vi.fn(),
    connections: vi.fn(),
    calendarEvents: vi.fn(),
    notifications: vi.fn(),
    checkNotifications: vi.fn(),
    lectureRecords: vi.fn(),
    calendarCourses: vi.fn(),
    setLanguage: vi.fn(),
  },
}))
const account = {
  id: 'test-user',
  display_name: '测试同学',
  username: 'student_01',
  created_at: '2026-11-12T10:00:00Z',
}

beforeEach(() => {
  vi.resetAllMocks()
  api.notifications.mockResolvedValue({
    enabled: true,
    connection_count: 1,
    total_count: 0,
    items: [],
    errors: [],
    last_checked_at: null,
    next_cursor: null,
  })
  api.connections.mockResolvedValue({ items: [], google_configured: true })
  api.calendarEvents.mockResolvedValue({ items: [], total_events: 0 })
  api.agentStatus.mockResolvedValue({
    available: false,
    provider: 'openai',
    provider_label: 'OpenAI（ChatGPT）',
    model: '',
    problem: 'AGENT_NOT_CONFIGURED',
    message: 'AI 助手尚未配置。',
  })
  history.replaceState(null, '', '/login')
  api.me.mockRejectedValue(Object.assign(new Error('请登录'), { status: 401 }))
})
afterEach(() => {
  cleanup()
  setLanguage('zh')
})

describe('account pages', () => {
  it('shows the five main places and switches pages inside a section', async () => {
    api.me.mockResolvedValue(account)
    render(<App />)
    const user = userEvent.setup()
    await screen.findByRole('heading', { name: /(早上好|下午好|晚上好)，测试同学/ })
    const navigation = screen.getByRole('navigation', { name: '主导航' })
    expect(
      within(navigation)
        .getAllByRole('button')
        .map((button) => button.getAttribute('aria-label')),
    ).toEqual(['主页', '日程', '邮件', '课堂翻译', 'HKU 指南'])
    expect(within(navigation).getByRole('button', { name: '主页' })).toHaveAttribute(
      'aria-current',
      'page',
    )
    expect(screen.queryByRole('button', { name: '我的待办' })).not.toBeInTheDocument()

    await user.click(within(navigation).getByRole('button', { name: '邮件' }))
    expect(screen.getByRole('heading', { level: 1, name: '统一收件箱' })).toBeVisible()
    expect(within(navigation).getByRole('button', { name: '邮件' })).toHaveAttribute(
      'aria-current',
      'page',
    )
    const tabs = screen.getByRole('navigation', { name: '邮件页面' })
    expect(
      within(tabs)
        .getAllByRole('button')
        .map((button) => button.textContent),
    ).toEqual(['统一收件箱', '起草邮件', '邮箱管理'])
    await user.click(within(tabs).getByRole('button', { name: '邮箱管理' }))
    expect(await screen.findByRole('heading', { level: 1, name: '邮箱管理' })).toBeVisible()
    expect(await screen.findByRole('button', { name: '添加 Google 邮箱' })).toBeEnabled()
    expect(location.hash).toBe('#/mailboxes')
    await user.click(
      within(screen.getByRole('navigation', { name: '邮件页面' })).getByRole('button', {
        name: '起草邮件',
      }),
    )
    expect(screen.getByRole('region', { name: '起草新邮件' })).toBeVisible()
    expect(location.hash).toBe('#/compose')
  })

  it('shows the number of new mails on the mail tab', async () => {
    api.me.mockResolvedValue(account)
    api.notifications.mockResolvedValue({
      enabled: true,
      connection_count: 1,
      total_count: 3,
      items: [],
      errors: [],
      last_checked_at: null,
      next_cursor: null,
    })
    render(<App />)
    const navigation = await screen.findByRole('navigation', { name: '主导航' })
    expect(
      await within(navigation).findByRole('button', { name: '邮件，3 封新邮件' }),
    ).toBeVisible()
    // Ignoring a notice in the inbox announces the change; the tab count follows at once.
    api.notifications.mockResolvedValue({
      enabled: true,
      connection_count: 1,
      total_count: 1,
      items: [],
      errors: [],
      last_checked_at: null,
      next_cursor: null,
    })
    window.dispatchEvent(new Event('hkm:mail-notices-changed'))
    expect(
      await within(navigation).findByRole('button', { name: '邮件，1 封新邮件' }),
    ).toBeVisible()
  })

  it('goes back with the browser back action', async () => {
    api.me.mockResolvedValue(account)
    render(<App />)
    const user = userEvent.setup()
    await screen.findByRole('heading', { name: /(早上好|下午好|晚上好)，测试同学/ })
    await user.click(screen.getByRole('button', { name: '邮件' }))
    await user.click(screen.getByRole('button', { name: '邮箱管理' }))
    expect(await screen.findByRole('heading', { level: 1, name: '邮箱管理' })).toBeVisible()
    await user.click(screen.getByRole('button', { name: '账号菜单' }))
    await user.click(screen.getByRole('button', { name: '我的账号' }))
    expect(screen.getByRole('heading', { level: 1, name: '账号信息' })).toBeVisible()
    history.back()
    expect(await screen.findByRole('heading', { level: 1, name: '邮箱管理' })).toBeVisible()
    history.back()
    expect(await screen.findByRole('heading', { level: 1, name: '统一收件箱' })).toBeVisible()
    history.back()
    expect(
      await screen.findByRole('heading', { name: /(早上好|下午好|晚上好)，测试同学/ }),
    ).toBeVisible()
    expect(location.hash).toBe('')
  })

  it('follows a page typed into the address bar', async () => {
    api.me.mockResolvedValue(account)
    render(<App />)
    await screen.findByRole('heading', { name: /(早上好|下午好|晚上好)，测试同学/ })
    history.pushState(null, '', '/#/account')
    window.dispatchEvent(new PopStateEvent('popstate', { state: null }))
    expect(await screen.findByRole('heading', { level: 1, name: '账号信息' })).toBeVisible()
    expect(history.state).toMatchObject({ hkPage: 'account', hkIndex: 1 })
  })

  it('reopens the page named in the address after a reload', async () => {
    api.me.mockResolvedValue(account)
    history.replaceState(null, '', '/#/account')
    render(<App />)
    const user = userEvent.setup()
    expect(await screen.findByRole('heading', { level: 1, name: '账号信息' })).toBeVisible()
    expect(screen.getByRole('button', { name: '账号菜单' })).toHaveClass('active')
    await user.click(screen.getByRole('button', { name: '主页' }))
    expect(
      await screen.findByRole('heading', { name: /(早上好|下午好|晚上好)，测试同学/ }),
    ).toBeVisible()
    expect(location.hash).toBe('')
  })

  it('opens the schedule and the timetable from the schedule section', async () => {
    api.me.mockResolvedValue(account)
    api.calendarCourses.mockResolvedValue({ items: [] })
    render(<App />)
    const user = userEvent.setup()
    await screen.findByRole('heading', { name: /(早上好|下午好|晚上好)，测试同学/ })
    await user.click(screen.getByRole('button', { name: '日程' }))
    expect(screen.getByRole('heading', { level: 1, name: '我的日程' })).toBeVisible()
    expect(await screen.findByRole('region', { name: '日程列表' })).toBeVisible()
    const tabs = screen.getByRole('navigation', { name: '日程页面' })
    expect(
      within(tabs)
        .getAllByRole('button')
        .map((button) => button.textContent),
    ).toEqual(['日程', '课表'])
    await user.click(within(tabs).getByRole('button', { name: '课表' }))
    expect(screen.getByRole('heading', { level: 1, name: '我的课表' })).toBeVisible()
    expect(location.hash).toBe('#/timetable')
    expect(
      within(screen.getByRole('navigation', { name: '主导航' })).getByRole('button', {
        name: '日程',
      }),
    ).toHaveAttribute('aria-current', 'page')
  })

  it('opens My Schedule with the add form from the home page', async () => {
    api.me.mockResolvedValue(account)
    render(<App />)
    const user = userEvent.setup()
    const week = await screen.findByRole('region', { name: '接下来 5 天' })
    await user.click(await within(week).findByRole('button', { name: '添加日程' }))
    expect(screen.getByRole('heading', { level: 1, name: '我的日程' })).toBeVisible()
    expect(await screen.findByRole('form', { name: '添加日程' })).toBeVisible()
    expect(location.hash).toBe('#/calendar')
  })

  it('lists the lecture pages as tabs', async () => {
    api.me.mockResolvedValue(account)
    api.lectureRecords.mockResolvedValue({ items: [] })
    render(<App />)
    const user = userEvent.setup()
    await screen.findByRole('heading', { name: /(早上好|下午好|晚上好)，测试同学/ })
    await user.click(screen.getByRole('button', { name: '课堂翻译' }))
    expect(screen.getByRole('heading', { level: 1, name: '实时翻译' })).toBeVisible()
    const tabs = screen.getByRole('navigation', { name: '课堂翻译页面' })
    expect(
      within(tabs)
        .getAllByRole('button')
        .map((button) => button.textContent),
    ).toEqual(['实时翻译', '课程记录'])
    await user.click(within(tabs).getByRole('button', { name: '课程记录' }))
    expect(screen.getByRole('heading', { level: 1, name: '课程记录' })).toBeVisible()
    expect(await screen.findByText(/还没有保存的课程记录/)).toBeVisible()
    expect(location.hash).toBe('#/lecture-records')
    await user.click(screen.getByRole('button', { name: '去开始一节课' }))
    expect(screen.getByRole('heading', { level: 1, name: '实时翻译' })).toBeVisible()
    expect(screen.getByRole('button', { name: /开始课程/ })).toBeVisible()
  })

  it('logs in, displays the real account, and logs out', async () => {
    api.login.mockResolvedValue(account)
    api.logout.mockResolvedValue(null)
    render(<App />)
    const user = userEvent.setup()
    await user.type(await screen.findByLabelText('账号'), account.username)
    expect(screen.getByRole('heading', { level: 1, name: 'HK Mate' })).toBeVisible()
    expect(screen.queryByText('本地运行')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('邮箱地址')).not.toBeInTheDocument()
    await user.type(screen.getByLabelText('密码', { exact: true }), 'example-password')
    await user.click(screen.getByRole('button', { name: '登录我的空间' }))
    expect(
      await screen.findByRole('heading', { name: /(早上好|下午好|晚上好)，测试同学/ }),
    ).toBeVisible()
    const menuButton = screen.getByRole('button', { name: '账号菜单' })
    expect(menuButton).toHaveAttribute('aria-expanded', 'false')
    await user.click(menuButton)
    expect(menuButton).toHaveAttribute('aria-expanded', 'true')
    await user.keyboard('{Escape}')
    expect(menuButton).toHaveAttribute('aria-expanded', 'false')
    expect(menuButton).toHaveFocus()
    await user.click(menuButton)
    expect(screen.getByText(account.username)).toBeVisible()
    await user.click(screen.getByRole('button', { name: '我的账号' }))
    expect(screen.getByRole('region', { name: '我的账号' })).toHaveTextContent(account.username)
    await user.click(screen.getByRole('button', { name: '账号菜单' }))
    await user.click(screen.getByRole('button', { name: '退出登录' }))
    expect(await screen.findByRole('heading', { level: 2, name: '登录' })).toBeVisible()
    expect(api.logout).toHaveBeenCalledOnce()
  })

  it('rejects mismatching passwords and returns to login after successful registration', async () => {
    api.register.mockResolvedValue(account)
    render(<App />)
    const user = userEvent.setup()
    await user.click(await screen.findByRole('button', { name: '注册账号' }))
    await user.type(screen.getByLabelText('账号'), account.username)
    await user.type(screen.getByLabelText('密码', { exact: true }), 'example-password')
    await user.type(screen.getByLabelText('确认密码'), 'different-password')
    await user.click(screen.getByRole('button', { name: '创建账号' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('两次输入的密码不一致')
    expect(api.register).not.toHaveBeenCalled()
    await user.clear(screen.getByLabelText('确认密码'))
    await user.type(screen.getByLabelText('确认密码'), 'example-password')
    await user.click(screen.getByRole('button', { name: '创建账号' }))
    expect(await screen.findByRole('status')).toHaveTextContent('账号已创建')
    expect(api.register).toHaveBeenCalledWith({
      username: account.username,
      password: 'example-password',
      language: 'zh',
    })
    expect(screen.getByLabelText('账号')).toHaveValue(account.username)
    expect(screen.getByLabelText('密码', { exact: true })).toHaveValue('')
  })

  it('shows login errors and allows retry without losing the username', async () => {
    api.login.mockRejectedValue(new Error('账号或密码不正确。'))
    render(<App />)
    const user = userEvent.setup()
    await user.type(await screen.findByLabelText('账号'), account.username)
    await user.type(screen.getByLabelText('密码', { exact: true }), 'wrong-password')
    await user.click(screen.getByRole('button', { name: '登录我的空间' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('账号或密码不正确')
    expect(screen.getByLabelText('账号')).toHaveValue(account.username)
    expect(screen.getByRole('button', { name: '登录我的空间' })).toBeEnabled()
  })

  it('restores a saved session and handles initial network failure', async () => {
    api.me.mockRejectedValueOnce(new Error('暂时无法连接服务')).mockResolvedValue(account)
    render(<App />)
    expect(await screen.findByRole('alert')).toHaveTextContent('暂时无法连接服务')
    await userEvent.click(screen.getByRole('button', { name: '重新连接' }))
    await waitFor(() =>
      expect(
        screen.getByRole('heading', { name: /(早上好|下午好|晚上好)，测试同学/ }),
      ).toBeVisible(),
    )
  })
})

describe('language', () => {
  it('switches the sign-in page to English and registers in English', async () => {
    api.register.mockResolvedValue({ ...account, language: 'en' })
    render(<App />)
    const user = userEvent.setup()
    await user.click(await screen.findByRole('button', { name: 'Switch to English' }))
    expect(document.documentElement.lang).toBe('en')
    await user.click(screen.getByRole('button', { name: 'Create account' }))
    await user.type(screen.getByLabelText('Username'), account.username)
    await user.type(screen.getByLabelText('Password'), 'example-password')
    await user.type(screen.getByLabelText('Confirm password'), 'example-password')
    await user.click(screen.getByRole('button', { name: 'Create account', hidden: false }))
    await waitFor(() =>
      expect(api.register).toHaveBeenCalledWith({
        username: account.username,
        password: 'example-password',
        language: 'en',
      }),
    )
    expect(await screen.findByText(/Account created/)).toBeInTheDocument()
  })

  it('opens in the account language and saves a change on the account page', async () => {
    api.me.mockResolvedValue({ ...account, language: 'en' })
    api.setLanguage.mockResolvedValue({ ...account, language: 'zh' })
    render(<App />)
    const user = userEvent.setup()
    await screen.findByRole('heading', { name: /Good (morning|afternoon|evening), 测试同学/ })
    const nav = screen.getByRole('navigation', { name: 'Main navigation' })
    expect(within(nav).getByRole('button', { name: 'Schedule' })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Account menu' }))
    await user.click(screen.getByRole('button', { name: 'My account' }))
    await user.click(await screen.findByRole('button', { name: '中文' }))
    expect(api.setLanguage).toHaveBeenCalledWith('zh')
    expect(await screen.findByRole('heading', { name: '账号信息' })).toBeInTheDocument()
    expect(document.documentElement.lang).toBe('zh-CN')
  })
})
