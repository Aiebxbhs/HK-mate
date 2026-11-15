import { useEffect, useRef, useState } from 'react'
import { api } from '../api/client'
import Brand from '../components/Brand'
import Icon from '../components/Icon'
import { MAIL_NOTICES_CHANGED } from '../components/NewMailNotice'
import PasswordChange from '../components/PasswordChange'
import TodayHongKong from '../components/TodayHongKong'
import Calendar from './Calendar'
import Compose from './Compose'
import LectureLive from './LectureLive'
import HkuGuide from './HkuGuide'
import Timetable from './Timetable'
import LectureRecords from './LectureRecords'
import Mailboxes from './Mailboxes'
import Inbox from './Inbox'

// "我的邮箱" submenu. Summaries and reply drafts live in the inbox's AI assistant column.
const mailboxPages = [
  {
    id: 'inbox',
    icon: 'mail',
    title: '统一收件箱',
    description: '已连接邮箱的邮件集中在这里，可用本地 AI 摘要和起草回复。',
  },
  {
    id: 'compose',
    icon: 'pen',
    title: '起草邮件',
    description: '写下几个要点，本地 AI 起草新邮件；系统不会替你发送。',
  },
  {
    id: 'mailboxes',
    icon: 'mail-settings',
    title: '邮箱管理',
    description: '连接或解绑 Gmail，查看每个邮箱的连接状态。',
  },
]
// "课程翻译" submenu (docs/LECTURE_TRANSLATION_PLAN.md). Course timing and notes work now;
// speech recognition and live captions are added in later phases.
const lecturePages = [
  {
    id: 'lecture-live',
    icon: 'mic',
    title: '实时翻译',
    description: '英文讲课实时转成中英字幕，可记笔记，下课后生成摘要。',
  },
  {
    id: 'lecture-records',
    icon: 'book',
    title: '课程记录',
    description: '已保存的字幕、课堂笔记和课后摘要，按课程查找。',
  },
]
// "HKU 指南" submenu: postgraduate guide from official HKU sources (app/guide_api.py).
const guidePages = [
  {
    id: 'guide-library',
    category: 'library',
    icon: 'book',
    title: '图书馆',
    description: '开放、借阅、打印与 Main Library 逐层设施，来自港大官方来源。',
  },
  {
    id: 'guide-transport',
    category: 'transport',
    icon: 'pin',
    title: '交通与校园位置',
    description: '港铁出口、巴士小巴与穿梭巴士路线，以及官方校园地图。',
  },
  {
    id: 'guide-services',
    category: 'services',
    icon: 'user',
    title: '学生服务与联系方式',
    description: '成绩单、学费、健康与心理辅导、住宿就业等办事入口和联系方式。',
  },
]
// "日程" section: the schedule list and the term timetable.
const schedulePages = [
  {
    id: 'calendar',
    icon: 'calendar',
    title: '我的日程',
    tab: '日程',
    description: '接下来 100 天的课程和日程，可添加、编辑和完成截止事项。',
  },
  {
    id: 'timetable',
    icon: 'grid',
    title: '我的课表',
    tab: '课表',
    description: '这学期的 HKU 课程，按周查看。',
  },
]
// Top-level navigation: the same five places on desktop (top bar) and phone (tab bar).
const sections = [
  { id: 'overview', label: '今天', icon: 'grid', pages: [{ id: 'overview' }] },
  { id: 'schedule', label: '日程', icon: 'calendar', pages: schedulePages },
  { id: 'mail', label: '邮件', icon: 'mail', pages: mailboxPages },
  { id: 'lecture', label: '课堂翻译', short: '翻译', icon: 'mic', pages: lecturePages },
  { id: 'guide', label: 'HKU 指南', short: '指南', icon: 'pin', pages: guidePages },
]

function AccountDetails({ user }) {
  return (
    <section className="account-section" aria-labelledby="account-title">
      <div className="section-title">
        <h2 id="account-title">我的账号</h2>
      </div>
      <div className="account-card">
        <div className="avatar">{Array.from(user.display_name)[0]}</div>
        <div>
          <strong>{user.display_name}</strong>
          <p>{user.username}</p>
        </div>
        <div className="account-date">
          <span>加入 HK Mate</span>
          <strong>{formatJoined(user.created_at)}</strong>
        </div>
      </div>
      <PasswordChange username={user.username} />
    </section>
  )
}

const pageIds = new Set([
  'account',
  ...sections.flatMap((section) => section.pages.map((item) => item.id)),
])

function pageFromLocation() {
  if (new URLSearchParams(location.search).has('gmail')) return 'mailboxes'
  const fromHash = location.hash.replace(/^#\/?/, '')
  return pageIds.has(fromHash) ? fromHash : 'overview'
}

function pageUrl(page) {
  const hash = page === 'overview' ? '' : `#/${page}`
  return location.pathname + location.search + hash
}

function formatJoined(value) {
  return new Intl.DateTimeFormat('zh-CN', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  }).format(new Date(value))
}

// New-mail count for the "邮件" tab: notifications that are not yet dismissed.
function useMailCount(page) {
  const [count, setCount] = useState(0)
  useEffect(() => {
    let active = true
    const load = () =>
      api
        .notifications()
        .then((data) => active && setCount(data?.total_count || 0))
        .catch(() => {})
    load()
    const timer = setInterval(load, 30000)
    window.addEventListener(MAIL_NOTICES_CHANGED, load)
    return () => {
      active = false
      clearInterval(timer)
      window.removeEventListener(MAIL_NOTICES_CHANGED, load)
    }
  }, [page])
  return count
}

function AccountMenu({ user, current, busy, onAccount, onLogout }) {
  const [open, setOpen] = useState(false)
  const wrapper = useRef(null)
  const button = useRef(null)

  useEffect(() => {
    if (!open) return
    const onPointer = (event) => {
      if (!wrapper.current?.contains(event.target)) setOpen(false)
    }
    const onKey = (event) => {
      if (event.key === 'Escape') {
        setOpen(false)
        button.current?.focus()
      }
    }
    document.addEventListener('mousedown', onPointer)
    window.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onPointer)
      window.removeEventListener('keydown', onKey)
    }
  }, [open])

  return (
    <div className="account-menu" ref={wrapper}>
      <button
        ref={button}
        type="button"
        className={`avatar-button${current ? ' active' : ''}`}
        aria-label="账号菜单"
        aria-expanded={open}
        aria-controls="account-menu-panel"
        onClick={() => setOpen((value) => !value)}
      >
        {Array.from(user.display_name)[0]}
      </button>
      {open && (
        <div id="account-menu-panel" className="account-menu-panel">
          <p className="account-menu-name">{user.display_name}</p>
          <p className="account-menu-username">{user.username}</p>
          <button
            type="button"
            onClick={() => {
              setOpen(false)
              onAccount()
            }}
          >
            <Icon name="user" size={17} />
            我的账号
          </button>
          <button type="button" onClick={onLogout} disabled={busy}>
            <Icon name="logout" size={17} />
            {busy ? '正在退出…' : '退出登录'}
          </button>
        </div>
      )}
    </div>
  )
}

export default function Home({ user, onLogout, sessionError, onRetry }) {
  const [callbackStatus] = useState(() => new URLSearchParams(location.search).get('gmail'))
  const [page, setPage] = useState(pageFromLocation)
  const [direction, setDirection] = useState('forward')
  const [scheduleAdd, setScheduleAdd] = useState({ open: false, seq: 0 })
  const [inboxConnection, setInboxConnection] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const contentTitle = useRef(null)
  const historyIndex = useRef(0)
  const mailCount = useMailCount(page)

  useEffect(() => {
    contentTitle.current?.focus()
  }, [page])

  useEffect(() => {
    const initialPage = pageFromLocation()
    const url = new URL(location.href)
    url.searchParams.delete('gmail')
    url.hash = initialPage === 'overview' ? '' : `#/${initialPage}`
    const initialIndex = history.state?.hkPage === initialPage ? (history.state.hkIndex ?? 0) : 0
    historyIndex.current = initialIndex
    history.replaceState(
      { hkPage: initialPage, hkIndex: initialIndex },
      '',
      url.pathname + url.search + url.hash,
    )

    const onPop = (event) => {
      if (!event.state?.hkPage) {
        // A hash typed into the address bar: treat it as a new forward step.
        const typed = pageFromLocation()
        const index = historyIndex.current + 1
        history.replaceState({ hkPage: typed, hkIndex: index }, '', pageUrl(typed))
        historyIndex.current = index
        setDirection('forward')
        setPage(typed)
        setScheduleAdd((current) => ({ ...current, open: false }))
        return
      }
      const next = event.state.hkPage
      const index = event.state.hkIndex ?? 0
      setDirection(index < historyIndex.current ? 'back' : 'forward')
      historyIndex.current = index
      setPage(pageIds.has(next) ? next : 'overview')
      setScheduleAdd((current) => ({ ...current, open: false }))
    }
    window.addEventListener('popstate', onPop)
    return () => window.removeEventListener('popstate', onPop)
  }, [])

  function navigate(next, { add = false } = {}) {
    // Each "add schedule" request remounts the schedule page with the form open.
    setScheduleAdd((current) => ({ open: add, seq: add ? current.seq + 1 : current.seq }))
    if (next === page) {
      contentTitle.current?.focus()
      return
    }
    const index = (history.state?.hkIndex ?? 0) + 1
    history.pushState({ hkPage: next, hkIndex: index }, '', pageUrl(next))
    historyIndex.current = index
    setDirection('forward')
    setPage(next)
  }

  async function logout() {
    setBusy(true)
    setError('')
    try {
      await api.logout()
      onLogout()
    } catch (cause) {
      setError(cause.message)
    } finally {
      setBusy(false)
    }
  }

  const section = sections.find((item) => item.pages.some((entry) => entry.id === page))
  const selected = section?.pages.find((item) => item.id === page)
  const selectedGuide = guidePages.find((item) => item.id === page)
  // The home page draws its own greeting; every other page gets this header.
  const greeting = (
    <div className="home-greeting">
      <h1 ref={contentTitle} tabIndex={-1}>
        {page === 'account' ? '账号信息' : selected.title}
      </h1>
      <p>{page === 'account' ? '查看账号信息，修改登录密码。' : selected.description}</p>
      {section && section.pages.length > 1 && (
        <nav className="section-tabs" aria-label={`${section.label}页面`}>
          {section.pages.map((item) => (
            <button
              key={item.id}
              type="button"
              className={item.id === page ? 'active' : ''}
              aria-current={item.id === page ? 'page' : undefined}
              onClick={() => navigate(item.id)}
            >
              {item.tab || item.title}
            </button>
          ))}
        </nav>
      )}
    </div>
  )
  return (
    <div className={`home-shell${page === 'inbox' ? ' inbox-view' : ''}`}>
      <header className="home-header">
        <Brand />
        <nav className="main-nav" aria-label="主导航">
          {sections.map((item) => {
            const active = item === section
            const count = item.id === 'mail' ? mailCount : 0
            return (
              <button
                key={item.id}
                type="button"
                className={`main-nav-link${active ? ' active' : ''}`}
                aria-current={active ? 'page' : undefined}
                aria-label={count ? `${item.label}，${count} 封新邮件` : item.label}
                onClick={() => navigate(item.pages[0].id)}
              >
                <Icon name={item.icon} size={20} className="main-nav-icon" />
                <span className="main-nav-label" aria-hidden="true">
                  <span className="label-long">{item.label}</span>
                  <span className="label-short">{item.short || item.label}</span>
                </span>
                {count > 0 && (
                  <span className="nav-count" aria-hidden="true">
                    {count > 99 ? '99+' : count}
                  </span>
                )}
              </button>
            )
          })}
        </nav>
        <AccountMenu
          user={user}
          current={page === 'account'}
          busy={busy}
          onAccount={() => navigate('account')}
          onLogout={logout}
        />
      </header>
      <main className="home-main" key={page} data-direction={direction}>
        {(error || sessionError) && (
          <div className="message error" role="alert">
            {error || sessionError}
            {sessionError && (
              <button className="text-button" onClick={onRetry}>
                重新连接
              </button>
            )}
          </div>
        )}
        {page !== 'overview' && greeting}
        {page === 'account' ? (
          <AccountDetails user={user} />
        ) : page === 'mailboxes' ? (
          <Mailboxes
            callbackStatus={callbackStatus}
            onInbox={(id) => {
              setInboxConnection(id)
              navigate('inbox')
            }}
          />
        ) : page === 'inbox' ? (
          <Inbox initialConnectionId={inboxConnection} onManage={() => navigate('mailboxes')} />
        ) : page === 'compose' ? (
          <Compose />
        ) : page === 'lecture-live' ? (
          <LectureLive user={user} onOpenRecords={() => navigate('lecture-records')} />
        ) : page === 'lecture-records' ? (
          <LectureRecords onStart={() => navigate('lecture-live')} />
        ) : selectedGuide ? (
          <HkuGuide category={selectedGuide.category} />
        ) : page === 'timetable' ? (
          <Timetable />
        ) : page === 'calendar' ? (
          <Calendar key={scheduleAdd.seq} startAdding={scheduleAdd.open} />
        ) : (
          <TodayHongKong
            name={user.display_name}
            titleRef={contentTitle}
            onNavigate={navigate}
            onAddSchedule={() => navigate('calendar', { add: true })}
          />
        )}
      </main>
    </div>
  )
}
