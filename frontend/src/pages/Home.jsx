import { useEffect, useRef, useState } from 'react'
import { api } from '../api/client'
import Brand from '../components/Brand'
import Icon from '../components/Icon'
import { MAIL_NOTICES_CHANGED } from '../components/NewMailNotice'
import PasswordChange from '../components/PasswordChange'
import TodayHongKong from '../components/TodayHongKong'
import Calendar from './Calendar'
import Compose from './Compose'
import { LectureIndicator, LectureSessionProvider } from '../components/LectureSession'
import LectureLive from './LectureLive'
import HkuGuide from './HkuGuide'
import Timetable from './Timetable'
import LectureRecords from './LectureRecords'
import Mailboxes from './Mailboxes'
import Inbox from './Inbox'
import { locale, setLanguage, tr, useLanguage } from '../i18n'

// Page names are built at render time so they follow the interface language.
function navigation() {
  // "邮件" section. Summaries and reply drafts live in the inbox's AI assistant column.
  const mailboxPages = [
    {
      id: 'inbox',
      icon: 'mail',
      title: tr('统一收件箱', 'Inbox'),
      description: tr(
        '已连接邮箱的邮件集中在这里，可用本地 AI 摘要和起草回复。',
        'Mail from your connected mailboxes in one place, with local AI summaries and reply drafts.',
      ),
    },
    {
      id: 'compose',
      icon: 'pen',
      title: tr('起草邮件', 'Draft an email'),
      description: tr(
        '写下几个要点，本地 AI 起草新邮件；系统不会替你发送。',
        'Write a few points and the local AI drafts a new email. HK Mate never sends it for you.',
      ),
    },
    {
      id: 'mailboxes',
      icon: 'mail-settings',
      title: tr('邮箱管理', 'Mailboxes'),
      description: tr(
        '连接或解绑 Gmail，查看每个邮箱的连接状态。',
        'Connect or unlink Gmail and check each mailbox’s status.',
      ),
    },
  ]
  // "课堂翻译" section (docs/LECTURE.md).
  const lecturePages = [
    {
      id: 'lecture-live',
      icon: 'mic',
      title: tr('实时翻译', 'Live translation'),
      description: tr(
        '英文讲课实时转成中英字幕，可记笔记，下课后生成摘要。',
        'English lectures become live English–Chinese captions. Take notes and get a summary after class.',
      ),
    },
    {
      id: 'lecture-records',
      icon: 'book',
      title: tr('课程记录', 'Lecture records'),
      description: tr(
        '已保存的字幕、课堂笔记和课后摘要，按课程查找。',
        'Saved captions, notes and summaries, grouped by course.',
      ),
    },
  ]
  // "HKU 指南" section: postgraduate guide from official HKU sources (app/guide_api.py).
  const guidePages = [
    {
      id: 'guide-library',
      category: 'library',
      icon: 'book',
      title: tr('图书馆', 'Library'),
      description: tr(
        '开放、借阅、打印与 Main Library 逐层设施，来自港大官方来源。',
        'Opening, borrowing, printing and Main Library floor by floor, from official HKU sources.',
      ),
    },
    {
      id: 'guide-transport',
      category: 'transport',
      icon: 'pin',
      title: tr('交通与校园位置', 'Transport & campus'),
      description: tr(
        '港铁出口、巴士小巴与穿梭巴士路线，以及官方校园地图。',
        'MTR exits, bus, minibus and shuttle routes, and the official campus map.',
      ),
    },
    {
      id: 'guide-services',
      category: 'services',
      icon: 'user',
      title: tr('学生服务与联系方式', 'Student services & contacts'),
      description: tr(
        '成绩单、学费、健康与心理辅导、住宿就业等办事入口和联系方式。',
        'Transcripts, fees, health and counselling, housing and careers: where to go and whom to contact.',
      ),
    },
  ]
  // "日程" section: the schedule list and the term timetable.
  const schedulePages = [
    {
      id: 'calendar',
      icon: 'calendar',
      title: tr('我的日程', 'My schedule'),
      tab: tr('日程', 'Schedule'),
      description: tr(
        '接下来 100 天的课程和日程，可添加、编辑和完成截止事项。',
        'Classes and events for the next 100 days. Add, edit and complete deadlines.',
      ),
    },
    {
      id: 'timetable',
      icon: 'grid',
      title: tr('我的课表', 'My timetable'),
      tab: tr('课表', 'Timetable'),
      description: tr('这学期的 HKU 课程，按周查看。', 'This term’s HKU classes, week by week.'),
    },
  ]
  // Top-level navigation: the same five places on desktop (top bar) and phone (tab bar).
  const sections = [
    { id: 'overview', label: tr('主页', 'Home'), icon: 'grid', pages: [{ id: 'overview' }] },
    { id: 'schedule', label: tr('日程', 'Schedule'), icon: 'calendar', pages: schedulePages },
    { id: 'mail', label: tr('邮件', 'Mail'), icon: 'mail', pages: mailboxPages },
    {
      id: 'lecture',
      label: tr('课堂翻译', 'Lectures'),
      short: tr('翻译', 'Lectures'),
      icon: 'mic',
      pages: lecturePages,
    },
    {
      id: 'guide',
      label: tr('HKU 指南', 'HKU guide'),
      short: tr('指南', 'Guide'),
      icon: 'pin',
      pages: guidePages,
    },
  ]
  return { sections, guidePages }
}

function LanguageSetting({ onUser }) {
  const { language, t } = useLanguage()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  async function choose(next) {
    if (next === language || busy) return
    setBusy(true)
    setError('')
    try {
      const updated = await api.setLanguage(next)
      setLanguage(updated.language)
      onUser?.(updated)
    } catch (cause) {
      setError(cause.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="account-card language-setting">
      <div>
        <h3>{t('语言', 'Language')}</h3>
        <p>
          {t(
            '界面、AI 助手回复和之后生成的摘要都会使用所选语言；课堂翻译仍为英译中。',
            'The interface, AI assistant replies and new summaries use this language. Lecture translation stays English to Chinese.',
          )}
        </p>
      </div>
      <div className="segmented" role="group" aria-label={t('语言', 'Language')}>
        {[
          ['zh', '中文'],
          ['en', 'English'],
        ].map(([value, label]) => (
          <button
            key={value}
            type="button"
            className={language === value ? 'active' : ''}
            aria-pressed={language === value}
            disabled={busy}
            onClick={() => choose(value)}
          >
            {label}
          </button>
        ))}
      </div>
      {error && (
        <div className="message error" role="alert">
          {error}
        </div>
      )}
    </div>
  )
}

function AccountDetails({ user, onUser }) {
  const { t } = useLanguage()
  return (
    <section className="account-section" aria-labelledby="account-title">
      <div className="section-title">
        <h2 id="account-title">{t('我的账号', 'My account')}</h2>
      </div>
      <div className="account-card">
        <div className="avatar">{Array.from(user.display_name)[0]}</div>
        <div>
          <strong>{user.display_name}</strong>
          <p>{user.username}</p>
        </div>
        <div className="account-date">
          <span>{t('加入 HK Mate', 'Joined HK Mate')}</span>
          <strong>{formatJoined(user.created_at)}</strong>
        </div>
      </div>
      <LanguageSetting onUser={onUser} />
      <PasswordChange username={user.username} />
    </section>
  )
}

const pageIds = new Set([
  'account',
  ...navigation().sections.flatMap((section) => section.pages.map((item) => item.id)),
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
  return new Intl.DateTimeFormat(locale(), {
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
  const { t } = useLanguage()
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
        aria-label={t('账号菜单', 'Account menu')}
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
            {t('我的账号', 'My account')}
          </button>
          <button type="button" onClick={onLogout} disabled={busy}>
            <Icon name="logout" size={17} />
            {busy ? t('正在退出…', 'Signing out…') : t('退出登录', 'Sign out')}
          </button>
        </div>
      )}
    </div>
  )
}

// The lecture session sits above every page, so recording and captions continue while the
// inbox or the schedule is open; it ends with the signed-in session.
export default function Home(props) {
  return (
    <LectureSessionProvider key={props.user.id} user={props.user}>
      <HomeShell {...props} />
    </LectureSessionProvider>
  )
}

function HomeShell({ user, onUser, onLogout, sessionError, onRetry }) {
  const { t } = useLanguage()
  const { sections, guidePages } = navigation()
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
        {page === 'account' ? t('账号信息', 'Account') : selected.title}
      </h1>
      <p>
        {page === 'account'
          ? t('查看账号信息，切换语言，修改登录密码。', 'Your account, language and password.')
          : selected.description}
      </p>
      {section && section.pages.length > 1 && (
        <nav
          className="section-tabs"
          aria-label={t(`${section.label}页面`, `${section.label} pages`)}
        >
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
        <nav className="main-nav" aria-label={t('主导航', 'Main navigation')}>
          {sections.map((item) => {
            const active = item === section
            const count = item.id === 'mail' ? mailCount : 0
            return (
              <button
                key={item.id}
                type="button"
                className={`main-nav-link${active ? ' active' : ''}`}
                aria-current={active ? 'page' : undefined}
                aria-label={
                  count
                    ? t(`${item.label}，${count} 封新邮件`, `${item.label}, ${count} new`)
                    : item.label
                }
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
        <div className="header-end">
          {page !== 'lecture-live' && <LectureIndicator onOpen={() => navigate('lecture-live')} />}
          <AccountMenu
            user={user}
            current={page === 'account'}
            busy={busy}
            onAccount={() => navigate('account')}
            onLogout={logout}
          />
        </div>
      </header>
      <main className="home-main" key={page} data-direction={direction}>
        {(error || sessionError) && (
          <div className="message error" role="alert">
            {error || sessionError}
            {sessionError && (
              <button className="text-button" onClick={onRetry}>
                {t('重新连接', 'Reconnect')}
              </button>
            )}
          </div>
        )}
        {page !== 'overview' && greeting}
        {page === 'account' ? (
          <AccountDetails user={user} onUser={onUser} />
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
