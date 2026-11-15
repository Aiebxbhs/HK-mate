import { durationLabel, hkDay, hkWeekday, sortEvents } from './Agenda'
import Skeleton from './Skeleton'
import { eventTime, shiftDate, useCalendarEvents } from './use-calendar-events'

export const DAYS = 5
const DAY_MS = 86_400_000

function dayName(iso, today) {
  if (iso === today) return '今天'
  if (iso === shiftDate(today, 1)) return '明天'
  return hkWeekday.format(new Date(`${iso}T12:00:00+08:00`))
}

/** A short note for today's items only: running now, or the next class soon. */
function liveNote(event, now, isNext) {
  if (event.kind === 'deadline' || event.completed) return ''
  const start = new Date(event.starts_at).getTime()
  const end = new Date(event.ends_at).getTime()
  const nowMs = now.getTime()
  if (start <= nowMs && nowMs < end) return '进行中'
  if (isNext) return `${durationLabel(Math.ceil((start - nowMs) / 60000))}后`
  return ''
}

function Item({ event, now, isNext, isToday }) {
  const deadline = event.kind === 'deadline'
  const ended = !deadline && new Date(event.ends_at).getTime() <= now.getTime()
  const done = event.completed
  // Accent dot only for open deadlines due within a day; other deadlines stay grey.
  const urgent = deadline && !done && new Date(event.starts_at).getTime() - now.getTime() < DAY_MS
  const note = isToday ? liveNote(event, now, isNext) : ''
  return (
    <li className={`week-item${deadline ? ' is-deadline' : ''}${ended || done ? ' is-past' : ''}`}>
      {deadline ? (
        <span className={`week-dot${urgent ? ' is-urgent' : ''}`} aria-hidden="true" />
      ) : (
        <span className="week-time">
          {eventTime(event.starts_at)}–{eventTime(event.ends_at)}
        </span>
      )}
      <span className="week-title">
        {event.title}
        {deadline && (
          <span className="week-meta">
            {' '}
            {done ? '已完成' : `${eventTime(event.starts_at)} 截止`}
          </span>
        )}
      </span>
      {!deadline && event.location && <span className="week-meta">{event.location}</span>}
      {note && <span className="week-note">{note}</span>}
    </li>
  )
}

/** Home: the next five days of classes, own events and deadlines, one column per day. */
export default function WeekAhead({ date, now, onNavigate, onAddSchedule }) {
  const { data, loading, error } = useCalendarEvents(date, shiftDate(date, DAYS))
  const days = Array.from({ length: DAYS }, (_, index) => shiftDate(date, index))
  const sorted = sortEvents(data?.items || [])
  const byDay = Object.fromEntries(days.map((day) => [day, []]))
  for (const event of sorted) byDay[hkDay(event.starts_at)]?.push(event)
  const nextId = byDay[date].find(
    (event) =>
      event.kind !== 'deadline' &&
      !event.completed &&
      new Date(event.starts_at).getTime() > now.getTime(),
  )?.id

  return (
    <section className="week-ahead" aria-labelledby="week-ahead-title">
      <div className="week-ahead-head">
        <h2 id="week-ahead-title">接下来 {DAYS} 天</h2>
        {onNavigate && (
          <button type="button" className="link-button" onClick={() => onNavigate('calendar')}>
            全部日程
          </button>
        )}
      </div>
      {error ? (
        <p className="message error" role="alert">
          {error}
        </p>
      ) : loading ? (
        <Skeleton label="正在读取日程…" rows={2} />
      ) : !data?.total_events ? (
        <div className="week-empty">
          <p>还没有日程。导入这学期的 HKU 课表，或者自己添加一项。</p>
          <div>
            {onNavigate && (
              <button
                type="button"
                className="secondary-button"
                onClick={() => onNavigate('timetable')}
              >
                导入课表
              </button>
            )}
            {onAddSchedule && (
              <button type="button" className="secondary-button" onClick={onAddSchedule}>
                添加日程
              </button>
            )}
          </div>
        </div>
      ) : (
        <ol className="week-days">
          {days.map((day) => (
            <li
              key={day}
              className={`week-day${day === date ? ' is-today' : ''}`}
              aria-label={`${dayName(day, date)} ${Number(day.slice(8))} 日`}
            >
              <h3>
                {dayName(day, date)}
                <span>{Number(day.slice(8))} 日</span>
              </h3>
              {byDay[day].length ? (
                <ul>
                  {byDay[day].map((event) => (
                    <Item
                      key={event.id}
                      event={event}
                      now={now}
                      isNext={event.id === nextId}
                      isToday={day === date}
                    />
                  ))}
                </ul>
              ) : (
                <p className="week-none">没有安排</p>
              )}
            </li>
          ))}
        </ol>
      )}
    </section>
  )
}
