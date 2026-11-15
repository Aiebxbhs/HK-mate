import { useEffect, useRef, useState } from 'react'
import { api } from '../api/client'
import { SCHEDULE_CHANGED, defaultDraft, draftFromEvent, plusOneHour } from './schedule-draft'

/** The one schedule form used by My Schedule, the home card and mail notices. With `event`
 * (one of the user's own items) it edits that item instead of adding a new one. */
export default function ScheduleForm({
  event: editing = null,
  heading = editing ? '编辑日程' : '新日程',
  onSaved,
  onCancel,
  className = 'agenda-card schedule-form',
}) {
  const [draft, setDraft] = useState(() => (editing ? draftFromEvent(editing) : defaultDraft()))
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const titleInput = useRef(null)

  useEffect(() => {
    titleInput.current?.focus()
  }, [])

  function update(field, value) {
    setDraft((current) => {
      const next = { ...current, [field]: value }
      if (field === 'start_time' && /^\d{2}:\d{2}$/.test(value) && next.end_time <= value) {
        next.end_time = plusOneHour(value)
      }
      return next
    })
  }

  async function submit(event) {
    event.preventDefault()
    if (!draft.title.trim()) {
      setError('请填写日程标题。')
      titleInput.current?.focus()
      return
    }
    const deadline = draft.kind === 'deadline'
    if (!deadline && draft.end_time <= draft.start_time) {
      setError('结束时间需要晚于开始时间。')
      return
    }
    const payload = deadline
      ? {
          kind: 'deadline',
          title: draft.title.trim(),
          date: draft.date,
          start_time: draft.due_time,
          location: draft.location,
        }
      : {
          kind: 'event',
          title: draft.title.trim(),
          date: draft.date,
          start_time: draft.start_time,
          end_time: draft.end_time,
          location: draft.location,
        }
    setSaving(true)
    setError('')
    try {
      const saved = editing
        ? await api.updateCalendarEvent(editing.id, payload)
        : await api.createCalendarEvent(payload)
      window.dispatchEvent(new Event(SCHEDULE_CHANGED))
      onSaved(saved)
    } catch (cause) {
      setError(cause.message)
      setSaving(false)
    }
  }

  return (
    <form className={className} onSubmit={submit} aria-label={editing ? '编辑日程' : '添加日程'}>
      {heading && <h2 className="schedule-form-title">{heading}</h2>}
      <div className="schedule-kind" role="radiogroup" aria-label="日程类型">
        {[
          ['event', '活动', '开会、上课等，有开始和结束时间'],
          ['deadline', '截止事项', '作业 DDL 等，显示剩余时间进度条'],
        ].map(([value, label, hint]) => (
          <label key={value} className={draft.kind === value ? 'is-selected' : ''} title={hint}>
            <input
              type="radio"
              name="schedule-kind"
              value={value}
              checked={draft.kind === value}
              onChange={() => update('kind', value)}
            />
            {label}
          </label>
        ))}
      </div>
      <label>
        标题
        <input
          ref={titleInput}
          data-autofocus
          value={draft.title}
          maxLength={200}
          placeholder="例如：小组讨论、Office hour"
          onChange={(event) => update('title', event.target.value)}
        />
      </label>
      <div className="schedule-form-row">
        <label>
          日期
          <input
            type="date"
            required
            value={draft.date}
            onChange={(event) => update('date', event.target.value)}
          />
        </label>
        {draft.kind === 'deadline' ? (
          <label className="schedule-due">
            截止时间
            <input
              type="time"
              required
              value={draft.due_time}
              onChange={(event) => update('due_time', event.target.value)}
            />
          </label>
        ) : (
          <>
            <label>
              开始
              <input
                type="time"
                required
                value={draft.start_time}
                onChange={(event) => update('start_time', event.target.value)}
              />
            </label>
            <label>
              结束
              <input
                type="time"
                required
                value={draft.end_time}
                onChange={(event) => update('end_time', event.target.value)}
              />
            </label>
          </>
        )}
      </div>
      <label>
        地点（可选）
        <input
          value={draft.location}
          maxLength={200}
          placeholder="例如：Main Library 3F"
          onChange={(event) => update('location', event.target.value)}
        />
      </label>
      {error && (
        <p className="message error" role="alert">
          {error}
        </p>
      )}
      <div className="schedule-form-actions">
        <button type="button" className="mail-secondary" onClick={onCancel} disabled={saving}>
          取消
        </button>
        <button type="submit" className="mail-primary" disabled={saving}>
          {saving ? '正在保存…' : editing ? '保存修改' : '保存日程'}
        </button>
      </div>
    </form>
  )
}
