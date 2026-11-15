import { useEffect, useRef, useState } from 'react'
import { api } from '../api/client'
import Icon from './Icon'
import MailCategoryTag from './MailCategoryTag'
import ReplyDraftPanel from './ReplyDraftPanel'
import ScheduleForm from './ScheduleForm'
import Skeleton from './Skeleton'

/** Fired when the number of new-mail notices changes, so the "邮件" tab count follows. */
export const MAIL_NOTICES_CHANGED = 'hkm:mail-notices-changed'

function ScheduleFromMail({ onClose }) {
  const [saved, setSaved] = useState(null)

  if (saved) {
    return (
      <div className="schedule-saved" role="status">
        <p>
          已加入“我的日程”：{saved.title}，
          {new Intl.DateTimeFormat('zh-CN', {
            timeZone: 'Asia/Hong_Kong',
            month: 'numeric',
            day: 'numeric',
            weekday: 'short',
            hour: '2-digit',
            minute: '2-digit',
          }).format(new Date(saved.starts_at))}
          。
        </p>
        <button type="button" className="mail-primary" onClick={onClose}>
          完成
        </button>
      </div>
    )
  }
  return (
    <ScheduleForm
      heading=""
      className="schedule-form schedule-form-dialog"
      onCancel={onClose}
      onSaved={setSaved}
    />
  )
}

function MessageDialog({ kind, notification, onClose }) {
  const dialog = useRef(null)
  const [mail, setMail] = useState(null)
  const [error, setError] = useState('')
  useEffect(() => {
    const element = dialog.current
    element.showModal()
    // showModal focuses the first control; prefer a field the content asked for.
    element.querySelector('[data-autofocus]')?.focus()
    let active = true
    if (kind === 'mail') {
      api
        .message(notification.connection_id, notification.message_id)
        .then((result) => {
          if (active) setMail(result)
        })
        .catch((cause) => {
          if (active) setError(cause.message)
        })
    }
    return () => {
      active = false
      element.close()
    }
  }, [kind, notification.connection_id, notification.message_id])
  return (
    <dialog
      ref={dialog}
      className="home-preview-dialog"
      aria-labelledby="notification-dialog-title"
      onCancel={(event) => {
        event.preventDefault()
        onClose()
      }}
    >
      <div className="preview-dialog-heading">
        <span className="home-preview-label">
          {kind === 'mail' ? '原邮件 · 只读' : kind === 'reply' ? '起草回复' : '加入日程'}
        </span>
        <button type="button" className="sidebar-close" aria-label="关闭邮件窗口" onClick={onClose}>
          <Icon name="close" size={19} />
        </button>
      </div>
      <h2 id="notification-dialog-title">{notification.subject}</h2>
      <p className="preview-dialog-meta">
        {notification.sender} · {notification.mailbox}
      </p>
      {kind === 'mail' ? (
        error ? (
          <p className="message error" role="alert">
            {error}
          </p>
        ) : mail ? (
          <>
            <div className="mail-body-text">{mail.body}</div>
            {mail.attachments.length > 0 && (
              <p className="preview-dialog-note">附件：{mail.attachments.join('、')}（未下载）</p>
            )}
          </>
        ) : (
          <Skeleton label="正在读取原邮件…" rows={5} variant="text" />
        )
      ) : kind === 'reply' ? (
        <ReplyDraftPanel
          connectionId={notification.connection_id}
          messageId={notification.message_id}
        />
      ) : (
        <ScheduleFromMail onClose={onClose} />
      )}
    </dialog>
  )
}

export default function NewMailNotice() {
  const [expanded, setExpanded] = useState(false)
  const [data, setData] = useState(null)
  const [messages, setMessages] = useState([])
  const [error, setError] = useState('')
  const [reload, setReload] = useState(0)
  const [checking, setChecking] = useState(false)
  const [busy, setBusy] = useState([])
  const [preview, setPreview] = useState(null)
  const previousCount = useRef(0)

  useEffect(() => {
    let active = true
    let inflight = false
    let authorized = true
    async function load() {
      if (!active || inflight || !authorized) return
      inflight = true
      try {
        const first = await api.notifications()
        const all = [...first.items]
        let cursor = first.next_cursor
        const seen = new Set()
        while (cursor && active) {
          if (seen.has(cursor)) throw new Error('通知分页暂不可用，请稍后重试。')
          seen.add(cursor)
          const page = await api.notifications(cursor)
          all.push(...page.items)
          cursor = page.next_cursor
        }
        if (!active) return
        setMessages([...new Map(all.map((item) => [item.id, item])).values()])
        setData(first)
        setError('')
        if (first.total_count > previousCount.current) setExpanded(true)
        if (first.total_count !== previousCount.current) {
          window.dispatchEvent(new Event(MAIL_NOTICES_CHANGED))
        }
        previousCount.current = first.total_count
      } catch (cause) {
        if (active) {
          setError(cause.message || '新邮件通知暂时无法更新。')
          if (cause.status === 401 || cause.status === 403) {
            authorized = false
            setMessages([])
            setData(null)
          }
        }
      } finally {
        inflight = false
      }
    }
    void load()
    const timer = setInterval(load, 3000)
    const focus = () => void load()
    window.addEventListener('focus', focus)
    return () => {
      active = false
      clearInterval(timer)
      window.removeEventListener('focus', focus)
    }
  }, [reload])

  async function check() {
    setChecking(true)
    try {
      await api.checkNotifications()
      setReload((value) => value + 1)
    } catch (cause) {
      setError(cause.message)
    } finally {
      setChecking(false)
    }
  }

  async function change(message, action) {
    setBusy((values) => [...values, message.id])
    try {
      if (action === 'dismiss') await api.dismissNotification(message.id)
      else await api.retryNotification(message.id)
      setReload((value) => value + 1)
    } catch (cause) {
      setError(cause.message)
    } finally {
      setBusy((values) => values.filter((id) => id !== message.id))
    }
  }

  const count = data?.total_count || 0
  const processing = messages.filter((item) =>
    ['pending', 'processing'].includes(item.status),
  ).length
  if (count === 0) return null

  return (
    <section className="new-mail-preview new-mail-batch" aria-labelledby="new-mail-title">
      <div className="new-mail-batch-header">
        <div className="new-mail-batch-intro">
          <div className="new-mail-heading">
            <span className="new-mail-dot" aria-hidden="true" />
            <h2 id="new-mail-title" aria-live="polite">
              {`${count} 封新邮件`}
            </h2>
            <span className="new-mail-label">
              {data?.enabled === false ? '自动检测已关闭' : '本地 Qwen 已自动摘要'}
            </span>
          </div>
          {(!data || !data.connection_count || processing > 0) && (
            <p>
              {!data
                ? '正在连接您的邮箱…'
                : !data.connection_count
                  ? '请先在邮箱管理中连接 Gmail。'
                  : `${processing} 封邮件正在排队或生成摘要…`}
            </p>
          )}
        </div>
        <div className="notification-header-actions">
          <button
            type="button"
            className="link-button"
            disabled={checking || data?.enabled === false}
            onClick={check}
          >
            {checking ? '正在检查…' : '立即检查'}
          </button>
          {count > 0 && (
            <button
              type="button"
              className="link-button new-mail-list-toggle"
              aria-label={`${expanded ? '收起新邮件' : '查看新邮件'}，共 ${count} 封`}
              aria-expanded={expanded}
              aria-controls="new-mail-list"
              onClick={() => setExpanded((value) => !value)}
            >
              {expanded ? '收起' : '展开'}
              <Icon
                name="chevron"
                size={16}
                className={expanded ? 'submenu-chevron expanded' : 'submenu-chevron'}
              />
            </button>
          )}
        </div>
      </div>
      {error && (
        <p className="message error" role="alert">
          {error}
        </p>
      )}
      {data?.errors.map((message) => (
        <p key={message} className="message error" role="alert">
          {message}
        </p>
      ))}
      {data?.last_checked_at && (
        <p className="notification-last-check">
          上次检查：
          {new Date(data.last_checked_at).toLocaleTimeString('zh-CN', {
            timeZone: 'Asia/Hong_Kong',
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit',
          })}
          （香港时间）
        </p>
      )}
      {expanded && messages.length > 0 && (
        <ol id="new-mail-list" className="new-mail-list">
          {messages.map((message) => (
            <li key={message.id}>
              <article className="new-mail-card" aria-labelledby={`message-${message.id}`}>
                <div className="new-mail-card-heading">
                  <MailCategoryTag
                    category={message.category || message.summary?.category}
                    pending={message.status !== 'failed'}
                    failed={message.status === 'failed'}
                  />
                  <h3 id={`message-${message.id}`}>{message.subject}</h3>
                </div>
                <p className="new-mail-sender">
                  <span>{message.sender}</span>
                  <span>{message.mailbox}</span>
                </p>
                {message.status === 'ready' ? (
                  <>
                    <p className="new-mail-summary">{message.summary.overview}</p>
                    {message.summary.uncertainties.length > 0 && (
                      <p className="notification-note">
                        {message.summary.uncertainties.join('；')}
                      </p>
                    )}
                  </>
                ) : message.status === 'failed' ? (
                  <div className="message error">
                    <span>{message.error || '摘要生成失败。'}</span>
                    <button
                      type="button"
                      className="text-button"
                      disabled={busy.includes(message.id)}
                      onClick={() => change(message, 'retry')}
                    >
                      重试摘要
                    </button>
                  </div>
                ) : (
                  <p className="new-mail-summary" role="status">
                    {message.status === 'processing'
                      ? '本地模型正在生成摘要和分类…'
                      : '已收到邮件，正在排队生成摘要…'}
                  </p>
                )}
                <div className="new-mail-actions">
                  <button
                    type="button"
                    onClick={() => setPreview({ kind: 'mail', notification: message })}
                  >
                    <Icon name="mail" size={16} />
                    查看原邮件
                  </button>
                  <button
                    type="button"
                    disabled={message.status !== 'ready'}
                    onClick={() => setPreview({ kind: 'schedule', notification: message })}
                  >
                    <Icon name="calendar" size={16} />
                    加入日程
                  </button>
                  <button
                    type="button"
                    onClick={() => setPreview({ kind: 'reply', notification: message })}
                  >
                    <Icon name="pen" size={16} />
                    起草回复
                  </button>
                  <button
                    type="button"
                    className="new-mail-ignore"
                    disabled={busy.includes(message.id)}
                    onClick={() => change(message, 'dismiss')}
                  >
                    忽略
                  </button>
                </div>
              </article>
            </li>
          ))}
        </ol>
      )}
      {preview && (
        <MessageDialog
          kind={preview.kind}
          notification={preview.notification}
          onClose={() => setPreview(null)}
        />
      )}
    </section>
  )
}
