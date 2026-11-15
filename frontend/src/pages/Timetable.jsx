import { Fragment, useEffect, useMemo, useRef, useState } from 'react'
import { api } from '../api/client'
import TimetableImport from '../components/TimetableImport'
import { hkDay } from '../components/Agenda'
import { SCHEDULE_CHANGED } from '../components/schedule-draft'
import { eventTime, shiftDate } from '../components/use-calendar-events'
import Skeleton from '../components/Skeleton'
import { tr } from '../i18n'

// tr('我的课表', 'My timetable'): the imported HKU courses only, laid out like the HKU portal timetable:
// one long calendar, a row per week (Monday to Sunday), from the first class to the last exam.
const CHUNK_DAYS = 98 // the events API returns at most 100 days per request
const MAX_WEEKS = 60
const weekdays = () =>
  tr(
    ['周一', '周二', '周三', '周四', '周五', '周六', '周日'],
    ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'],
  )
const COLOURS = 6
const COURSE_CODE = /\b([A-Z]{4}\d{4})(?:[-_]([0-9A-Z]+))?/i

export function mondayOf(iso) {
  const weekday = (new Date(`${iso}T12:00:00Z`).getUTCDay() + 6) % 7
  return shiftDate(iso, -weekday)
}

export function courseKey(title) {
  const match = COURSE_CODE.exec(title)
  return match ? match[1].toUpperCase() : title.trim()
}

function isExam(title) {
  return /examination/i.test(title)
}

function shortDate(iso) {
  const month = Number(iso.slice(5, 7))
  const day = Number(iso.slice(8, 10))
  return tr(`${month}月${day}日`, `${day}/${month}`)
}

function CourseCard({ event, colour, selected, onSelect }) {
  const match = COURSE_CODE.exec(event.title)
  const label = match ? `${match[1].toUpperCase()}${match[2] ? ` ${match[2]}` : ''}` : event.title
  const exam = isExam(event.title)
  return (
    <button
      type="button"
      className={`timetable-card colour-${colour}${exam ? ' is-exam' : ''}`}
      aria-pressed={selected}
      onClick={() => onSelect(selected ? '' : event.id)}
    >
      <strong>
        {label}
        {exam && <span className="timetable-exam-tag">{tr('考试', 'Exam')}</span>}
      </strong>
      <span>
        {eventTime(event.starts_at)}–{eventTime(event.ends_at)}
      </span>
      {event.location && <span>{event.location}</span>}
    </button>
  )
}

function EventDetail({ event, course }) {
  return (
    <article className="timetable-detail" aria-label={tr('课程详情', 'Class details')}>
      <h3>{event.title}</h3>
      {course?.course_name && <p className="timetable-detail-name">{course.course_name}</p>}
      <dl>
        <dt>{tr('时间', 'Time')}</dt>
        <dd>
          {shortDate(hkDay(event.starts_at))} {eventTime(event.starts_at)}–
          {eventTime(event.ends_at)}
        </dd>
        <dt>{tr('地点', 'Location')}</dt>
        <dd>{event.location || tr('未注明', 'Not given')}</dd>
      </dl>
    </article>
  )
}

/** Monday of the first and the week after the last week that has a class or an exam. */
export function semesterWeeks(courses) {
  const days = courses.flatMap((course) => [
    course.first_date,
    course.last_date,
    ...course.exams.map((exam) => hkDay(exam.starts_at)),
  ])
  const known = days.filter(Boolean).sort()
  if (!known.length) return []
  const first = mondayOf(known[0])
  const last = mondayOf(known[known.length - 1])
  const weeks = []
  for (let week = first; week <= last && weeks.length < MAX_WEEKS; week = shiftDate(week, 7))
    weeks.push(Array.from({ length: 7 }, (_, day) => shiftDate(week, day)))
  return weeks
}

async function loadEvents(start, end) {
  const requests = []
  for (let from = start; from < end; from = shiftDate(from, CHUNK_DAYS)) {
    const to = shiftDate(from, CHUNK_DAYS) < end ? shiftDate(from, CHUNK_DAYS) : end
    requests.push(api.calendarEvents({ startDate: from, endDate: to }))
  }
  const seen = new Set()
  return (await Promise.all(requests))
    .flatMap((result) => result.items)
    .filter((event) => event.source === 'hku' && !seen.has(event.id) && seen.add(event.id))
}

/** The signed-in user's HKU timetable as one long calendar to scroll through. */
export default function Timetable({ today = hkDay(new Date()) }) {
  const [selectedId, setSelectedId] = useState('')
  const [courses, setCourses] = useState(null)
  const [events, setEvents] = useState(null)
  const [error, setError] = useState('')
  const [version, setVersion] = useState(0)
  const [importing, setImporting] = useState(false)
  const [notice, setNotice] = useState('')
  const thisWeek = useRef(null)
  const scrolled = useRef(false)

  useEffect(() => {
    let active = true
    async function load() {
      try {
        const { courses: list } = await api.calendarCourses()
        const weeks = semesterWeeks(list)
        const items = weeks.length
          ? await loadEvents(weeks[0][0], shiftDate(weeks[weeks.length - 1][0], 7))
          : []
        if (!active) return
        setCourses(list)
        setEvents(items)
        setError('')
      } catch (cause) {
        if (active)
          setError(
            cause.message || tr('课表暂时无法加载。', "The timetable can't be loaded right now."),
          )
      }
    }
    void load()
    return () => {
      active = false
    }
  }, [version])

  useEffect(() => {
    const reload = () => setVersion((value) => value + 1)
    window.addEventListener(SCHEDULE_CHANGED, reload)
    return () => window.removeEventListener(SCHEDULE_CHANGED, reload)
  }, [])

  // Open at this week the first time the calendar shows it.
  useEffect(() => {
    if (!scrolled.current && thisWeek.current) {
      scrolled.current = true
      thisWeek.current.scrollIntoView?.({ block: 'start' })
    }
  })

  function imported(result) {
    setImporting(false)
    setSelectedId('')
    setNotice(
      tr(
        `已导入 ${result.imported} 节课程和考试${
          result.skipped_all_day ? `，跳过 ${result.skipped_all_day} 个全天事件（如大学假期）` : ''
        }。`,
        `Imported ${result.imported} classes and exams${
          result.skipped_all_day
            ? `; skipped ${result.skipped_all_day} all-day events (such as university holidays)`
            : ''
        }.`,
      ),
    )
    scrolled.current = false
    setVersion((value) => value + 1)
  }

  // Each course keeps one colour everywhere.
  const colours = useMemo(
    () => new Map((courses || []).map((course, index) => [course.code, index % COLOURS])),
    [courses],
  )
  const byDay = useMemo(() => {
    const days = new Map()
    for (const event of events || []) {
      const day = hkDay(event.starts_at)
      days.set(day, [...(days.get(day) || []), event])
    }
    return days
  }, [events])

  if (error)
    return (
      <p className="message error" role="alert">
        {error}
      </p>
    )
  if (!courses || !events)
    return <Skeleton label={tr('正在读取课表…', 'Loading timetable…')} rows={5} />
  if (!courses.length) return <TimetableImport firstTime onImported={imported} />

  const weeks = semesterWeeks(courses)
  const currentMonday = mondayOf(today)
  const inSemester = weeks.some((days) => days[0] === currentMonday)
  const selected = events.find((event) => event.id === selectedId)

  return (
    <section className="timetable" aria-label={tr('我的课表', 'My timetable')}>
      <div className="timetable-toolbar">
        <p className="timetable-range">
          {weeks.length
            ? tr(
                `${shortDate(weeks[0][0])} – ${shortDate(weeks[weeks.length - 1][6])}，共 ${weeks.length} 周（香港时间）`,
                `${shortDate(weeks[0][0])} – ${shortDate(weeks[weeks.length - 1][6])}, ${weeks.length} weeks (Hong Kong time)`,
              )
            : tr('没有可显示的上课时间。', 'No class times to show.')}
        </p>
        <div className="timetable-toolbar-side">
          {inSemester && (
            <button
              type="button"
              className="timetable-reimport"
              onClick={() =>
                thisWeek.current?.scrollIntoView?.({ behavior: 'smooth', block: 'start' })
              }
            >
              {tr('回到本周', 'This week')}
            </button>
          )}
          <button
            type="button"
            className="timetable-reimport"
            aria-expanded={importing}
            onClick={() => setImporting((value) => !value)}
          >
            {importing ? tr('收起', 'Close') : tr('重新导入', 'Re-import')}
          </button>
        </div>
      </div>
      {notice && (
        <p className="message success" role="status">
          {notice}
        </p>
      )}
      {importing && <TimetableImport onImported={imported} />}

      <div className="timetable-grid" role="table" aria-label={tr('学期课表', 'Term timetable')}>
        <div className="timetable-row timetable-head" role="row">
          {weekdays().map((name) => (
            <span key={name} role="columnheader">
              {name}
            </span>
          ))}
        </div>
        {weeks.map((days) => (
          <Fragment key={days[0]}>
            <div
              className="timetable-row"
              role="row"
              ref={days[0] === currentMonday ? thisWeek : undefined}
            >
              {days.map((day, index) => {
                const dayEvents = byDay.get(day) || []
                return (
                  <div
                    key={day}
                    role="cell"
                    className={`timetable-cell${day === today ? ' is-today' : ''}${
                      dayEvents.length ? ' has-events' : ''
                    }`}
                  >
                    <span className="timetable-date">
                      {shortDate(day)}
                      <span className="timetable-weekday"> {weekdays()[index]}</span>
                      {day === today && (
                        <span className="timetable-today">{tr('今天', 'Today')}</span>
                      )}
                    </span>
                    {dayEvents.map((event) => (
                      <CourseCard
                        key={event.id}
                        event={event}
                        colour={colours.get(courseKey(event.title)) ?? 0}
                        selected={event.id === selectedId}
                        onSelect={setSelectedId}
                      />
                    ))}
                  </div>
                )
              })}
            </div>
            {selected && days.includes(hkDay(selected.starts_at)) && (
              <div className="timetable-row timetable-detail-row" role="row">
                <div role="cell">
                  <EventDetail
                    event={selected}
                    course={courses.find((course) => course.code === courseKey(selected.title))}
                  />
                </div>
              </div>
            )}
          </Fragment>
        ))}
      </div>
    </section>
  )
}
