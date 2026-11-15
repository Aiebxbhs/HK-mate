const DAY = 86_400_000
// The bar starts filling two weeks before the deadline and is full when it is due.
const WINDOW_DAYS = 14

// Recomputed on every render from the due time, so the bar grows on its own as the
// deadline approaches. Lower bounds are inclusive.
const LEVELS = [
  { minDays: 7, tone: 'calm', name: '充裕' },
  { minDays: 3, tone: 'calm', name: '注意' },
  { minDays: 0, tone: 'soon', name: '临近' },
]

export function deadlineLevel(due, now = new Date()) {
  const left = new Date(due).getTime() - now.getTime()
  if (left <= 0) return { percent: 100, tone: 'overdue', name: '已过期', left }
  const days = left / DAY
  // Never fully empty, so even a far deadline shows a sliver of progress.
  const percent = Math.round(Math.min(100, Math.max(4, (1 - days / WINDOW_DAYS) * 100)))
  return { ...LEVELS.find((level) => days >= level.minDays), percent, left }
}

export function remainingLabel(left) {
  if (left <= 0) return '已过期'
  const days = Math.floor(left / DAY)
  if (days >= 1) return `还剩 ${days} 天`
  const hours = Math.floor(left / 3_600_000)
  if (hours >= 1) return `还剩 ${hours} 小时`
  return `还剩 ${Math.max(1, Math.ceil(left / 60_000))} 分钟`
}

export default function DeadlineBar({ due, now }) {
  const level = deadlineLevel(due, now)
  const label = remainingLabel(level.left)
  return (
    <div
      className={`deadline-bar tone-${level.tone}`}
      role="meter"
      aria-label={`截止进度：${level.name}，${label}`}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={level.percent}
    >
      <span className="deadline-track" aria-hidden="true">
        <span className="deadline-fill" style={{ width: `${level.percent}%` }} />
      </span>
      <span className="deadline-label">{label}</span>
    </div>
  )
}
