import { useEffect, useState } from 'react'
import { api } from '../api/client'
import Icon from './Icon'
import { PLACEHOLDER, composeTarget } from './ReplyDraftPanel'
import { tr } from '../i18n'

const EMAIL = /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/

export function ScheduleCard({ card }) {
  const days =
    card.days > 1
      ? tr(`${card.start_date} 起 ${card.days} 天`, `${card.days} days from ${card.start_date}`)
      : card.start_date
  return (
    <div className="agent-card" role="group" aria-label={tr(`日程 ${days}`, `Schedule ${days}`)}>
      <p className="agent-card-title">
        <Icon name="calendar" size={14} aria-hidden="true" /> {tr('日程', 'Schedule')} · {days}
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
                {item.type === 'deadline' && (
                  <strong className="agent-card-tag">{tr('截止', 'Due')}</strong>
                )}
                {item.course_name ? `${item.title} ${item.course_name}` : item.title}
                {item.location && <small> · {item.location}</small>}
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="agent-card-empty">
          {tr('这段时间没有日程。', 'Nothing scheduled in this period.')}
        </p>
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
      setNotice(tr(`已复制${label}。`, `${label} copied.`))
    } catch {
      setNotice(
        tr(
          `无法自动复制${label}，请手动选中后复制。`,
          `Couldn't copy the ${label.toLowerCase()} automatically. Select it and copy.`,
        ),
      )
    }
  }

  const toValid = EMAIL.test(to.trim())
  const placeholders = `${subject}\n${body}`.match(PLACEHOLDER) || []
  return (
    <div className="agent-card agent-draft" role="group" aria-label={tr('邮件草稿', 'Email draft')}>
      <p className="agent-card-title">
        <Icon name="mail" size={14} aria-hidden="true" /> {tr('邮件草稿', 'Email draft')}
        {card.recipient_name && tr(` · 给 ${card.recipient_name}`, ` · to ${card.recipient_name}`)}
        <small>
          {tr(
            '本机模型起草，HK Mate 不会发送',
            'Drafted by the local model; HK Mate never sends it',
          )}
        </small>
      </p>
      <label>
        {tr('收件人邮箱（自己填写）', 'Recipient address (fill in yourself)')}
        <input
          type="text"
          inputMode="email"
          value={to}
          placeholder={tr('例如 professor@hku.hk', 'e.g. professor@hku.hk')}
          onChange={(event) => setTo(event.target.value)}
        />
      </label>
      {to.trim() && !toValid && (
        <p className="schedule-error">{tr('邮箱格式不正确。', "That address isn't valid.")}</p>
      )}
      <label>
        {tr('主题', 'Subject')}
        <input
          value={subject}
          maxLength={200}
          onChange={(event) => setSubject(event.target.value)}
        />
      </label>
      <label>
        {tr('正文', 'Body')}
        <textarea rows={9} value={body} onChange={(event) => setBody(event.target.value)} />
      </label>
      {placeholders.length > 0 && (
        <p className="reply-warning" role="status">
          {tr(
            `还有 ${placeholders.length} 处需要你补充：${placeholders.join('、')}`,
            `${placeholders.length} to fill in: ${placeholders.join(', ')}`,
          )}
        </p>
      )}
      {card.missing_info.length > 0 && (
        <ul className="reply-checklist" aria-label={tr('发送前请核实', 'Check before sending')}>
          {card.missing_info.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
      )}
      {mailboxes.length > 1 && (
        <label>
          {tr('发件邮箱', 'From')}
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
        <button
          type="button"
          className="mail-secondary"
          onClick={() => copy(subject, tr('主题', 'Subject'))}
        >
          {tr('复制主题', 'Copy subject')}
        </button>
        <button
          type="button"
          className="mail-secondary"
          onClick={() => copy(body, tr('正文', 'Body'))}
        >
          {tr('复制正文', 'Copy body')}
        </button>
        {from && toValid ? (
          <a
            className="mail-primary"
            href={composeTarget({ mailbox: from, to: to.trim(), subject, body }).href}
            target="_blank"
            rel="noopener noreferrer"
          >
            {composeTarget({ mailbox: from, to: to.trim(), subject, body }).label}
          </a>
        ) : (
          <span className="agent-card-hint">
            {from
              ? tr(
                  '填写收件人邮箱后可在 Gmail 中打开',
                  'Enter the recipient address to open it in Gmail',
                )
              : tr('连接 Gmail 后可直接在 Gmail 中打开', 'Connect Gmail to open it in Gmail')}
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
    <div className="agent-card" role="group" aria-label={tr('新日程确认', 'Confirm new event')}>
      <p className="agent-card-title">
        <Icon name="calendar" size={14} aria-hidden="true" />
        {deadline ? tr('新截止事项', 'New deadline') : tr('新日程', 'New event')}
      </p>
      <p className="agent-event">
        <strong>{card.title}</strong>
        <span>
          {card.date}{' '}
          {deadline
            ? tr(`${card.start_time} 截止`, `due ${card.start_time}`)
            : `${card.start_time}–${card.end_time}`}
          {card.location && ` · ${card.location}`}
        </span>
      </p>
      {state === 'added' ? (
        <p className="agent-card-done" role="status">
          {tr('✓ 已添加到我的日程', '✓ Added to My schedule')}
        </p>
      ) : state === 'cancelled' ? (
        <p className="agent-card-hint">{tr('已取消，没有添加。', 'Cancelled; nothing added.')}</p>
      ) : (
        <div className="agent-card-actions">
          <button
            type="button"
            className="mail-primary"
            disabled={state === 'saving'}
            onClick={confirm}
          >
            {state === 'saving' ? tr('正在添加…', 'Adding…') : tr('确认添加', 'Add it')}
          </button>
          <button type="button" className="mail-secondary" onClick={() => setState('cancelled')}>
            {tr('取消', 'Cancel')}
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
    <div className="agent-card" role="group" aria-label={tr('课程记录', 'Lecture records')}>
      <p className="agent-card-title">
        <Icon name="book" size={14} aria-hidden="true" /> {tr('课程记录', 'Lecture records')}
      </p>
      <ul>
        {card.items.map((item) => (
          <li key={item.id}>
            <span className="agent-card-time">{item.date.slice(5)}</span>
            <span>
              {item.course_name}
              {!item.has_summary && <small>{tr(' · 无 AI 摘要', ' · no AI summary')}</small>}
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
            {tr('打开课程记录', 'Open lecture records')}
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
    <aside className="agent-sources" aria-label={tr('资料来源', 'Sources')}>
      <p className="agent-sources-title">
        <Icon name="book" size={13} aria-hidden="true" />
        {tr('资料来源', 'Sources')}
        <span>{tr(`核对于 ${card.verified}`, `Checked ${card.verified}`)}</span>
      </p>
      <ol>
        {safe.map((source) => {
          // Labels are written as "机构：页面标题" ("Organisation: page title" in English).
          const sep = source.label.includes('：') ? '：' : ': '
          const [org, ...rest] = source.label.split(sep)
          const title = rest.join(sep)
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
      <p className="agent-sources-note">
        {tr(
          '信息可能更新，请以官方网站为准。',
          'Information may change; the official websites are authoritative.',
        )}
      </p>
    </aside>
  )
}

/** Places from Google Maps; the attribution and Maps links are required by Google. */
export function PlacesCard({ card }) {
  return (
    <div
      className="agent-card agent-places"
      role="group"
      aria-label={tr(`地点：${card.query}`, `Places: ${card.query}`)}
    >
      <ul>
        {card.places.map((place) => (
          <li key={place.maps_url || place.name}>
            <div className="agent-place-head">
              <strong>{place.name}</strong>
              {place.open_now === true && (
                <span className="agent-place-open">{tr('营业中', 'Open now')}</span>
              )}
              {place.open_now === false && (
                <span className="agent-place-closed">{tr('休息中', 'Closed')}</span>
              )}
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
                <span>
                  {tr(
                    `距港大步行约 ${place.walk_minutes_from_hku} 分钟`,
                    `About ${place.walk_minutes_from_hku} min walk from HKU`,
                  )}
                </span>
              )}
            </div>
            {place.address && <div className="agent-place-address">{place.address}</div>}
            {/^https:\/\//.test(place.maps_url) && (
              <a href={place.maps_url} target="_blank" rel="noopener noreferrer">
                {tr('在 Google 地图中打开 ↗', 'Open in Google Maps ↗')}
              </a>
            )}
          </li>
        ))}
      </ul>
      <p className="agent-card-hint">
        {tr(
          '数据来自 Google 地图，营业时间等信息以商家为准。',
          'Data from Google Maps; opening hours and details may differ, so check with the place.',
        )}
      </p>
    </div>
  )
}

/** Tappable quick replies; only the latest reply's choices can be used. */
export function ChoicesCard({ card, onChoose, disabled }) {
  return (
    <div className="agent-choices" role="group" aria-label={tr('快捷回复', 'Quick replies')}>
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
        <span>
          {tr(`已撤销，不会再记住“${card.fact}”。`, `Undone; “${card.fact}” won't be remembered.`)}
        </span>
      ) : (
        <>
          <span>
            {card.replaced ? tr('已更新记忆', 'Memory updated') : tr('已记住', 'Remembered')}
            {tr('：', ': ')}
            {card.fact}
          </span>
          <button type="button" onClick={undo} disabled={state === 'undoing'}>
            {state === 'failed' ? tr('撤销失败，重试', 'Undo failed, retry') : tr('撤销', 'Undo')}
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
        {tr(
          `这里曾有“${card.query}”的地点结果（Google 地图数据不能存档），需要的话可以让我重新搜索。`,
          `Place results for “${card.query}” were here (Google Maps data can't be saved). Ask me to search again if you need them.`,
        )}
      </p>
    )
  return null
}
