import { useEffect, useRef, useState } from 'react'
import { api } from '../api/client'
import { SCHEDULE_CHANGED, defaultDraft, draftFromEvent, plusOneHour } from './schedule-draft'
import { tr } from '../i18n'

/** The one schedule form used by My Schedule, the home card and mail notices. With `event`
 * (one of the user's own items) it edits that item instead of adding a new one. */
export default function ScheduleForm({
  event: editing = null,
  heading = editing ? tr('编辑日程', 'Edit event') : tr('新日程', 'New event'),
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
      setError(tr('请填写日程标题。', 'Please enter a title.'))
      titleInput.current?.focus()
      return
    }
    const deadline = draft.kind === 'deadline'
    if (!deadline && draft.end_time <= draft.start_time) {
      setError(tr('结束时间需要晚于开始时间。', 'The end time must be after the start time.'))
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
    <form
      className={className}
      onSubmit={submit}
      aria-label={editing ? tr('编辑日程', 'Edit event') : tr('添加日程', 'Add event')}
    >
      {heading && <h2 className="schedule-form-title">{heading}</h2>}
      <div className="schedule-kind" role="radiogroup" aria-label={tr('日程类型', 'Event type')}>
        {[
          [
            'event',
            tr('活动', 'Event'),
            tr('开会、上课等，有开始和结束时间', 'Meetings, classes: with a start and end time'),
          ],
          [
            'deadline',
            tr('截止事项', 'Deadline'),
            tr('作业 DDL 等，显示剩余时间进度条', 'Assignments and the like, with a countdown bar'),
          ],
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
        {tr('标题', 'Title')}
        <input
          ref={titleInput}
          data-autofocus
          value={draft.title}
          maxLength={200}
          placeholder={tr('例如：小组讨论、Office hour', 'e.g. Group discussion, Office hour')}
          onChange={(event) => update('title', event.target.value)}
        />
      </label>
      <div className="schedule-form-row">
        <label>
          {tr('日期', 'Date')}
          <input
            type="date"
            required
            value={draft.date}
            onChange={(event) => update('date', event.target.value)}
          />
        </label>
        {draft.kind === 'deadline' ? (
          <label className="schedule-due">
            {tr('截止时间', 'Due')}
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
              {tr('开始', 'Start')}
              <input
                type="time"
                required
                value={draft.start_time}
                onChange={(event) => update('start_time', event.target.value)}
              />
            </label>
            <label>
              {tr('结束', 'End')}
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
        {tr('地点（可选）', 'Location (optional)')}
        <input
          value={draft.location}
          maxLength={200}
          placeholder={tr('例如：Main Library 3F', 'e.g. Main Library 3F')}
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
          {tr('取消', 'Cancel')}
        </button>
        <button type="submit" className="mail-primary" disabled={saving}>
          {saving
            ? tr('正在保存…', 'Saving…')
            : editing
              ? tr('保存修改', 'Save changes')
              : tr('保存日程', 'Save event')}
        </button>
      </div>
    </form>
  )
}
