import { afterEach, expect, it } from 'vitest'
import { getLanguage, locale, mailText, setLanguage, tr } from './i18n'
import { categoryLabel } from './components/MailCategoryTag'
import { parseSection } from './components/GuideSection'
import { PLACEHOLDER } from './components/ReplyDraftPanel'

afterEach(() => setLanguage('zh'))

it('defaults to Chinese and remembers the chosen language', () => {
  expect(getLanguage()).toBe('zh')
  expect(tr('保存', 'Save')).toBe('保存')
  setLanguage('en')
  expect(tr('保存', 'Save')).toBe('Save')
  expect(locale()).toBe('en-GB')
  expect(localStorage.getItem('hkm-language')).toBe('en')
  expect(document.title).toMatch(/Make time for life/)
})

it('translates server placeholders and mail categories only in English', () => {
  expect(mailText('（无主题）')).toBe('（无主题）')
  expect(categoryLabel('学校邮件')).toBe('学校邮件')
  setLanguage('en')
  expect(mailText('（无主题）')).toBe('(No subject)')
  expect(mailText('Hello')).toBe('Hello')
  expect(categoryLabel('账单与账户')).toBe('Bills & accounts')
})

it('reads guide facts and draft placeholders written in either language', () => {
  expect(parseSection('- Exit: Exit A1 or A2')[0].facts[0]).toEqual({
    label: 'Exit',
    value: 'Exit A1 or A2',
  })
  expect(parseSection('- 出口：Exit A1 或 A2')[0].facts[0].label).toBe('出口')
  const draft = 'Hi [To fill in: preferred time], see 【需补充：课程编号】'
  expect(draft.match(PLACEHOLDER)).toEqual(['[To fill in: preferred time]', '【需补充：课程编号】'])
})
