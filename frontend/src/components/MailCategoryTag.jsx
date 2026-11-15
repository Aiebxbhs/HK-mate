// Only school mail gets the accent tint; the other categories stay neutral.
const tones = { 学校邮件: 'course' }

/** A mail's category label; "分类中" while the local model has not labelled it yet. */
export default function MailCategoryTag({ category, pending = false, failed = false }) {
  if (!category && !pending && !failed) return null
  return (
    <span className={`mail-category ${tones[category] || ''}${category ? '' : ' is-pending'}`}>
      {category || (failed ? '待分类' : '分类中')}
    </span>
  )
}
