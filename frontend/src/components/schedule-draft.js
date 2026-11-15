// Helpers for the shared "add schedule" form. All dates and times are Hong Kong local.

export const SCHEDULE_CHANGED = 'hkmate:schedule-changed'

export const pad = (value) => String(value).padStart(2, '0')

function hongKongParts(value) {
  return Object.fromEntries(
    new Intl.DateTimeFormat('en-GB', {
      timeZone: 'Asia/Hong_Kong',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      hourCycle: 'h23',
    })
      .formatToParts(value)
      .map((part) => [part.type, part.value]),
  )
}

export function defaultDraft(now = new Date()) {
  const parts = hongKongParts(now)
  const start = Math.min(Number(parts.hour) + 1, 22)
  return {
    kind: 'event',
    title: '',
    date: `${parts.year}-${parts.month}-${parts.day}`,
    due_time: '23:59',
    start_time: `${pad(start)}:00`,
    end_time: `${pad(start + 1)}:00`,
    location: '',
  }
}

/** A form draft holding an existing item's values, in Hong Kong time. */
export function draftFromEvent(event) {
  const start = hongKongDateTime(event.starts_at)
  const end = hongKongDateTime(event.ends_at)
  const deadline = event.kind === 'deadline'
  return {
    kind: deadline ? 'deadline' : 'event',
    title: event.title,
    date: start.date,
    due_time: deadline ? start.time : '23:59',
    start_time: start.time,
    end_time: deadline ? plusOneHour(start.time) : end.time,
    location: event.location || '',
  }
}

function hongKongDateTime(value) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-GB', {
      timeZone: 'Asia/Hong_Kong',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    })
      .formatToParts(new Date(value))
      .map((part) => [part.type, part.value]),
  )
  return {
    date: `${parts.year}-${parts.month}-${parts.day}`,
    time: `${parts.hour}:${parts.minute}`,
  }
}

export function plusOneHour(time) {
  const [hour, minute] = time.split(':').map(Number)
  return hour >= 23 ? '23:59' : `${pad(hour + 1)}:${pad(minute)}`
}
