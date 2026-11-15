import { useSyncExternalStore } from 'react'

/**
 * Interface language: 'zh' (default) or 'en'.
 *
 * Text stays next to the code as pairs: t('保存', 'Save'). After sign-in the account's language
 * wins; before that the last choice in this browser is used. The API client sends the current
 * language so server messages come back in it too.
 */
const STORAGE_KEY = 'hkm-language'
const listeners = new Set()

function stored() {
  try {
    return localStorage.getItem(STORAGE_KEY) === 'en' ? 'en' : 'zh'
  } catch {
    return 'zh'
  }
}

let current = stored()
applyDocument(current)

function applyDocument(language) {
  if (typeof document === 'undefined') return
  document.documentElement.lang = language === 'en' ? 'en' : 'zh-CN'
  document.title = language === 'en' ? 'HK Mate · Make time for life' : 'HK Mate · 留一点时间给生活'
}

export function getLanguage() {
  return current
}

export function setLanguage(language) {
  const next = language === 'en' ? 'en' : 'zh'
  try {
    localStorage.setItem(STORAGE_KEY, next)
  } catch {
    // private mode: the choice still applies to this page
  }
  if (next === current) return
  current = next
  applyDocument(next)
  for (const listener of listeners) listener()
}

function subscribe(listener) {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

/** Picks the text for the current language; usable outside components (render-time only). */
export function tr(zh, en) {
  return current === 'en' ? en : zh
}

/** Locale for dates and numbers. */
export function locale() {
  return current === 'en' ? 'en-GB' : 'zh-CN'
}

/** Re-renders the component when the language changes. */
export function useLanguage() {
  const language = useSyncExternalStore(subscribe, getLanguage, getLanguage)
  return { language, en: language === 'en', t: (zh, en) => (language === 'en' ? en : zh) }
}

// Placeholders the server writes into mail data when Gmail leaves a field empty.
const MAIL_PLACEHOLDERS = {
  '（无主题）': '(No subject)',
  '（未知发件人）': '(Unknown sender)',
  '（暂无可显示的正文）': '(No body to display)',
}

/** Mail text as received, with the server's empty-field placeholders translated. */
export function mailText(value) {
  return current === 'en' && MAIL_PLACEHOLDERS[value] ? MAIL_PLACEHOLDERS[value] : value
}
