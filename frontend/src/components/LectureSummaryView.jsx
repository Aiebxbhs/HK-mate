import { formatElapsed } from './lecture-time'

export const REMINDER_KINDS = {
  assignment: '作业',
  exam: '考试',
  deadline: '截止',
  announcement: '通知',
}

function Quotes({ quotes }) {
  if (!quotes?.length) return null
  return (
    <details className="lecture-summary-quotes">
      <summary>原话</summary>
      {quotes.map((quote) => (
        <blockquote key={`${quote.at_seconds}-${quote.en}`} lang="en">
          <span className="lecture-note-time">{formatElapsed(quote.at_seconds)}</span>
          {quote.en}
        </blockquote>
      ))}
    </details>
  )
}

/** Shows a saved or freshly generated lecture summary. Content is model output: text only. */
export default function LectureSummaryView({ summary }) {
  return (
    <div className="lecture-summary">
      <p className="lecture-summary-overview">{summary.overview}</p>
      {summary.reminders.length > 0 && (
        <ul className="lecture-summary-reminders" aria-label="课程安排提醒">
          {summary.reminders.map((item) => (
            <li key={`${item.at_seconds}-${item.text}`}>
              <span className={`lecture-summary-kind is-${item.kind}`}>
                {REMINDER_KINDS[item.kind]}
              </span>
              <span>
                {item.text}
                <span className="lecture-summary-at">{formatElapsed(item.at_seconds)}</span>
                <Quotes quotes={item.quotes} />
              </span>
            </li>
          ))}
        </ul>
      )}
      <ol className="lecture-summary-points" aria-label="课程重点">
        {summary.key_points.map((item) => (
          <li key={`${item.at_seconds}-${item.text}`}>
            <span className="lecture-note-time">{formatElapsed(item.at_seconds)}</span>
            <span>
              {item.text}
              <Quotes quotes={item.quotes} />
            </span>
          </li>
        ))}
      </ol>
      <p className="lecture-summary-disclaimer">
        由本机 AI
        根据语音识别文字生成，可能有遗漏或错误；时间点和原话由程序从转写中取出，可用于核对。
      </p>
    </div>
  )
}

export function summaryMarkdown(summary) {
  const lines = ['## AI 摘要', '', summary.overview]
  if (summary.reminders.length) {
    lines.push('', '### 课程安排提醒', '')
    for (const item of summary.reminders)
      lines.push(`- [${formatElapsed(item.at_seconds)}] ${REMINDER_KINDS[item.kind]}：${item.text}`)
  }
  lines.push('', '### 重点', '')
  for (const item of summary.key_points) {
    lines.push(`- [${formatElapsed(item.at_seconds)}] ${item.text}`)
    for (const quote of item.quotes) lines.push(`  > ${quote.en}`)
  }
  lines.push('', '（由本机 AI 生成，可能有误，请对照原话核实。）')
  return lines
}
