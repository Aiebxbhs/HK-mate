import { useState } from 'react'
import { api } from '../api/client'
import { SCHEDULE_CHANGED } from './schedule-draft'
import { tr } from '../i18n'

// How to find the personal subscription link in HKU Portal (screenshots by the project owner).
const steps = () => [
  {
    image: '/guide/timetable-help/step-1.webp',
    text: tr(
      '登录 HKU Portal，在左侧菜单点 Student Information System (SIS)。',
      'Sign in to HKU Portal and click Student Information System (SIS) in the left menu.',
    ),
  },
  {
    image: '/guide/timetable-help/step-2.webp',
    text: tr(
      '进入 SIS 后，在左侧 Self Services 下点 HKU Event Calendar (Timetable)。',
      'In SIS, click HKU Event Calendar (Timetable) under Self Services on the left.',
    ),
  },
  {
    image: '/guide/timetable-help/step-3.webp',
    text: tr(
      '确认已勾选 Lecture Timetable 和 Examination Timetable，然后点左侧的 Subscription Setting。',
      'Make sure Lecture Timetable and Examination Timetable are ticked, then click Subscription Setting on the left.',
    ),
  },
  {
    image: '/guide/timetable-help/step-4.webp',
    text: tr(
      '① 打开 Enable Internet Calendar；② 同步时长选 One Year；③ 点 COPY 复制 Subscription URL；④ 点 SAVE 保存。然后回到这里粘贴链接。',
      '① Turn on Enable Internet Calendar; ② set the period to One Year; ③ click COPY to copy the Subscription URL; ④ click SAVE. Then come back and paste the link here.',
    ),
  },
]

export function TimetableTutorial() {
  return (
    <ol className="timetable-tutorial">
      {steps().map((step, index) => (
        <li key={step.image}>
          <p>
            <span className="timetable-step">{index + 1}</span>
            {step.text}
          </p>
          <a href={step.image} target="_blank" rel="noopener noreferrer">
            <img
              src={step.image}
              alt={tr(`第 ${index + 1} 步：${step.text}`, `Step ${index + 1}: ${step.text}`)}
              loading="lazy"
            />
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
      setError(tr('请先粘贴课表订阅链接。', 'Paste your timetable subscription link first.'))
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
      setError(
        cause.message || tr('导入失败，请稍后再试。', 'Import failed. Please try again later.'),
      )
    } finally {
      setBusy(false)
    }
  }

  const tutorial = <TimetableTutorial />
  return (
    <section className="timetable-import" aria-label={tr('导入 HKU 课表', 'Import HKU timetable')}>
      <header>
        <h2>
          {firstTime
            ? tr('导入你的 HKU 课表', 'Import your HKU timetable')
            : tr('重新导入 HKU 课表', 'Re-import your HKU timetable')}
        </h2>
        <p>
          {tr(
            '粘贴 HKU Event Calendar 的订阅链接，我们会下载一次你的上课和考试时间。链接只用于这次下载，不会保存；',
            'Paste your HKU Event Calendar subscription link and HK Mate downloads your class and exam times once. The link is used only for this download and is not saved; ',
          )}
          {firstTime
            ? ''
            : tr(
                '重新导入会替换现有的 HKU 课程，',
                're-importing replaces your current HKU classes; ',
              )}
          {tr('你自己添加的日程不受影响。', 'events you added yourself are not affected.')}
        </p>
      </header>
      <form className="timetable-import-form" onSubmit={submit}>
        <label htmlFor="timetable-link">
          {tr('课表订阅链接（Subscription URL）', 'Timetable subscription link (Subscription URL)')}
        </label>
        <div>
          <input
            id="timetable-link"
            type="text"
            inputMode="url"
            autoComplete="off"
            spellCheck={false}
            placeholder={tr(
              '粘贴以 https:// 或 webcal:// 开头的 hku.hk 链接',
              'Paste an hku.hk link starting with https:// or webcal://',
            )}
            value={link}
            onChange={(event) => setLink(event.target.value)}
            disabled={busy}
          />
          <button type="submit" className="timetable-import-submit" disabled={busy}>
            {busy
              ? tr('正在从 HKU 下载…', 'Downloading from HKU…')
              : tr('导入课表', 'Import timetable')}
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
          <h3>{tr('如何找到课表链接', 'How to find your timetable link')}</h3>
          {tutorial}
        </div>
      ) : (
        <details className="timetable-help">
          <summary>{tr('如何找到课表链接', 'How to find your timetable link')}</summary>
          {tutorial}
        </details>
      )}
    </section>
  )
}
