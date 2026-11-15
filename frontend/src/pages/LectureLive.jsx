import { useEffect, useRef, useState } from 'react'
import { api } from '../api/client'
import Icon from '../components/Icon'
import LectureSummaryView from '../components/LectureSummaryView'
import { startLectureStream } from '../components/lecture-stream'
import { formatDuration, formatElapsed, hkClock } from '../components/lecture-time'

// In-progress lectures are kept only in this browser (per account) until the user saves or
// discards them, so a refresh or an accidental close does not lose notes.
const draftKey = (userId) => `hkmate.lecture.draft.${userId}`

const consentKey = (userId) => `hkmate.lecture.consent.${userId}`

function readDraft(userId) {
  try {
    const value = JSON.parse(localStorage.getItem(draftKey(userId)) || 'null')
    if (!value?.startedAt) return null
    const captions = (value.captions || []).map((caption) =>
      caption.status === 'pending' ? { ...caption, status: 'failed' } : caption,
    )
    // A segment left open by a closed tab ends where its last caption ended.
    const segments = (value.segments || []).map((segment) => {
      if (segment.endedAt) return segment
      const last = captions.filter((caption) => caption.segment === segment.index).at(-1)
      const end = last
        ? Date.parse(value.startedAt) + (last.at_seconds + last.duration) * 1000
        : Date.parse(segment.startedAt)
      return { ...segment, endedAt: new Date(end).toISOString() }
    })
    return { notes: [], ...value, captions, segments }
  } catch {
    return null
  }
}

function hasConsent(userId) {
  try {
    return localStorage.getItem(consentKey(userId)) === '1'
  } catch {
    return false
  }
}

function recordedSeconds(segments, now = Date.now()) {
  return segments.reduce(
    (total, segment) =>
      total +
      ((segment.endedAt ? Date.parse(segment.endedAt) : now) - Date.parse(segment.startedAt)) /
        1000,
    0,
  )
}

function writeDraft(userId, draft) {
  try {
    if (draft) localStorage.setItem(draftKey(userId), JSON.stringify(draft))
    else localStorage.removeItem(draftKey(userId))
  } catch {
    // Local recovery is a convenience; the lecture still works without it.
  }
}

let noteSeq = 0
const newNoteId = () => `n${Date.now().toString(36)}${(noteSeq += 1)}`

function NoteItem({ note, startedAt, onChange, onDelete }) {
  const [editing, setEditing] = useState(false)
  const [text, setText] = useState(note.text)
  const at = new Date(new Date(startedAt).getTime() + note.at_seconds * 1000)
  return (
    <li className={`lecture-note${note.important ? ' is-important' : ''}`}>
      <span className="lecture-note-time" title={`香港时间 ${hkClock(at)}`}>
        {formatElapsed(note.at_seconds)}
      </span>
      {editing ? (
        <form
          className="lecture-note-edit"
          onSubmit={(event) => {
            event.preventDefault()
            if (text.trim()) onChange({ ...note, text: text.trim() })
            setEditing(false)
          }}
        >
          <textarea
            aria-label="编辑笔记"
            rows={2}
            value={text}
            maxLength={2000}
            onChange={(event) => setText(event.target.value)}
          />
          <button type="submit" className="mail-secondary">
            完成
          </button>
        </form>
      ) : (
        <p className="lecture-note-text">{note.text}</p>
      )}
      <div className="lecture-note-actions">
        <button
          type="button"
          aria-pressed={note.important}
          aria-label={note.important ? '取消重点' : '标为重点'}
          onClick={() => onChange({ ...note, important: !note.important })}
        >
          {note.important ? '重点' : '标为重点'}
        </button>
        {!editing && (
          <button type="button" onClick={() => setEditing(true)}>
            编辑
          </button>
        )}
        <button type="button" className="danger-text" onClick={onDelete}>
          删除
        </button>
      </div>
    </li>
  )
}

// Rough local estimate shown while generating: ~35 s per 2,500-word part plus the final merge.
export function summaryEstimate(captions) {
  const words = captions.reduce((total, caption) => total + caption.en.split(/\s+/).length, 0)
  const seconds = Math.ceil(words / 2500) * 35 + 25
  return seconds < 90 ? '不到 1 分钟' : `约 ${Math.round(seconds / 60)} 分钟`
}

/**
 * Generates the after-class summary once the last caption is done. The result is kept in the
 * local draft (so a refresh does not regenerate it) and is only saved if the user keeps it.
 */
function useLectureSummary({ captions, notes, busy, stored, onStored, onKeep }) {
  const [failure, setFailure] = useState(null)
  const [regenerating, setRegenerating] = useState(false)
  const mounted = useRef(true)
  const startedFor = useRef(null)
  const fresh = stored && stored.lineCount === captions.length ? stored.summary : null
  const canGenerate = captions.length > 0 && !busy

  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
    }
  }, [])

  function request() {
    const lineCount = captions.length
    api
      .lectureSummary({
        lines: captions.map(({ at_seconds, en }) => ({ at_seconds, en })),
        notes: notes.map(({ at_seconds, text, important }) => ({ at_seconds, text, important })),
      })
      .then(
        (summary) => {
          if (!mounted.current) return
          onStored({ lineCount, summary })
          onKeep(true)
          setFailure(null)
          setRegenerating(false)
        },
        (cause) => {
          if (!mounted.current) return
          setFailure({ lineCount, message: cause.message })
          setRegenerating(false)
        },
      )
  }

  // Starts once per set of captions; a stored summary for the same captions is reused.
  useEffect(() => {
    if (!canGenerate || fresh || startedFor.current === captions.length) return
    startedFor.current = captions.length
    request()
    // request() reads the latest props when it runs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canGenerate, fresh, captions.length])

  function retry() {
    setFailure(null)
    setRegenerating(true)
    request()
  }

  const failed = failure && failure.lineCount === captions.length
  const generating = regenerating || (canGenerate && !fresh && !failed)
  return { fresh, generating, failed, failure, retry }
}

function SummaryOption({ captions, summary, keep, onKeep }) {
  const { fresh, generating, failed, failure, retry } = summary
  return (
    <div className="lecture-summary-option">
      <div className="lecture-summary-option-row">
        <label className={fresh ? '' : 'is-unavailable'}>
          <input
            type="checkbox"
            checked={Boolean(fresh) && keep}
            disabled={!fresh}
            onChange={(event) => onKeep(event.target.checked)}
          />
          AI 摘要与重点
        </label>
        {fresh && (
          <button type="button" className="text-button" disabled={generating} onClick={retry}>
            重新生成
          </button>
        )}
      </div>
      {!captions.length && (
        <p className="reply-status" role="status">
          这节课没有录音字幕，无法生成 AI 摘要。
        </p>
      )}
      {failed && !generating && (
        <p className="message error" role="alert">
          摘要生成失败：{failure.message}
          <button type="button" className="text-button" onClick={retry}>
            重试
          </button>
          仍可只保存笔记。
        </p>
      )}
      {fresh && !generating && <LectureSummaryView summary={fresh} />}
    </div>
  )
}

function SaveForm({ draft, courseNames, busy, onSummary, onBack, onSaved, onDiscard }) {
  const [info, setInfo] = useState({
    course_name: '',
    extra_info: '',
  })
  const [keepNotes, setKeepNotes] = useState(true)
  const [keepTranscript, setKeepTranscript] = useState(false)
  const [keepSummary, setKeepSummary] = useState(true)
  const captions = draft.captions.filter((caption) => caption.en)
  const summaryState = useLectureSummary({
    captions,
    notes: draft.notes,
    busy,
    stored: draft.summary,
    onStored: onSummary,
    onKeep: setKeepSummary,
  })
  const summary = summaryState.fresh
  const waitingForSummary = captions.length > 0 && (busy || summaryState.generating)
  const [saving, setSaving] = useState(false)
  const [confirmDiscard, setConfirmDiscard] = useState(false)
  const [error, setError] = useState('')
  const duration = (new Date(draft.endedAt) - new Date(draft.startedAt)) / 1000

  async function save(event) {
    event.preventDefault()
    if (!info.course_name.trim()) {
      setError('请填写课程名称。')
      return
    }
    setSaving(true)
    setError('')
    try {
      const record = await api.createLectureRecord({
        ...info,
        course_name: info.course_name.trim(),
        started_at: draft.startedAt,
        ended_at: draft.endedAt,
        recorded_seconds: Math.min(
          Math.round(recordedSeconds(draft.segments)),
          Math.floor(duration),
        ),
        summary: keepSummary && summary ? summary : null,
        transcript: keepTranscript
          ? captions.map(({ at_seconds, en, zh }) => ({ at_seconds, en, zh: zh || null }))
          : null,
        notes: keepNotes
          ? draft.notes.map(({ at_seconds, text, important }) => ({ at_seconds, text, important }))
          : [],
      })
      onSaved(record)
    } catch (cause) {
      setError(cause.message)
      setSaving(false)
    }
  }

  const update = (field) => (event) => setInfo({ ...info, [field]: event.target.value })
  return (
    <form className="agenda-card lecture-save" onSubmit={save} aria-label="保存课程">
      <h2 className="schedule-form-title">课程已结束</h2>
      <p className="lecture-save-meta">
        {hkClock(draft.startedAt)}–{hkClock(draft.endedAt)}，时长 {formatDuration(duration)}，
        {draft.notes.length} 条笔记，录音 {formatDuration(recordedSeconds(draft.segments))}
      </p>
      {waitingForSummary && (
        <p className="lecture-summary-banner" role="status">
          <span className="lecture-summary-spinner" aria-hidden="true" />
          AI 课程摘要正在生成，请稍等（
          {busy ? '正在处理最后一句字幕' : `预计${summaryEstimate(captions)}`}
          ）。可以先填写下面的课程信息。
        </p>
      )}
      <label>
        课程名称（必填）
        <input
          list="lecture-course-names"
          value={info.course_name}
          maxLength={100}
          placeholder="例如：Deep Learning"
          onChange={update('course_name')}
        />
        <datalist id="lecture-course-names">
          {courseNames.map((name) => (
            <option key={name} value={name} />
          ))}
        </datalist>
      </label>
      <label>
        其他信息（可选）
        <textarea
          rows={3}
          maxLength={2000}
          value={info.extra_info}
          placeholder="例如：第 9 周、本节主题、要复习的章节…"
          onChange={update('extra_info')}
        />
      </label>
      <fieldset className="lecture-save-options">
        <legend>保存哪些内容</legend>
        <label>
          <input
            type="checkbox"
            checked={keepNotes}
            onChange={(event) => setKeepNotes(event.target.checked)}
          />
          我的笔记（{draft.notes.length} 条）
        </label>
        <SummaryOption
          captions={captions}
          summary={summaryState}
          keep={keepSummary}
          onKeep={setKeepSummary}
        />
        <label className={captions.length ? '' : 'is-unavailable'}>
          <input
            type="checkbox"
            checked={keepTranscript}
            disabled={!captions.length}
            onChange={(event) => setKeepTranscript(event.target.checked)}
          />
          逐句转写与译文（{captions.length} 句）
        </label>
      </fieldset>
      {error && (
        <p className="message error" role="alert">
          {error}
        </p>
      )}
      <div className="schedule-form-actions lecture-save-actions">
        {confirmDiscard ? (
          <span className="schedule-confirm" role="group" aria-label="确认丢弃本节课">
            <span>丢弃后笔记无法恢复，确定吗？</span>
            <button type="button" className="danger-text" onClick={onDiscard}>
              丢弃
            </button>
            <button type="button" onClick={() => setConfirmDiscard(false)}>
              取消
            </button>
          </span>
        ) : (
          <button
            type="button"
            className="mail-preview-ignore"
            onClick={() => setConfirmDiscard(true)}
          >
            不保存，丢弃
          </button>
        )}
        <button type="button" className="mail-secondary" onClick={onBack} disabled={saving}>
          返回课程
        </button>
        <button type="submit" className="mail-primary" disabled={saving}>
          {saving ? '正在保存…' : '保存到课程记录'}
        </button>
      </div>
    </form>
  )
}

const STATE_LABELS = {
  off: '未在录音',
  connecting: '正在连接…',
  loading: '正在加载语音模型…',
  listening: '正在聆听',
  stopping: '正在处理最后一句…',
}

function Captions({ captions, interim, recState, level }) {
  const list = useRef(null)
  const follow = useRef(true)
  useEffect(() => {
    const element = list.current
    if (element && follow.current) element.scrollTop = element.scrollHeight
  }, [captions, interim])
  return (
    <section className="agenda-card lecture-captions" aria-label="实时字幕">
      <h2 className="schedule-form-title lecture-captions-title">
        实时字幕
        <span className={`lecture-rec-state is-${recState}`} role="status">
          {recState === 'listening' && (
            <span className="lecture-level" aria-hidden="true">
              <span style={{ transform: `scaleX(${Math.max(0.04, level)})` }} />
            </span>
          )}
          {STATE_LABELS[recState]}
        </span>
      </h2>
      {captions.length || interim ? (
        <ol
          ref={list}
          className="lecture-caption-list"
          onScroll={(event) => {
            const element = event.currentTarget
            follow.current = element.scrollHeight - element.scrollTop - element.clientHeight < 80
          }}
        >
          {captions.map((caption) => (
            <li key={caption.key} className="lecture-caption">
              <span className="lecture-note-time">{formatElapsed(caption.at_seconds)}</span>
              <p className="lecture-caption-en" lang="en">
                {caption.en}
              </p>
              <p className={`lecture-caption-zh is-${caption.status}`} lang="zh-CN">
                {caption.status === 'pending'
                  ? '翻译中…'
                  : caption.status === 'failed'
                    ? '（这句没有翻译成功）'
                    : caption.zh}
              </p>
            </li>
          ))}
          {interim && (
            <li className="lecture-caption is-interim" aria-live="off">
              <span className="lecture-note-time">{formatElapsed(interim.at_seconds)}</span>
              <p className="lecture-caption-en" lang="en">
                {interim.en}
              </p>
              <p className="lecture-caption-zh is-pending">正在听…</p>
            </li>
          )}
        </ol>
      ) : (
        <div className="lecture-captions-empty">
          <Icon name="mic" size={22} aria-hidden="true" />
          <p>
            {recState === 'off'
              ? '点击“开始录音”后，老师的英文讲话和中文翻译会逐句显示在这里。'
              : '正在等待老师开口…'}
          </p>
        </div>
      )}
    </section>
  )
}

export default function LectureLive({ user, onOpenRecords }) {
  const [draft, setDraft] = useState(() => readDraft(user.id))
  const [restored, setRestored] = useState(() => Boolean(readDraft(user.id)))
  const [now, setNow] = useState(() => Date.now())
  const [noteText, setNoteText] = useState('')
  const [saved, setSaved] = useState(null)
  const [courseNames, setCourseNames] = useState([])
  const [recState, setRecState] = useState('off')
  const [level, setLevel] = useState(0)
  // The sentence still being spoken; shown in grey, never saved.
  const [interim, setInterim] = useState(null)
  const [streamError, setStreamError] = useState('')
  const [askConsent, setAskConsent] = useState(false)
  const [confirmEnd, setConfirmEnd] = useState(false)
  const noteInput = useRef(null)
  const recording = useRef(null)
  const ending = Boolean(draft?.endedAt)

  useEffect(() => writeDraft(user.id, draft), [user.id, draft])

  useEffect(() => {
    if (!draft || ending) return undefined
    const timer = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [draft, ending])

  // Leaving the page always turns the microphone off.
  useEffect(() => () => recording.current?.abort(), [])

  useEffect(() => {
    if (!ending) return
    let active = true
    api
      .lectureRecords()
      .then((result) => {
        if (active) setCourseNames([...new Set(result.items.map((item) => item.course_name))])
      })
      .catch(() => {
        // Suggestions are optional.
      })
    return () => {
      active = false
    }
  }, [ending])

  const elapsed = draft
    ? ((draft.endedAt ? Date.parse(draft.endedAt) : now) - Date.parse(draft.startedAt)) / 1000
    : 0

  function start() {
    setSaved(null)
    setRestored(false)
    setStreamError('')
    setDraft({ startedAt: new Date().toISOString(), notes: [], captions: [], segments: [] })
    setNow(Date.now())
    setTimeout(() => noteInput.current?.focus(), 0)
  }

  function closeSegment(index) {
    setDraft((current) =>
      current
        ? {
            ...current,
            segments: current.segments.map((segment) =>
              segment.index === index && !segment.endedAt
                ? { ...segment, endedAt: new Date().toISOString() }
                : segment,
            ),
          }
        : current,
    )
  }

  async function startRecording() {
    if (!hasConsent(user.id)) {
      setAskConsent(true)
      return
    }
    setAskConsent(false)
    setStreamError('')
    setRestored(false)
    setRecState('connecting')
    const segmentStart = Date.now()
    const offset = (segmentStart - Date.parse(draft.startedAt)) / 1000
    const index = (draft.segments.at(-1)?.index ?? -1) + 1
    setDraft((current) => ({
      ...current,
      segments: [...current.segments, { index, startedAt: new Date(segmentStart).toISOString() }],
    }))
    const updateCaption = (key, changes) =>
      setDraft((current) =>
        current
          ? {
              ...current,
              captions: current.captions.map((caption) =>
                caption.key === key ? { ...caption, ...changes } : caption,
              ),
            }
          : current,
      )
    try {
      recording.current = await startLectureStream({
        onStatus: (state) => {
          if (state === 'loading' || state === 'listening') setRecState(state)
        },
        onPartial: (message) =>
          setInterim(
            message.en
              ? { en: message.en, at_seconds: Math.round((offset + message.offset) * 10) / 10 }
              : null,
          ),
        onCaption: (message) => {
          setInterim(null)
          setDraft((current) =>
            current
              ? {
                  ...current,
                  captions: [
                    ...current.captions,
                    {
                      key: `${index}-${message.id}`,
                      segment: index,
                      at_seconds: Math.round((offset + message.offset) * 10) / 10,
                      duration: message.duration,
                      en: message.en,
                      zh: null,
                      status: 'pending',
                    },
                  ],
                }
              : current,
          )
        },
        onTranslation: (message) =>
          updateCaption(`${index}-${message.id}`, {
            zh: message.zh,
            status: message.zh ? 'done' : 'failed',
          }),
        onLevel: setLevel,
        onError: (message) => {
          setStreamError(message)
          setInterim(null)
          closeSegment(index)
        },
        onClosed: () => {
          recording.current = null
          setInterim(null)
          closeSegment(index)
          setRecState('off')
          setLevel(0)
        },
      })
    } catch (cause) {
      setStreamError(cause.message)
      setRecState('off')
      setDraft((current) => ({
        ...current,
        segments: current.segments.filter((segment) => segment.index !== index),
      }))
    }
  }

  function pauseRecording() {
    const handle = recording.current
    if (!handle) return
    setRecState('stopping')
    // Recording time ends now; captions for the last sentence may still arrive.
    setDraft((current) => ({
      ...current,
      segments: current.segments.map((segment) =>
        segment.endedAt ? segment : { ...segment, endedAt: new Date().toISOString() },
      ),
    }))
    handle.stop()
  }

  function endCourse() {
    if (recording.current) pauseRecording()
    setDraft((current) => ({ ...current, endedAt: new Date().toISOString() }))
  }

  function addNote(event) {
    event?.preventDefault()
    const text = noteText.trim()
    if (!text) return
    const atSeconds = Math.max(0, Math.round((Date.now() - Date.parse(draft.startedAt)) / 1000))
    setDraft((current) => ({
      ...current,
      notes: [...current.notes, { id: newNoteId(), at_seconds: atSeconds, text, important: false }],
    }))
    setNoteText('')
  }

  function changeNote(next) {
    setDraft((current) => ({
      ...current,
      notes: current.notes.map((note) => (note.id === next.id ? next : note)),
    }))
  }

  function deleteNote(id) {
    setDraft((current) => ({ ...current, notes: current.notes.filter((note) => note.id !== id) }))
  }

  if (!draft) {
    return (
      <section className="lecture-page" aria-label="课程实时翻译">
        {saved && (
          <p className="message success" role="status">
            已保存到课程记录：{saved.course_name}。
            <button type="button" className="text-button" onClick={onOpenRecords}>
              查看课程记录
            </button>
          </p>
        )}
        <div className="agenda-card lecture-start">
          <span className="empty-icon">
            <Icon name="mic" size={31} />
          </span>
          <h2>准备上课</h2>
          <p>
            点击“开始课程”后开始计时。上课时可以录音，老师的英文讲话会逐句识别并翻译成中文；也可以随时记录带时间点的笔记。下课时点击“结束课程”，选择保存到课程记录或丢弃。
          </p>
          <p className="lecture-start-note">
            识别和翻译都在本机完成，不上传、不保存录音。录音前请确认已获得授课老师和学校的允许。
          </p>
          <button type="button" className="mail-primary" onClick={start}>
            <Icon name="mic" size={16} aria-hidden="true" />
            开始课程
          </button>
        </div>
      </section>
    )
  }

  if (ending) {
    return (
      <section className="lecture-page" aria-label="课程实时翻译">
        {recState !== 'off' && (
          <p className="reply-status" role="status">
            正在处理最后一句的字幕…
          </p>
        )}
        <SaveForm
          draft={draft}
          courseNames={courseNames}
          busy={
            recState !== 'off' || draft.captions.some((caption) => caption.status === 'pending')
          }
          onSummary={(summary) => setDraft((current) => current && { ...current, summary })}
          onBack={() =>
            setDraft((current) => {
              const resumed = { ...current }
              delete resumed.endedAt
              return resumed
            })
          }
          onDiscard={() => setDraft(null)}
          onSaved={(record) => {
            setSaved(record)
            setDraft(null)
          }}
        />
      </section>
    )
  }

  const active = recState !== 'off'
  return (
    <section className="lecture-page" aria-label="课程实时翻译">
      {restored && (
        <p className="message success" role="status">
          已恢复未结束的课程（{hkClock(draft.startedAt)} 开始），笔记都在。
        </p>
      )}
      {streamError && (
        <p className="message error" role="alert">
          {streamError}
        </p>
      )}
      <div className="agenda-card lecture-bar">
        <div className="lecture-clock">
          <span className="lecture-live-dot" aria-hidden="true" />
          <div>
            <span>
              上课中，{hkClock(draft.startedAt)} 开始，已录音{' '}
              {formatElapsed(recordedSeconds(draft.segments, now))}
            </span>
            <strong aria-label="本节课已进行">{formatElapsed(elapsed)}</strong>
          </div>
        </div>
        <div className="lecture-controls">
          {active ? (
            <button
              type="button"
              className="mail-secondary lecture-recording"
              onClick={pauseRecording}
              disabled={recState === 'stopping'}
            >
              <span className="lecture-rec-dot" aria-hidden="true" />
              {recState === 'stopping' ? '正在暂停…' : '暂停录音'}
            </button>
          ) : (
            <button type="button" className="mail-secondary" onClick={startRecording}>
              <Icon name="mic" size={16} aria-hidden="true" />
              {draft.segments.length ? '继续录音' : '开始录音'}
            </button>
          )}
          {confirmEnd ? (
            <span className="schedule-confirm" role="group" aria-label="确认结束课程">
              <span>确定要结束课程吗？</span>
              <button
                type="button"
                className="danger-text"
                onClick={() => {
                  setConfirmEnd(false)
                  endCourse()
                }}
              >
                结束课程
              </button>
              <button type="button" onClick={() => setConfirmEnd(false)}>
                继续上课
              </button>
            </span>
          ) : (
            <button
              type="button"
              className="mail-primary lecture-end"
              onClick={() => setConfirmEnd(true)}
            >
              结束课程
            </button>
          )}
        </div>
      </div>
      {askConsent && (
        <div className="agenda-card lecture-consent" role="group" aria-label="录音前确认">
          <p>
            录音会在本机实时转写老师的讲话，不会上传或保存录音。请确认你已获得授课老师和学校的允许，并遵守课程关于录音或转写的规定。
          </p>
          <div className="schedule-form-actions">
            <button type="button" className="mail-secondary" onClick={() => setAskConsent(false)}>
              取消
            </button>
            <button
              type="button"
              className="mail-primary"
              onClick={() => {
                try {
                  localStorage.setItem(consentKey(user.id), '1')
                } catch {
                  // Without storage the question is simply asked again next time.
                }
                startRecording()
              }}
            >
              我已确认，开始录音
            </button>
          </div>
        </div>
      )}
      <div className="lecture-columns">
        <Captions captions={draft.captions} interim={interim} recState={recState} level={level} />
        <section className="agenda-card lecture-notes" aria-label="课堂笔记">
          <h2 className="schedule-form-title">
            课堂笔记 <span>{draft.notes.length} 条</span>
          </h2>
          {draft.notes.length ? (
            <ol className="lecture-note-list">
              {draft.notes.map((note) => (
                <NoteItem
                  key={note.id}
                  note={note}
                  startedAt={draft.startedAt}
                  onChange={changeNote}
                  onDelete={() => deleteNote(note.id)}
                />
              ))}
            </ol>
          ) : (
            <p className="lecture-notes-empty">还没有笔记。老师讲到重点时，随手记一句。</p>
          )}
          <form className="lecture-note-input" onSubmit={addNote}>
            <label>
              <span className="sr-only">新笔记</span>
              <textarea
                ref={noteInput}
                rows={2}
                maxLength={2000}
                value={noteText}
                placeholder="写下笔记，按回车添加（Shift + 回车换行）"
                onChange={(event) => setNoteText(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
                    addNote(event)
                  }
                }}
              />
            </label>
            <button type="submit" className="mail-primary" disabled={!noteText.trim()}>
              添加笔记（{formatElapsed(elapsed)}）
            </button>
          </form>
        </section>
      </div>
    </section>
  )
}
