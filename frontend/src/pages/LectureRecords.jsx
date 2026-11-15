import { useEffect, useState } from 'react'
import { api } from '../api/client'
import Icon from '../components/Icon'
import LectureSummaryView, { summaryMarkdown } from '../components/LectureSummaryView'
import Skeleton from '../components/Skeleton'
import { formatDuration, formatElapsed, hkClock, hkDate } from '../components/lecture-time'

export function lectureMarkdown(record) {
  const lines = [
    `# ${record.course_name}${record.course_code ? `（${record.course_code}）` : ''}`,
    '',
    `- 日期：${hkDate(record.started_at)} ${hkClock(record.started_at)}–${hkClock(record.ended_at)}（香港时间）`,
    `- 时长：${formatDuration(record.duration_seconds)}`,
  ]
  if (record.instructor) lines.push(`- 授课老师：${record.instructor}`)
  if (record.extra_info) lines.push('', '## 其他信息', '', record.extra_info)
  if (record.summary) lines.push('', ...summaryMarkdown(record.summary))
  lines.push('', '## 课堂笔记', '')
  if (record.notes.length) {
    for (const note of record.notes) {
      lines.push(`- [${formatElapsed(note.at_seconds)}]${note.important ? ' ★' : ''} ${note.text}`)
    }
  } else {
    lines.push('（无）')
  }
  if (record.transcript?.length) {
    lines.push('', '## 逐句转写', '')
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
      setError('请填写课程名称。')
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
      setNotice('已保存修改。')
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
    <section className="lecture-records" aria-label="课程记录详情">
      <button type="button" className="page-back lecture-records-back" onClick={onBack}>
        <Icon name="arrow" size={15} className="page-back-icon" />
        <span>全部课程记录</span>
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
        !error && <Skeleton label="正在读取课程记录…" rows={4} />
      ) : editing ? (
        <form className="agenda-card lecture-save" onSubmit={save} aria-label="编辑课程记录">
          <label>
            课程名称
            <input value={form.course_name} maxLength={100} onChange={update('course_name')} />
          </label>
          <label>
            其他信息
            <textarea
              rows={3}
              maxLength={2000}
              value={form.extra_info}
              onChange={update('extra_info')}
            />
          </label>
          <fieldset className="lecture-edit-notes">
            <legend>课堂笔记（清空内容即删除该条）</legend>
            {form.notes.map((note, index) => (
              <div key={index} className="lecture-edit-note">
                <span className="lecture-note-time">{formatElapsed(note.at_seconds)}</span>
                <textarea
                  aria-label={`笔记 ${formatElapsed(note.at_seconds)}`}
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
                  重点
                </label>
              </div>
            ))}
            {!form.notes.length && <p className="lecture-notes-empty">这节课没有保存笔记。</p>}
          </fieldset>
          <div className="schedule-form-actions">
            <button type="button" className="mail-secondary" onClick={() => setEditing(false)}>
              取消
            </button>
            <button type="submit" className="mail-primary" disabled={saving}>
              {saving ? '正在保存…' : '保存修改'}
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
          <section aria-label="AI 摘要">
            <h3>AI 摘要与重点</h3>
            {record.summary ? (
              <LectureSummaryView summary={record.summary} />
            ) : (
              <p className="lecture-notes-empty">
                这节课没有保存 AI 摘要（需要录音字幕，并在保存时勾选“AI 摘要与重点”）。
              </p>
            )}
          </section>
          <section aria-label="课堂笔记">
            <h3>课堂笔记（{record.notes.length} 条）</h3>
            {record.notes.length ? (
              <ol className="lecture-note-list">
                {record.notes.map((note, index) => (
                  <li
                    key={index}
                    className={`lecture-note${note.important ? ' is-important' : ''}`}
                  >
                    <span
                      className="lecture-note-time"
                      title={`香港时间 ${hkClock(
                        new Date(new Date(record.started_at).getTime() + note.at_seconds * 1000),
                      )}`}
                    >
                      {formatElapsed(note.at_seconds)}
                    </span>
                    <p className="lecture-note-text">
                      {note.important && <strong className="lecture-star">重点 </strong>}
                      {note.text}
                    </p>
                  </li>
                ))}
              </ol>
            ) : (
              <p className="lecture-notes-empty">这节课没有保存笔记。</p>
            )}
          </section>
          {record.transcript?.length > 0 && (
            <details className="lecture-transcript">
              <summary>逐句转写与译文（{record.transcript.length} 句）</summary>
              <ol className="lecture-caption-list">
                {record.transcript.map((line, index) => (
                  <li key={index} className="lecture-caption">
                    <span className="lecture-note-time">{formatElapsed(line.at_seconds)}</span>
                    <p className="lecture-caption-en" lang="en">
                      {line.en}
                    </p>
                    <p className="lecture-caption-zh" lang="zh-CN">
                      {line.zh || '（无译文）'}
                    </p>
                  </li>
                ))}
              </ol>
            </details>
          )}
          <div className="reply-actions lecture-record-actions">
            <button type="button" className="mail-secondary" onClick={startEditing}>
              <Icon name="pen" size={16} aria-hidden="true" />
              编辑
            </button>
            <button type="button" className="mail-secondary" onClick={() => download(record)}>
              导出 Markdown
            </button>
            {confirmDelete ? (
              <span className="schedule-confirm" role="group" aria-label="确认删除课程记录">
                <span>删除后无法恢复，确定吗？</span>
                <button type="button" className="danger-text" onClick={remove} disabled={saving}>
                  删除
                </button>
                <button type="button" onClick={() => setConfirmDelete(false)}>
                  取消
                </button>
              </span>
            ) : (
              <button
                type="button"
                className="schedule-delete"
                onClick={() => setConfirmDelete(true)}
              >
                <Icon name="trash" size={15} aria-hidden="true" />
                删除
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
          setNotice('课程记录已删除。')
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
    <section className="lecture-records" aria-label="课程记录">
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
        <Skeleton label="正在读取课程记录…" rows={4} />
      ) : groups.length ? (
        groups.map((group) => (
          <section key={group.name} className="agenda-card" aria-label={group.name}>
            <h2 className="lecture-group-title">
              <span>{group.name}</span>
              <span className="lecture-group-count">{group.items.length} 节</span>
            </h2>
            <ul className="lecture-record-list">
              {group.items.map((item) => (
                <li key={item.id}>
                  <button type="button" onClick={() => setOpenId(item.id)}>
                    <span className="lecture-record-date">{hkDate(item.started_at)}</span>
                    <span className="lecture-record-meta">
                      {[
                        formatDuration(item.duration_seconds),
                        `${item.note_count} 条笔记`,
                        item.important_count > 0 && `${item.important_count} 条重点`,
                        item.has_summary && '有 AI 摘要',
                      ]
                        .filter(Boolean)
                        .join('，')}
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
          <p>还没有保存的课程记录。在“实时翻译”中开始一节课，下课时选择保存即可。</p>
          <button type="button" className="mail-primary" onClick={onStart}>
            去开始一节课
          </button>
        </div>
      )}
    </section>
  )
}
