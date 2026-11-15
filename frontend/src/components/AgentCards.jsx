import { useEffect, useState } from 'react'
import { api } from '../api/client'
import Icon from './Icon'
import { PLACEHOLDER, gmailComposeUrl } from './ReplyDraftPanel'

const EMAIL = /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/

export function ScheduleCard({ card }) {
  const days = card.days > 1 ? `${card.start_date} 起 ${card.days} 天` : card.start_date
  return (
    <div className="agent-card" role="group" aria-label={`日程 ${days}`}>
      <p className="agent-card-title">
        <Icon name="calendar" size={14} aria-hidden="true" /> 日程 · {days}
      </p>
      {card.items.length ? (
        <ul>
          {card.items.map((item) => (
            <li key={`${item.starts}-${item.title}`}>
              <span className="agent-card-time">
                {item.starts.slice(5)}
                {item.ends ? `–${item.ends.slice(11)}` : ''}
              </span>
              <span>
                {item.type === 'deadline' && <strong className="agent-card-tag">截止</strong>}
                {item.course_name ? `${item.title} ${item.course_name}` : item.title}
                {item.location && <small> · {item.location}</small>}
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="agent-card-empty">这段时间没有日程。</p>
      )}
    </div>
  )
}

/** Written by the local model; the user adds the address and sends it from Gmail. */
export function EmailDraftCard({ card }) {
  const [subject, setSubject] = useState(card.subject)
  const [body, setBody] = useState(card.body)
  const [to, setTo] = useState('')
  const [mailboxes, setMailboxes] = useState([])
  const [from, setFrom] = useState('')
  const [notice, setNotice] = useState('')

  useEffect(() => {
    let active = true
    api
      .connections()
      .then((result) => {
        if (!active) return
        const connected = result.items.filter((item) => item.status === 'connected')
        setMailboxes(connected)
        setFrom(connected[0]?.email_address || '')
      })
      .catch(() => {
        // Without a connected Gmail the draft can still be copied.
      })
    return () => {
      active = false
    }
  }, [])

  async function copy(text, label) {
    try {
      await navigator.clipboard.writeText(text)
      setNotice(`已复制${label}。`)
    } catch {
      setNotice(`无法自动复制${label}，请手动选中后复制。`)
    }
  }

  const toValid = EMAIL.test(to.trim())
  const placeholders = `${subject}\n${body}`.match(PLACEHOLDER) || []
  return (
    <div className="agent-card agent-draft" role="group" aria-label="邮件草稿">
      <p className="agent-card-title">
        <Icon name="mail" size={14} aria-hidden="true" /> 邮件草稿
        {card.recipient_name && ` · 给 ${card.recipient_name}`}
        <small>本机模型起草，HK Mate 不会发送</small>
      </p>
      <label>
        收件人邮箱（自己填写）
        <input
          type="text"
          inputMode="email"
          value={to}
          placeholder="例如 professor@hku.hk"
          onChange={(event) => setTo(event.target.value)}
        />
      </label>
      {to.trim() && !toValid && <p className="schedule-error">邮箱格式不正确。</p>}
      <label>
        主题
        <input
          value={subject}
          maxLength={200}
          onChange={(event) => setSubject(event.target.value)}
        />
      </label>
      <label>
        正文
        <textarea rows={9} value={body} onChange={(event) => setBody(event.target.value)} />
      </label>
      {placeholders.length > 0 && (
        <p className="reply-warning" role="status">
          还有 {placeholders.length} 处需要你补充：{placeholders.join('、')}
        </p>
      )}
      {card.missing_info.length > 0 && (
        <ul className="reply-checklist" aria-label="发送前请核实">
          {card.missing_info.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
      )}
      {mailboxes.length > 1 && (
        <label>
          发件邮箱
          <select value={from} onChange={(event) => setFrom(event.target.value)}>
            {mailboxes.map((item) => (
              <option key={item.id} value={item.email_address}>
                {item.email_address}
              </option>
            ))}
          </select>
        </label>
      )}
      <div className="agent-card-actions">
        <button type="button" className="mail-secondary" onClick={() => copy(subject, '主题')}>
          复制主题
        </button>
        <button type="button" className="mail-secondary" onClick={() => copy(body, '正文')}>
          复制正文
        </button>
        {from && toValid ? (
          <a
            className="mail-primary"
            href={gmailComposeUrl({ mailbox: from, to: to.trim(), subject, body })}
            target="_blank"
            rel="noopener noreferrer"
          >
            在 Gmail 中打开
          </a>
        ) : (
          <span className="agent-card-hint">
            {from ? '填写收件人邮箱后可在 Gmail 中打开' : '连接 Gmail 后可直接在 Gmail 中打开'}
          </span>
        )}
      </div>
      {notice && (
        <p className="agent-card-hint" role="status">
          {notice}
        </p>
      )}
    </div>
  )
}

/** Proposed by the assistant; only saved when the user confirms. */
export function EventProposalCard({ card, onAdded }) {
  const [state, setState] = useState('pending')
  const [error, setError] = useState('')
  const deadline = card.kind === 'deadline'

  async function confirm() {
    setState('saving')
    setError('')
    try {
      await api.createCalendarEvent({
        kind: card.kind,
        title: card.title,
        date: card.date,
        start_time: card.start_time,
        end_time: deadline ? null : card.end_time,
        location: card.location,
      })
      setState('added')
      onAdded?.()
    } catch (cause) {
      setError(cause.message)
      setState('pending')
    }
  }

  return (
    <div className="agent-card" role="group" aria-label="新日程确认">
      <p className="agent-card-title">
        <Icon name="calendar" size={14} aria-hidden="true" />
        {deadline ? '新截止事项' : '新日程'}
      </p>
      <p className="agent-event">
        <strong>{card.title}</strong>
        <span>
          {card.date} {deadline ? `${card.start_time} 截止` : `${card.start_time}–${card.end_time}`}
          {card.location && ` · ${card.location}`}
        </span>
      </p>
      {state === 'added' ? (
        <p className="agent-card-done" role="status">
          ✓ 已添加到我的日程
        </p>
      ) : state === 'cancelled' ? (
        <p className="agent-card-hint">已取消，没有添加。</p>
      ) : (
        <div className="agent-card-actions">
          <button
            type="button"
            className="mail-primary"
            disabled={state === 'saving'}
            onClick={confirm}
          >
            {state === 'saving' ? '正在添加…' : '确认添加'}
          </button>
          <button type="button" className="mail-secondary" onClick={() => setState('cancelled')}>
            取消
          </button>
        </div>
      )}
      {error && (
        <p className="message error" role="alert">
          {error}
        </p>
      )}
    </div>
  )
}

export function LecturesCard({ card, onNavigate }) {
  return (
    <div className="agent-card" role="group" aria-label="课程记录">
      <p className="agent-card-title">
        <Icon name="book" size={14} aria-hidden="true" /> 课程记录
      </p>
      <ul>
        {card.items.map((item) => (
          <li key={item.id}>
            <span className="agent-card-time">{item.date.slice(5)}</span>
            <span>
              {item.course_name}
              {!item.has_summary && <small> · 无 AI 摘要</small>}
            </span>
          </li>
        ))}
      </ul>
      {onNavigate && (
        <div className="agent-card-actions">
          <button
            type="button"
            className="mail-secondary"
            onClick={() => onNavigate('lecture-records')}
          >
            打开课程记录
          </button>
        </div>
      )}
    </div>
  )
}

/** Official sources behind a guide answer; links open the official pages. */
export function KnowledgeCard({ card }) {
  const safe = card.sources.filter((source) => /^https:\/\//.test(source.url))
  return (
    <aside className="agent-sources" aria-label="资料来源">
      <p className="agent-sources-title">
        <Icon name="book" size={13} aria-hidden="true" />
        资料来源
        <span>核对于 {card.verified}</span>
      </p>
      <ol>
        {safe.map((source) => {
          // Labels are written as "机构：页面标题".
          const [org, ...rest] = source.label.split('：')
          const title = rest.join('：')
          return (
            <li key={source.url}>
              <a href={source.url} target="_blank" rel="noopener noreferrer">
                {title ? (
                  <>
                    <span className="agent-source-org">{org}</span>
                    <span className="agent-source-title">{title}</span>
                  </>
                ) : (
                  <span className="agent-source-title">{source.label}</span>
                )}
                <span aria-hidden="true">↗</span>
              </a>
            </li>
          )
        })}
      </ol>
      <p className="agent-sources-note">信息可能更新，请以官方网站为准。</p>
    </aside>
  )
}

/** Places from Google Maps; the attribution and Maps links are required by Google. */
export function PlacesCard({ card }) {
  return (
    <div className="agent-card agent-places" role="group" aria-label={`地点：${card.query}`}>
      <ul>
        {card.places.map((place) => (
          <li key={place.maps_url || place.name}>
            <div className="agent-place-head">
              <strong>{place.name}</strong>
              {place.open_now === true && <span className="agent-place-open">营业中</span>}
              {place.open_now === false && <span className="agent-place-closed">休息中</span>}
            </div>
            <div className="agent-place-meta">
              {place.rating != null && (
                <span>
                  ★ {place.rating.toFixed(1)}
                  {place.rating_count != null && `（${place.rating_count}）`}
                </span>
              )}
              {place.price && <span>{place.price}</span>}
              {place.kind && <span>{place.kind}</span>}
              {place.walk_minutes_from_hku != null && (
                <span>距港大步行约 {place.walk_minutes_from_hku} 分钟</span>
              )}
            </div>
            {place.address && <div className="agent-place-address">{place.address}</div>}
            {/^https:\/\//.test(place.maps_url) && (
              <a href={place.maps_url} target="_blank" rel="noopener noreferrer">
                在 Google 地图中打开 ↗
              </a>
            )}
          </li>
        ))}
      </ul>
      <p className="agent-card-hint">数据来自 Google 地图，营业时间等信息以商家为准。</p>
    </div>
  )
}

/** Tappable quick replies; only the latest reply's choices can be used. */
export function ChoicesCard({ card, onChoose, disabled }) {
  return (
    <div className="agent-choices" role="group" aria-label="快捷回复">
      {card.options.map((option) => (
        <button key={option} type="button" disabled={disabled} onClick={() => onChoose?.(option)}>
          {option}
        </button>
      ))}
    </div>
  )
}

/** "Remembered: …" with an undo; the memory list is managed in the memory panel. */
export function MemorySavedCard({ card }) {
  const [state, setState] = useState('saved')
  async function undo() {
    setState('undoing')
    try {
      await api.deleteAgentMemory(card.id)
      setState('undone')
    } catch {
      setState('failed')
    }
  }
  return (
    <p className="agent-memory-chip" role="status">
      <Icon name="spark" size={13} aria-hidden="true" />
      {state === 'undone' ? (
        <span>已撤销，不会再记住“{card.fact}”。</span>
      ) : (
        <>
          <span>
            {card.replaced ? '已更新记忆' : '已记住'}：{card.fact}
          </span>
          <button type="button" onClick={undo} disabled={state === 'undoing'}>
            {state === 'failed' ? '撤销失败，重试' : '撤销'}
          </button>
        </>
      )}
    </p>
  )
}

export default function AgentCard({ card, onNavigate }) {
  if (card.type === 'schedule') return <ScheduleCard card={card} />
  if (card.type === 'email_draft') return <EmailDraftCard card={card} />
  if (card.type === 'event_proposal') return <EventProposalCard card={card} />
  if (card.type === 'lectures') return <LecturesCard card={card} onNavigate={onNavigate} />
  if (card.type === 'knowledge') return <KnowledgeCard card={card} />
  if (card.type === 'places') return <PlacesCard card={card} />
  if (card.type === 'memory_saved') return <MemorySavedCard card={card} />
  if (card.type === 'places_expired')
    return (
      <p className="agent-card-hint">
        这里曾有“{card.query}”的地点结果（Google 地图数据不能存档），需要的话可以让我重新搜索。
      </p>
    )
  return null
}
