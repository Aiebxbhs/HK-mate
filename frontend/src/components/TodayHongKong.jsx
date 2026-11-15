import { useEffect, useState } from 'react'
import AgentChat from './AgentChat'
import { hkDay } from './Agenda'
import WeekAhead from './WeekAhead'

const hkHour = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Asia/Hong_Kong',
  hour: '2-digit',
  hourCycle: 'h23',
})
const hkLongDate = new Intl.DateTimeFormat('zh-CN', {
  timeZone: 'Asia/Hong_Kong',
  month: 'long',
  day: 'numeric',
  weekday: 'short',
})

export function salutation(now) {
  const hour = Number(hkHour.format(now))
  if (hour >= 5 && hour < 12) return '早上好'
  if (hour >= 12 && hour < 18) return '下午好'
  return '晚上好'
}

/** Home "今天": greeting and date, the AI assistant, then the next five days. */
export default function TodayHongKong({ name, titleRef, onAddSchedule, onNavigate }) {
  const [now, setNow] = useState(() => new Date())

  useEffect(() => {
    const clock = setInterval(() => setNow(new Date()), 60_000)
    return () => clearInterval(clock)
  }, [])

  const date = hkDay(now)
  return (
    <div className="today">
      <header className="today-hero">
        <h1 ref={titleRef} tabIndex={-1}>
          {salutation(now)}，{name}
        </h1>
        <p>
          <time dateTime={date} title="香港时间">
            {hkLongDate.format(now).replace(/(\d+)月(\d+)日/, '$1 月 $2 日 ')}
          </time>
        </p>
      </header>
      <section className="home-assistant" aria-label="问 AI">
        <AgentChat onNavigate={onNavigate} />
      </section>
      <WeekAhead date={date} now={now} onNavigate={onNavigate} onAddSchedule={onAddSchedule} />
    </div>
  )
}
