import { useState } from 'react'
import { api } from '../api/client'
import { SCHEDULE_CHANGED } from './schedule-draft'

// How to find the personal subscription link in HKU Portal (screenshots by the project owner).
const STEPS = [
  {
    image: '/guide/timetable-help/step-1.webp',
    text: '登录 HKU Portal，在左侧菜单点 Student Information System (SIS)。',
  },
  {
    image: '/guide/timetable-help/step-2.webp',
    text: '进入 SIS 后，在左侧 Self Services 下点 HKU Event Calendar (Timetable)。',
  },
  {
    image: '/guide/timetable-help/step-3.webp',
    text: '确认已勾选 Lecture Timetable 和 Examination Timetable，然后点左侧的 Subscription Setting。',
  },
  {
    image: '/guide/timetable-help/step-4.webp',
    text: '① 打开 Enable Internet Calendar；② 同步时长选 One Year；③ 点 COPY 复制 Subscription URL；④ 点 SAVE 保存。然后回到这里粘贴链接。',
  },
]

export function TimetableTutorial() {
  return (
    <ol className="timetable-tutorial">
      {STEPS.map((step, index) => (
        <li key={step.image}>
          <p>
            <span className="timetable-step">{index + 1}</span>
            {step.text}
          </p>
          <a href={step.image} target="_blank" rel="noopener noreferrer">
            <img src={step.image} alt={`第 ${index + 1} 步：${step.text}`} loading="lazy" />
          </a>
        </li>
      ))}
    </ol>
  )
}

/** Paste the HKU Event Calendar link once; the server downloads it and does not keep it. */
export default function TimetableImport({ firstTime, onImported }) {
  const [link, setLink] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  async function submit(event) {
    event.preventDefault()
    if (!link.trim()) {
      setError('请先粘贴课表订阅链接。')
      return
    }
    setBusy(true)
    setError('')
    try {
      const result = await api.importTimetable(link.trim())
      setLink('')
      window.dispatchEvent(new Event(SCHEDULE_CHANGED))
      onImported(result)
    } catch (cause) {
      setError(cause.message || '导入失败，请稍后再试。')
    } finally {
      setBusy(false)
    }
  }

  const tutorial = <TimetableTutorial />
  return (
    <section className="timetable-import" aria-label="导入 HKU 课表">
      <header>
        <h2>{firstTime ? '导入你的 HKU 课表' : '重新导入 HKU 课表'}</h2>
        <p>
          粘贴 HKU Event Calendar
          的订阅链接，我们会下载一次你的上课和考试时间。链接只用于这次下载，不会保存；
          {firstTime ? '' : '重新导入会替换现有的 HKU 课程，'}你自己添加的日程不受影响。
        </p>
      </header>
      <form className="timetable-import-form" onSubmit={submit}>
        <label htmlFor="timetable-link">课表订阅链接（Subscription URL）</label>
        <div>
          <input
            id="timetable-link"
            type="text"
            inputMode="url"
            autoComplete="off"
            spellCheck={false}
            placeholder="粘贴以 https:// 或 webcal:// 开头的 hku.hk 链接"
            value={link}
            onChange={(event) => setLink(event.target.value)}
            disabled={busy}
          />
          <button type="submit" className="timetable-import-submit" disabled={busy}>
            {busy ? '正在从 HKU 下载…' : '导入课表'}
          </button>
        </div>
        {error && (
          <p className="message error" role="alert">
            {error}
          </p>
        )}
      </form>
      {firstTime ? (
        <div className="timetable-help">
          <h3>如何找到课表链接</h3>
          {tutorial}
        </div>
      ) : (
        <details className="timetable-help">
          <summary>如何找到课表链接</summary>
          {tutorial}
        </details>
      )}
    </section>
  )
}
