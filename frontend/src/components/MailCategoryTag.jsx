import { tr } from '../i18n'

// Only school mail gets the accent tint; the other categories stay neutral.
const tones = { 学校邮件: 'course' }

// The local model labels mail with these Chinese names; English pages show a translation.
const ENGLISH = {
  学校邮件: 'School',
  求职邮件: 'Jobs',
  账单与账户: 'Bills & accounts',
  广告推广: 'Promotions',
  其他邮件: 'Other',
}

export function categoryLabel(category) {
  return tr(category, ENGLISH[category] || category)
}

/** A mail's category label; "分类中" while the local model has not labelled it yet. */
export default function MailCategoryTag({ category, pending = false, failed = false }) {
  if (!category && !pending && !failed) return null
  return (
    <span className={`mail-category ${tones[category] || ''}${category ? '' : ' is-pending'}`}>
      {category
        ? categoryLabel(category)
        : failed
          ? tr('待分类', 'Unsorted')
          : tr('分类中', 'Sorting…')}
    </span>
  )
}
