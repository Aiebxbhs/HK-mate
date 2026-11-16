// The lecture in progress: timer, notes, captions and the recording itself.
// It lives above the pages (see Home.jsx), so opening the inbox or the schedule during class
// does not stop the microphone or the captions. Signing out or closing the tab still does.

import { createContext, useContext, useEffect, useRef, useState } from 'react'
import { useLanguage } from '../i18n'
import { readMicSettings, startLectureStream } from './lecture-stream'
import { formatElapsed } from './lecture-time'

// In-progress lectures are kept only in this browser (per account) until the user saves or
// discards them, so a refresh or an accidental close does not lose notes.
const draftKey = (userId) => `hkmate.lecture.draft.${userId}`

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

function writeDraft(userId, draft) {
  try {
    if (draft) localStorage.setItem(draftKey(userId), JSON.stringify(draft))
    else localStorage.removeItem(draftKey(userId))
  } catch {
    // Local recovery is a convenience; the lecture still works without it.
  }
}

export function recordedSeconds(segments, now = Date.now()) {
  return segments.reduce(
    (total, segment) =>
      total +
      ((segment.endedAt ? Date.parse(segment.endedAt) : now) - Date.parse(segment.startedAt)) /
        1000,
    0,
  )
}

const LectureSessionContext = createContext(null)

/** The lecture session, or null when no provider is mounted above. */
export function useLectureSession() {
  return useContext(LectureSessionContext)
}

export function LectureSessionProvider({ user, children }) {
  const userId = user.id
  const [draft, setDraft] = useState(() => readDraft(userId))
  const [restored, setRestored] = useState(() => Boolean(readDraft(userId)))
  const [recState, setRecState] = useState('off')
  const [level, setLevel] = useState(0)
  // The sentence still being spoken; shown in grey, never saved.
  const [interim, setInterim] = useState(null)
  const [streamError, setStreamError] = useState('')
  const recording = useRef(null)

  useEffect(() => writeDraft(userId, draft), [userId, draft])

  // Signing out (or anything else that removes the session) always turns the microphone off.
  useEffect(() => () => recording.current?.abort(), [])

  function startCourse() {
    setRestored(false)
    setStreamError('')
    setDraft({ startedAt: new Date().toISOString(), notes: [], captions: [], segments: [] })
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
    if (!draft || recording.current || recState !== 'off') return
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
      recording.current = await startLectureStream(streamHandlers(), undefined, readMicSettings())
    } catch (cause) {
      setStreamError(cause.message)
      setRecState('off')
      setDraft((current) =>
        current
          ? {
              ...current,
              segments: current.segments.filter((segment) => segment.index !== index),
            }
          : current,
      )
    }

    function streamHandlers() {
      return {
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
      }
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

  const session = {
    draft,
    setDraft,
    restored,
    recState,
    level,
    interim,
    streamError,
    startCourse,
    startRecording,
    pauseRecording,
    endCourse,
  }
  return <LectureSessionContext.Provider value={session}>{children}</LectureSessionContext.Provider>
}

/**
 * Header pill shown on other pages while a lecture is in progress: says whether the microphone
 * is on and leads back to the captions.
 */
export function LectureIndicator({ onOpen }) {
  const { t } = useLanguage()
  const session = useLectureSession()
  const draft = session?.draft
  const active = Boolean(draft) && session.recState !== 'off'
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    if (!active) return undefined
    const timer = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [active])

  if (!draft) return null
  const stopped = !active && Boolean(session.streamError) && !draft.endedAt
  const state = draft.endedAt ? 'ended' : active ? 'recording' : stopped ? 'stopped' : 'idle'
  const recorded = formatElapsed(Math.max(0, recordedSeconds(draft.segments, now)))
  const label = {
    ended: t('课程待保存', 'Lecture not saved'),
    recording: t(`录音中 ${recorded}`, `Recording ${recorded}`),
    stopped: t('录音已中断', 'Recording stopped'),
    idle: t('上课中，未录音', 'In class, not recording'),
  }[state]
  return (
    <button
      type="button"
      className={`lecture-indicator is-${state}`}
      onClick={onOpen}
      title={t('回到实时翻译', 'Back to live translation')}
    >
      <span className="lecture-indicator-dot" aria-hidden="true" />
      <span>{label}</span>
    </button>
  )
}
