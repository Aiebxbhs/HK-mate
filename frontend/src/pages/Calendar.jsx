import { useEffect, useState } from 'react'
import { api } from '../api/client'
import Icon from '../components/Icon'
import ScheduleForm from '../components/ScheduleForm'
import {
  AgendaItem,
  CompleteButton,
  hkDay,
  hkWeekday,
  nextEventId,
  sortEvents,
} from '../components/Agenda'
import { shiftDate, useCalendarEvents } from '../components/use-calendar-events'
import Skeleton from '../components/Skeleton'
import { tr } from '../i18n'

const RANGE_DAYS = 100

function dayHeading(iso, today) {
  const weekday = hkWeekday.format(new Date(`${iso}T12:00:00+08:00`))
  const month = Number(iso.slice(5, 7))
  const day = Number(iso.slice(8))
  const label = tr(`${month} 月 ${day} 日 ${weekday}`, `${weekday} ${day}/${month}`)
  if (iso === today) return tr(`今天 ${label}`, `Today, ${label}`)
  if (iso === shiftDate(today, 1)) return tr(`明天 ${label}`, `Tomorrow, ${label}`)
  return label
}

function DeleteControl({ event, onDeleted, onEdit }) {
  const [confirming, setConfirming] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  async function remove() {
    setBusy(true)
    setError('')
    try {
      await api.deleteCalendarEvent(event.id)
      onDeleted()
    } catch (cause) {
      setError(cause.message)
      setBusy(false)
    }
  }

  return (
    <div className="schedule-row-meta">
      {/* Only timetable classes are marked: they cannot be edited, only deleted. */}
      {event.source !== 'manual' && (
        <span className="schedule-source">{tr('HKU 课表', 'HKU timetable')}</span>
      )}
      {!confirming && <CompleteButton event={event} onError={setError} />}
      {!confirming && event.source === 'manual' && (
        <button
          type="button"
          className="schedule-edit"
          aria-label={tr(`编辑 ${event.title}`, `Edit ${event.title}`)}
          onClick={onEdit}
        >
          <Icon name="pen" size={14} aria-hidden="true" />
          {tr('编辑', 'Edit')}
        </button>
      )}
      {confirming ? (
        <span
          className="schedule-confirm"
          role="group"
          aria-label={tr(`确认删除 ${event.title}`, `Confirm deleting ${event.title}`)}
        >
          <span>
            {event.source === 'manual'
              ? tr('删除这项日程？', 'Delete this event?')
              : tr(
                  '删除这节课？重新导入课表后会恢复。',
                  'Delete this class? It comes back if you import the timetable again.',
                )}
          </span>
          <button type="button" className="danger-text" onClick={remove} disabled={busy}>
            {busy ? tr('正在删除…', 'Deleting…') : tr('删除', 'Delete')}
          </button>
          <button type="button" onClick={() => setConfirming(false)} disabled={busy}>
            {tr('取消', 'Cancel')}
          </button>
        </span>
      ) : (
        <button
          type="button"
          className="schedule-delete"
          aria-label={tr(`删除 ${event.title}`, `Delete ${event.title}`)}
          onClick={() => setConfirming(true)}
        >
          <Icon name="trash" size={15} aria-hidden="true" />
          {tr('删除', 'Delete')}
        </button>
      )}
      {error && (
        <span className="schedule-error" role="alert">
          {error}
        </span>
      )}
    </div>
  )
}

export default function Calendar({ startAdding = false }) {
  const [adding, setAdding] = useState(startAdding)
  const [editingId, setEditingId] = useState('')
  const [notice, setNotice] = useState('')
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    const clock = setInterval(() => setNow(new Date()), 60_000)
    return () => clearInterval(clock)
  }, [])
  const today = hkDay(now)
  const { data, loading, error, reload } = useCalendarEvents(today, shiftDate(today, RANGE_DAYS))
  const events = sortEvents(data?.items || [])
  const groups = []
  for (const event of events) {
    const day = hkDay(event.starts_at)
    if (groups.at(-1)?.day !== day) groups.push({ day, events: [] })
    groups.at(-1).events.push(event)
  }
  const todayGroup = groups[0]?.day === today ? groups[0].events : []
  const nextToday = nextEventId(
    todayGroup.filter((event) => event.kind !== 'deadline' && !event.completed),
    now,
  )

  return (
    <section className="schedule-page" aria-label={tr('日程列表', 'Schedule')}>
      <div className="schedule-toolbar">
        <p>
          {tr(`接下来 ${RANGE_DAYS} 天`, `Next ${RANGE_DAYS} days`)}
          {data && tr(`，共 ${events.length} 项`, ` · ${events.length} items`)}
          <span className="schedule-timezone">{tr('香港时间', 'Hong Kong time')}</span>
        </p>
        {!adding && (
          <button
            type="button"
            className="secondary-button add-button"
            onClick={() => {
              setNotice('')
              setEditingId('')
              setAdding(true)
            }}
          >
            <Icon name="plus" size={16} aria-hidden="true" />
            {tr('添加日程', 'Add event')}
          </button>
        )}
      </div>
      {adding && (
        <ScheduleForm
          onCancel={() => setAdding(false)}
          onSaved={() => {
            setAdding(false)
            setNotice(tr('日程已添加。', 'Event added.'))
          }}
        />
      )}
      {notice && (
        <p className="message success" role="status">
          {notice}
        </p>
      )}
      {loading ? (
        <Skeleton label={tr('正在读取日程…', 'Loading schedule…')} rows={4} />
      ) : error ? (
        <p className="message error" role="alert">
          {error}
        </p>
      ) : groups.length ? (
        groups.map((group) => (
          <section
            key={group.day}
            className={`agenda-card schedule-day-group${group.day === today ? ' is-today' : ''}`}
            aria-label={dayHeading(group.day, today)}
          >
            <h2 className="schedule-day-heading">
              <time dateTime={group.day}>{dayHeading(group.day, today)}</time>
              <span>{tr(`${group.events.length} 项`, `${group.events.length} items`)}</span>
            </h2>
            <ol className="agenda-list">
              {group.events.map((event) =>
                event.id === editingId ? (
                  <li key={event.id} className="schedule-editing">
                    <ScheduleForm
                      event={event}
                      className="schedule-form schedule-form-inline"
                      onCancel={() => setEditingId('')}
                      onSaved={() => {
                        setEditingId('')
                        setNotice(tr('日程已修改。', 'Event updated.'))
                      }}
                    />
                  </li>
                ) : (
                  <AgendaItem
                    key={event.id}
                    event={event}
                    now={now}
                    isNext={event.id === nextToday}
                  >
                    <DeleteControl
                      event={event}
                      onEdit={() => {
                        setNotice('')
                        setAdding(false)
                        setEditingId(event.id)
                      }}
                      onDeleted={() => {
                        setNotice(tr('日程已删除。', 'Event deleted.'))
                        reload()
                      }}
                    />
                  </AgendaItem>
                ),
              )}
            </ol>
          </section>
        ))
      ) : (
        <div className="agenda-card agenda-empty">
          <Icon name="calendar" size={22} aria-hidden="true" />
          <p>
            {tr(
              `接下来 ${RANGE_DAYS} 天还没有日程，点击“添加日程”创建一项。`,
              `Nothing in the next ${RANGE_DAYS} days. Click “Add event” to create one.`,
            )}
          </p>
        </div>
      )}
    </section>
  )
}
