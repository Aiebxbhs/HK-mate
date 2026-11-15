import { tr } from '../i18n'
import { useCallback, useEffect, useState } from 'react'
import { api } from '../api/client'
import { SCHEDULE_CHANGED } from './schedule-draft'

export function useCalendarEvents(startDate, endDate) {
  const [result, setResult] = useState({ data: null, loading: true, error: '' })
  const [version, setVersion] = useState(0)
  useEffect(() => {
    let active = true
    async function load() {
      // Keep the current list visible while refreshing after an add or delete.
      setResult((previous) => ({ data: previous.data, loading: !previous.data, error: '' }))
      try {
        const data = await api.calendarEvents({ startDate, endDate })
        if (active) setResult({ data, loading: false, error: '' })
      } catch (cause) {
        if (active)
          setResult({
            data: null,
            loading: false,
            error:
              cause.message || tr('课表暂时无法加载。', "The schedule can't be loaded right now."),
          })
      }
    }
    void load()
    return () => {
      active = false
    }
  }, [startDate, endDate, version])
  const reload = useCallback(() => setVersion((value) => value + 1), [])
  useEffect(() => {
    // Any form that adds a schedule (My Schedule, home card, mail notice) refreshes every list.
    window.addEventListener(SCHEDULE_CHANGED, reload)
    return () => window.removeEventListener(SCHEDULE_CHANGED, reload)
  }, [reload])
  return { ...result, reload }
}

export function shiftDate(iso, offset) {
  const date = new Date(`${iso}T12:00:00Z`)
  date.setUTCDate(date.getUTCDate() + offset)
  return date.toISOString().slice(0, 10)
}

export function eventTime(value) {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Hong_Kong',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(value))
}
