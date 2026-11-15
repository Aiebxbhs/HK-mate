// Time helpers shared by the live lecture page and saved lecture records.

const pad = (value) => String(value).padStart(2, '0')

/** 754 -> "12:34", 3754 -> "1:02:34". */
export function formatElapsed(totalSeconds) {
  const seconds = Math.max(0, Math.floor(totalSeconds))
  const hours = Math.floor(seconds / 3600)
  const minutes = Math.floor((seconds % 3600) / 60)
  const rest = seconds % 60
  return hours ? `${hours}:${pad(minutes)}:${pad(rest)}` : `${pad(minutes)}:${pad(rest)}`
}

/** Human duration: "2 小时 50 分钟", "35 分钟", "不到 1 分钟". */
export function formatDuration(totalSeconds) {
  const minutes = Math.floor(totalSeconds / 60)
  if (minutes < 1) return '不到 1 分钟'
  const hours = Math.floor(minutes / 60)
  const rest = minutes % 60
  if (!hours) return `${minutes} 分钟`
  return rest ? `${hours} 小时 ${rest} 分钟` : `${hours} 小时`
}

const clock = new Intl.DateTimeFormat('zh-CN', {
  timeZone: 'Asia/Hong_Kong',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
})
const dayParts = new Intl.DateTimeFormat('zh-CN', {
  timeZone: 'Asia/Hong_Kong',
  year: 'numeric',
  month: 'numeric',
  day: 'numeric',
  weekday: 'short',
})

export const hkClock = (value) => clock.format(new Date(value))
/** "11.14" (month.day) in Hong Kong time. */
export function hkShortDate(value) {
  const parts = Object.fromEntries(
    dayParts.formatToParts(new Date(value)).map((part) => [part.type, part.value]),
  )
  return `${parts.month}.${parts.day}`
}
/** "2026年11月19日 周四" in Hong Kong time. */
export function hkDate(value) {
  const parts = Object.fromEntries(
    dayParts.formatToParts(new Date(value)).map((part) => [part.type, part.value]),
  )
  return `${parts.year}年${parts.month}月${parts.day}日 ${parts.weekday}`
}
