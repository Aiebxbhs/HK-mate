import { useEffect, useState } from 'react'
import AgentChat from './AgentChat'
import { hkDay } from './Agenda'
import WeekAhead from './WeekAhead'
import { locale, tr, useLanguage } from '../i18n'

const hkHour = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Asia/Hong_Kong',
  hour: '2-digit',
  hourCycle: 'h23',
})
function hkLongDate(now) {
  const text = new Intl.DateTimeFormat(locale(), {
    timeZone: 'Asia/Hong_Kong',
    month: 'long',
    day: 'numeric',
    weekday: 'short',
  }).format(now)
  return locale() === 'zh-CN' ? text.replace(/(\d+)月(\d+)日/, '$1 月 $2 日 ') : text
}

export function salutation(now) {
  const hour = Number(hkHour.format(now))
  if (hour >= 5 && hour < 12) return tr('早上好', 'Good morning')
  if (hour >= 12 && hour < 18) return tr('下午好', 'Good afternoon')
  return tr('晚上好', 'Good evening')
}

/** Home "今天": greeting and date, the AI assistant, then the next five days. */
export default function TodayHongKong({ name, titleRef, onAddSchedule, onNavigate }) {
  const { t } = useLanguage()
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
          {salutation(now)}
          {t('，', ', ')}
          {name}
        </h1>
        <p>
          <time dateTime={date} title={t('香港时间', 'Hong Kong time')}>
            {hkLongDate(now)}
          </time>
        </p>
      </header>
      <section className="home-assistant" aria-label={t('问 AI', 'Ask AI')}>
        <AgentChat onNavigate={onNavigate} />
      </section>
      <WeekAhead date={date} now={now} onNavigate={onNavigate} onAddSchedule={onAddSchedule} />
    </div>
  )
}
