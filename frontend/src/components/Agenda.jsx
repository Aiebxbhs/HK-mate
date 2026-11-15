import { useState } from 'react'
import { api } from '../api/client'
import DeadlineBar from './DeadlineBar'
import Icon from './Icon'
import { SCHEDULE_CHANGED } from './schedule-draft'
import { eventTime } from './use-calendar-events'
import { locale, tr } from '../i18n'

const hkParts = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Asia/Hong_Kong',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
})
// Formats in the current interface language each time.
export const hkWeekday = {
  format: (value) =>
    new Intl.DateTimeFormat(locale(), { timeZone: 'Asia/Hong_Kong', weekday: 'short' }).format(
      value,
    ),
}

export function hkDay(value) {
  const parts = Object.fromEntries(
    hkParts.formatToParts(new Date(value)).map((part) => [part.type, part.value]),
  )
  return `${parts.year}-${parts.month}-${parts.day}`
}

export function durationLabel(minutes) {
  if (minutes < 60) return tr(`${minutes} 分钟`, `${minutes} min`)
  const hours = Math.floor(minutes / 60)
  const rest = minutes % 60
  if (rest) return tr(`${hours} 小时 ${rest} 分钟`, `${hours} h ${rest} min`)
  return tr(`${hours} 小时`, `${hours} h`)
}

export function sortEvents(events) {
  return [...events].sort(
    (a, b) => new Date(a.starts_at) - new Date(b.starts_at) || a.id.localeCompare(b.id),
  )
}

/** The first event in the list that has not started yet. */
export function nextEventId(events, now) {
  return events.find((event) => new Date(event.starts_at).getTime() > now.getTime())?.id
}

function CourseTitle({ event }) {
  return (
    <h3 className="agenda-title">
      {event.title}
      {event.course_name &&
        !event.title.toLowerCase().includes(event.course_name.toLowerCase()) && (
          <span className="agenda-course-name"> · {event.course_name}</span>
        )}
    </h3>
  )
}

function Location({ value }) {
  if (!value) return null
  return (
    <p className="agenda-location">
      <Icon name="pin" size={15} aria-hidden="true" />
      <span>{value}</span>
    </p>
  )
}

/** One schedule row: large time, status or deadline bar, title and location. */
export function AgendaItem({ event, now, isNext, children }) {
  const nowMs = now.getTime()
  const start = new Date(event.starts_at).getTime()
  const end = new Date(event.ends_at).getTime()
  const deadline = event.kind === 'deadline'
  const state = event.completed
    ? 'done'
    : deadline
      ? 'deadline'
      : end <= nowMs
        ? 'ended'
        : start <= nowMs
          ? 'ongoing'
          : isNext
            ? 'next'
            : ''
  return (
    <li className={`agenda-item today-item${state ? ` is-${state}` : ''}`}>
      <div className="agenda-time">
        {deadline && <span className="agenda-time-kind">{tr('截止', 'Due')}</span>}
        <strong>{eventTime(event.starts_at)}</strong>
        {!deadline && (
          <span>{tr(`至 ${eventTime(event.ends_at)}`, `to ${eventTime(event.ends_at)}`)}</span>
        )}
      </div>
      <div className="agenda-body">
        {state === 'done' && <span className="agenda-status">{tr('已完成', 'Done')}</span>}
        {state === 'ended' && <span className="agenda-status">{tr('已结束', 'Ended')}</span>}
        {state === 'ongoing' && (
          <span className="agenda-status">
            {tr('进行中，还剩 ', 'In progress, ')}
            {durationLabel(Math.ceil((end - nowMs) / 60000))}
            {tr('', ' left')}
          </span>
        )}
        {state === 'next' && (
          <span className="agenda-status">
            {tr('', 'Starts in ')}
            {durationLabel(Math.ceil((start - nowMs) / 60000))}
            {tr('后开始', '')}
          </span>
        )}
        <CourseTitle event={event} />
        {deadline && !event.completed && <DeadlineBar due={event.starts_at} now={now} />}
        <Location value={event.location} />
        {children}
      </div>
    </li>
  )
}

/** Mark done / undo; every schedule list refreshes through the shared event. */
export function CompleteButton({ event, onError }) {
  const [busy, setBusy] = useState(false)
  async function toggle() {
    setBusy(true)
    try {
      await api.setEventCompleted(event.id, !event.completed)
      window.dispatchEvent(new Event(SCHEDULE_CHANGED))
    } catch (cause) {
      onError?.(cause.message)
      setBusy(false)
    }
  }
  return (
    <button
      type="button"
      className={`agenda-complete${event.completed ? ' is-done' : ''}`}
      onClick={toggle}
      disabled={busy}
      aria-label={
        event.completed
          ? tr(`撤销完成 ${event.title}`, `Mark ${event.title} not done`)
          : tr(`完成 ${event.title}`, `Mark ${event.title} done`)
      }
    >
      <Icon name={event.completed ? 'refresh' : 'check'} size={14} aria-hidden="true" />
      {event.completed ? tr('撤销完成', 'Undo') : tr('完成', 'Done')}
    </button>
  )
}
