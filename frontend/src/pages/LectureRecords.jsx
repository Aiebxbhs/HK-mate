import { useEffect, useState } from 'react'
import { api } from '../api/client'
import Icon from '../components/Icon'
import LectureSummaryView, { summaryMarkdown } from '../components/LectureSummaryView'
import Skeleton from '../components/Skeleton'
import { formatDuration, formatElapsed, hkClock, hkDate } from '../components/lecture-time'
import { tr } from '../i18n'

export function lectureMarkdown(record) {
  const lines = [
    `# ${record.course_name}${record.course_code ? tr(`（${record.course_code}）`, ` (${record.course_code})`) : ''}`,
    '',
    tr(
      `- 日期：${hkDate(record.started_at)} ${hkClock(record.started_at)}–${hkClock(record.ended_at)}（香港时间）`,
      `- Date: ${hkDate(record.started_at)} ${hkClock(record.started_at)}–${hkClock(record.ended_at)} (Hong Kong time)`,
    ),
    tr(
      `- 时长：${formatDuration(record.duration_seconds)}`,
      `- Length: ${formatDuration(record.duration_seconds)}`,
    ),
  ]
  if (record.instructor)
    lines.push(tr(`- 授课老师：${record.instructor}`, `- Instructor: ${record.instructor}`))
  if (record.extra_info)
    lines.push('', tr('## 其他信息', '## Other information'), '', record.extra_info)
  if (record.summary) lines.push('', ...summaryMarkdown(record.summary))
  lines.push('', tr('## 课堂笔记', '## Notes'), '')
  if (record.notes.length) {
    for (const note of record.notes) {
      lines.push(`- [${formatElapsed(note.at_seconds)}]${note.important ? ' ★' : ''} ${note.text}`)
    }
  } else {
    lines.push(tr('（无）', '(None)'))
  }
  if (record.transcript?.length) {
    lines.push('', tr('## 逐句转写', '## Transcript'), '')
    for (const line of record.transcript) {
      lines.push(`- [${formatElapsed(line.at_seconds)}] ${line.en}`)
      if (line.zh) lines.push(`  ${line.zh}`)
    }
  }
  return `${lines.join('\n')}\n`
}

function download(record) {
  const blob = new Blob([lectureMarkdown(record)], { type: 'text/markdown;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = `${record.course_name}-${record.started_at.slice(0, 10)}.md`.replace(
    /[\\/:*?"<>|]/g,
    '_',
  )
  link.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

function RecordDetail({ id, onBack, onDeleted }) {
  const [record, setRecord] = useState(null)
  const [error, setError] = useState('')
  const [editing, setEditing] = useState(false)
  const [form, setForm] = useState(null)
  const [saving, setSaving] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [notice, setNotice] = useState('')

  useEffect(() => {
    let active = true
    api
      .lectureRecord(id)
      .then((value) => {
        if (active) setRecord(value)
      })
      .catch((cause) => {
        if (active) setError(cause.message)
      })
    return () => {
      active = false
    }
  }, [id])

  function startEditing() {
    setForm({
      course_name: record.course_name,
      extra_info: record.extra_info,
      notes: record.notes.map((note) => ({ ...note })),
    })
    setEditing(true)
    setNotice('')
  }

  async function save(event) {
    event.preventDefault()
    if (!form.course_name.trim()) {
      setError(tr('请填写课程名称。', 'Please enter the course name.'))
      return
    }
    setSaving(true)
    setError('')
    try {
      const notes = form.notes
        .filter((note) => note.text.trim())
        .map((note) => ({ ...note, text: note.text.trim() }))
      setRecord(await api.updateLectureRecord(id, { ...form, notes }))
      setEditing(false)
      setNotice(tr('已保存修改。', 'Changes saved.'))
    } catch (cause) {
      setError(cause.message)
    } finally {
      setSaving(false)
    }
  }

  async function remove() {
    setSaving(true)
    try {
      await api.deleteLectureRecord(id)
      onDeleted()
    } catch (cause) {
      setError(cause.message)
      setSaving(false)
    }
  }

  const update = (field) => (event) => setForm({ ...form, [field]: event.target.value })
  const updateNote = (index, changes) =>
    setForm({
      ...form,
      notes: form.notes.map((note, i) => (i === index ? { ...note, ...changes } : note)),
    })

  return (
    <section className="lecture-records" aria-label={tr('课程记录详情', 'Lecture record')}>
      <button type="button" className="page-back lecture-records-back" onClick={onBack}>
        <Icon name="arrow" size={15} className="page-back-icon" />
        <span>{tr('全部课程记录', 'All lecture records')}</span>
      </button>
      {error && (
        <p className="message error" role="alert">
          {error}
        </p>
      )}
      {notice && (
        <p className="message success" role="status">
          {notice}
        </p>
      )}
      {!record ? (
        !error && <Skeleton label={tr('正在读取课程记录…', 'Loading lecture records…')} rows={4} />
      ) : editing ? (
        <form
          className="agenda-card lecture-save"
          onSubmit={save}
          aria-label={tr('编辑课程记录', 'Edit lecture record')}
        >
          <label>
            {tr('课程名称', 'Course name')}
            <input value={form.course_name} maxLength={100} onChange={update('course_name')} />
          </label>
          <label>
            {tr('其他信息', 'Other information')}
            <textarea
              rows={3}
              maxLength={2000}
              value={form.extra_info}
              onChange={update('extra_info')}
            />
          </label>
          <fieldset className="lecture-edit-notes">
            <legend>
              {tr('课堂笔记（清空内容即删除该条）', 'Notes (clear a note to delete it)')}
            </legend>
            {form.notes.map((note, index) => (
              <div key={index} className="lecture-edit-note">
                <span className="lecture-note-time">{formatElapsed(note.at_seconds)}</span>
                <textarea
                  aria-label={tr(
                    `笔记 ${formatElapsed(note.at_seconds)}`,
                    `Note at ${formatElapsed(note.at_seconds)}`,
                  )}
                  rows={2}
                  maxLength={2000}
                  value={note.text}
                  onChange={(event) => updateNote(index, { text: event.target.value })}
                />
                <label className="lecture-edit-important">
                  <input
                    type="checkbox"
                    checked={note.important}
                    onChange={(event) => updateNote(index, { important: event.target.checked })}
                  />
                  {tr('重点', 'Key')}
                </label>
              </div>
            ))}
            {!form.notes.length && (
              <p className="lecture-notes-empty">
                {tr('这节课没有保存笔记。', 'No notes were saved for this lecture.')}
              </p>
            )}
          </fieldset>
          <div className="schedule-form-actions">
            <button type="button" className="mail-secondary" onClick={() => setEditing(false)}>
              {tr('取消', 'Cancel')}
            </button>
            <button type="submit" className="mail-primary" disabled={saving}>
              {saving ? tr('正在保存…', 'Saving…') : tr('保存修改', 'Save changes')}
            </button>
          </div>
        </form>
      ) : (
        <article className="agenda-card lecture-record-detail" aria-label={record.course_name}>
          <header>
            {record.course_code && (
              <span className="lecture-record-code">{record.course_code}</span>
            )}
            <h2>{record.course_name}</h2>
            <p>
              {[
                hkDate(record.started_at),
                `${hkClock(record.started_at)}–${hkClock(record.ended_at)}`,
                formatDuration(record.duration_seconds),
                record.instructor,
              ]
                .filter(Boolean)
                .join('，')}
            </p>
          </header>
          {record.extra_info && <p className="lecture-record-extra">{record.extra_info}</p>}
          <section aria-label={tr('AI 摘要', 'AI summary')}>
            <h3>{tr('AI 摘要与重点', 'AI summary and key points')}</h3>
            {record.summary ? (
              <LectureSummaryView summary={record.summary} />
            ) : (
              <p className="lecture-notes-empty">
                {tr(
                  '这节课没有保存 AI 摘要（需要录音字幕，并在保存时勾选“AI 摘要与重点”）。',
                  'No AI summary was saved for this lecture (it needs recorded captions and “AI summary and key points” ticked when saving).',
                )}
              </p>
            )}
          </section>
          <section aria-label={tr('课堂笔记', 'Notes')}>
            <h3>{tr(`课堂笔记（${record.notes.length} 条）`, `Notes (${record.notes.length})`)}</h3>
            {record.notes.length ? (
              <ol className="lecture-note-list">
                {record.notes.map((note, index) => (
                  <li
                    key={index}
                    className={`lecture-note${note.important ? ' is-important' : ''}`}
                  >
                    <span
                      className="lecture-note-time"
                      title={
                        tr('香港时间 ', 'Hong Kong time ') +
                        hkClock(
                          new Date(new Date(record.started_at).getTime() + note.at_seconds * 1000),
                        )
                      }
                    >
                      {formatElapsed(note.at_seconds)}
                    </span>
                    <p className="lecture-note-text">
                      {note.important && (
                        <strong className="lecture-star">{tr('重点 ', 'Key ')}</strong>
                      )}
                      {note.text}
                    </p>
                  </li>
                ))}
              </ol>
            ) : (
              <p className="lecture-notes-empty">
                {tr('这节课没有保存笔记。', 'No notes were saved for this lecture.')}
              </p>
            )}
          </section>
          {record.transcript?.length > 0 && (
            <details className="lecture-transcript">
              <summary>
                {tr(
                  `逐句转写与译文（${record.transcript.length} 句）`,
                  `Transcript and translation (${record.transcript.length} lines)`,
                )}
              </summary>
              <ol className="lecture-caption-list">
                {record.transcript.map((line, index) => (
                  <li key={index} className="lecture-caption">
                    <span className="lecture-note-time">{formatElapsed(line.at_seconds)}</span>
                    <p className="lecture-caption-en" lang="en">
                      {line.en}
                    </p>
                    <p className="lecture-caption-zh" lang="zh-CN">
                      {line.zh || tr('（无译文）', '(No translation)')}
                    </p>
                  </li>
                ))}
              </ol>
            </details>
          )}
          <div className="reply-actions lecture-record-actions">
            <button type="button" className="mail-secondary" onClick={startEditing}>
              <Icon name="pen" size={16} aria-hidden="true" />
              {tr('编辑', 'Edit')}
            </button>
            <button type="button" className="mail-secondary" onClick={() => download(record)}>
              {tr('导出 Markdown', 'Export Markdown')}
            </button>
            {confirmDelete ? (
              <span
                className="schedule-confirm"
                role="group"
                aria-label={tr('确认删除课程记录', 'Confirm deleting the record')}
              >
                <span>{tr('删除后无法恢复，确定吗？', "This can't be undone. Delete it?")}</span>
                <button type="button" className="danger-text" onClick={remove} disabled={saving}>
                  {tr('删除', 'Delete')}
                </button>
                <button type="button" onClick={() => setConfirmDelete(false)}>
                  {tr('取消', 'Cancel')}
                </button>
              </span>
            ) : (
              <button
                type="button"
                className="schedule-delete"
                onClick={() => setConfirmDelete(true)}
              >
                <Icon name="trash" size={15} aria-hidden="true" />
                {tr('删除', 'Delete')}
              </button>
            )}
          </div>
        </article>
      )}
    </section>
  )
}

export default function LectureRecords({ onStart }) {
  const [data, setData] = useState(null)
  const [error, setError] = useState('')
  const [openId, setOpenId] = useState(null)
  const [reload, setReload] = useState(0)
  const [notice, setNotice] = useState('')

  useEffect(() => {
    let active = true
    api
      .lectureRecords()
      .then((value) => {
        if (active) setData(value)
      })
      .catch((cause) => {
        if (active) setError(cause.message)
      })
    return () => {
      active = false
    }
  }, [reload])

  if (openId) {
    return (
      <RecordDetail
        id={openId}
        onBack={() => {
          setOpenId(null)
          setReload((value) => value + 1)
        }}
        onDeleted={() => {
          setOpenId(null)
          setNotice(tr('课程记录已删除。', 'Lecture record deleted.'))
          setReload((value) => value + 1)
        }}
      />
    )
  }

  const groups = []
  for (const item of data?.items || []) {
    let group = groups.find((entry) => entry.name === item.course_name)
    if (!group) {
      group = { name: item.course_name, items: [] }
      groups.push(group)
    }
    group.items.push(item)
  }

  return (
    <section className="lecture-records" aria-label={tr('课程记录', 'Lecture records')}>
      {notice && (
        <p className="message success" role="status">
          {notice}
        </p>
      )}
      {error ? (
        <p className="message error" role="alert">
          {error}
        </p>
      ) : !data ? (
        <Skeleton label={tr('正在读取课程记录…', 'Loading lecture records…')} rows={4} />
      ) : groups.length ? (
        groups.map((group) => (
          <section key={group.name} className="agenda-card" aria-label={group.name}>
            <h2 className="lecture-group-title">
              <span>{group.name}</span>
              <span className="lecture-group-count">
                {tr(
                  `${group.items.length} 节`,
                  `${group.items.length} ${group.items.length === 1 ? 'lecture' : 'lectures'}`,
                )}
              </span>
            </h2>
            <ul className="lecture-record-list">
              {group.items.map((item) => (
                <li key={item.id}>
                  <button type="button" onClick={() => setOpenId(item.id)}>
                    <span className="lecture-record-date">{hkDate(item.started_at)}</span>
                    <span className="lecture-record-meta">
                      {[
                        formatDuration(item.duration_seconds),
                        tr(`${item.note_count} 条笔记`, `${item.note_count} notes`),
                        item.important_count > 0 &&
                          tr(`${item.important_count} 条重点`, `${item.important_count} key`),
                        item.has_summary && tr('有 AI 摘要', 'AI summary'),
                      ]
                        .filter(Boolean)
                        .join(tr('，', ', '))}
                    </span>
                    <Icon name="arrow" size={15} aria-hidden="true" />
                  </button>
                </li>
              ))}
            </ul>
          </section>
        ))
      ) : (
        <div className="agenda-card agenda-empty lecture-records-empty">
          <Icon name="book" size={22} aria-hidden="true" />
          <p>
            {tr(
              '还没有保存的课程记录。在“实时翻译”中开始一节课，下课时选择保存即可。',
              'No saved lecture records yet. Start a lecture in Live translation and save it when class ends.',
            )}
          </p>
          <button type="button" className="mail-primary" onClick={onStart}>
            {tr('去开始一节课', 'Start a lecture')}
          </button>
        </div>
      )}
    </section>
  )
}
