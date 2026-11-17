// The intro video, scene by scene. Run through video/record.mjs; ?only=a,b plays some scenes.
//
// Every scene follows the same camera rule (see lib.js): clicks happen in view at the normal
// size; the camera moves in only to show a result for a moment, then pulls back.
import {
  H,
  W,
  all,
  caption,
  click,
  fill,
  focus,
  frame,
  glideTo,
  hidePointer,
  intoView,
  mark,
  menu,
  normalPage,
  q,
  setSpeed,
  sleep,
  type,
  unrollPage,
  waitFor,
  wide,
  win,
  withText,
} from './lib.js'

const $ = (id) => document.getElementById(id)
const params = new URLSearchParams(location.search)
const only = (params.get('only') || '').split(',').filter(Boolean)
const shot = (name) => mark({ type: 'shot', name })
// ?lang=en records the English version: English interface, captions and questions.
const EN = params.get('lang') === 'en'
const L = (zh, en) => (EN ? en : zh)
const SAVE = L('保存课程', 'Save lecture')
// ?stills=1 takes clean screenshots for the README: the same steps, with nothing drawn on top.
if (params.has('stills')) document.getElementById('stage').classList.add('stills')

async function api(path, body, method = 'POST') {
  const { csrf_token } = await (await fetch('/api/v1/auth/csrf')).json()
  const response = await fetch('/api/v1' + path, {
    method,
    headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrf_token },
    body: JSON.stringify(body ?? {}),
  })
  return response.status === 204 ? null : response.json()
}
const get = async (path) => (await fetch('/api/v1' + path)).json()
const hkDate = (offsetDays) =>
  new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Hong_Kong' }).format(
    new Date(Date.now() + offsetDays * 86400000),
  )

async function loadApp(hash = '') {
  frame.src = '/' + hash
  await new Promise((resolve) => frame.addEventListener('load', resolve, { once: true }))
  await waitFor(() => q('.main-nav-link'))
  await sleep(700)
}

// ---- preparation (not recorded) -------------------------------------------------------------

async function prepare() {
  const demo = await (await fetch('/__demo/state')).json()
  await api('/auth/login', { username: demo.username, password: demo.password })
  await api('/users/me/language', { language: EN ? 'en' : 'zh' }, 'PUT')
  localStorage.setItem('hkm-language', EN ? 'en' : 'zh')
  document.querySelector('.banner-top i').textContent = L('现在', 'now')
  // A few things the student added by hand, so the home page has a deadline to show.
  const existing = await get(`/calendar/events?start_date=${hkDate(0)}&end_date=${hkDate(30)}`)
  if (!existing.items.some((item) => item.source === 'manual')) {
    const soon = new Date(Date.now() + 20 * 3600000)
    const time = new Intl.DateTimeFormat('en-GB', {
      timeZone: 'Asia/Hong_Kong',
      hour: '2-digit',
      minute: '2-digit',
    }).format(soon)
    const date = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Hong_Kong' }).format(soon)
    await api('/calendar/events', {
      kind: 'deadline',
      title: L('COMP7503 Quiz 3 提交', 'COMP7503 Quiz 3'),
      date,
      start_time: time,
    })
    await api('/calendar/events', {
      kind: 'deadline',
      title: L('DASC7606 小组报告', 'DASC7606 group report'),
      date: hkDate(4),
      start_time: '23:59',
    })
    await api('/calendar/events', {
      kind: 'event',
      title: L('羽毛球', 'Badminton'),
      date: hkDate(2),
      start_time: '17:00',
      end_time: '18:30',
      location: 'Stanley Ho Sports Centre',
    })
  }
  // A saved signature, so reply drafts are complete.
  localStorage.setItem('hkmate.reply.signature', 'Mia')
}

// ---- 0 opening: the questions, then HK Mate ---------------------------------------------------

// Each question is one the app answers later in the film. [text, left, top, tilt in degrees]
const QUESTIONS = EN
  ? [
      ['Important emails buried in the pile<i>?</i>', 150, 130, -3],
      ['Classes, exams, deadlines everywhere<i>?</i>', 760, 250, 2],
      ['Lectures too fast to follow<i>?</i>', 240, 420, 1.5],
      ['HKID<i>?</i> Tuition fees<i>?</i> Where to start<i>?</i>', 700, 560, -2],
      ['Which library floor has a printer<i>?</i>', 170, 720, 2.5],
      ['Half an hour to write one email<i>?</i>', 800, 860, -1.5],
    ]
  : [
      ['邮件太多，重要的总被淹没<i>？</i>', 150, 130, -3],
      ['课表、考试、DDL，散在各处<i>？</i>', 930, 250, 2],
      ['英文授课太快，听不全也记不住<i>？</i>', 240, 420, 1.5],
      ['HKID 怎么办<i>？</i>学费怎么交<i>？</i>', 1010, 560, -2],
      ['图书馆哪层能打印、能自习<i>？</i>', 170, 720, 2.5],
      ['回一封英文邮件，要斟酌半天<i>？</i>', 860, 860, -1.5],
    ]
const PARTS = EN
  ? ['Schedule', 'Mail summaries', 'Live lecture translation', 'AI assistant', 'HKU guide']
  : ['日程课表', '邮件摘要', '课堂实时翻译', 'AI 助手', 'HKU 指南']

async function opening() {
  const stage = $('opening')
  stage.innerHTML =
    QUESTIONS.map(
      ([text, left, top, tilt]) =>
        `<div class="ask" style="left:${left}px;top:${top}px;rotate:${tilt}deg">${text}</div>`,
    ).join('') +
    `<div id="intro">
       <div id="intro-mark">HK Mate<span></span></div>
       <div id="intro-line">${L('港大生活，一个就够', 'HKU life, all in one place')}</div>
       <div id="intro-parts">${PARTS.map((part) => `<b>${part}</b>`).join('')}</div>
     </div>`
  const asks = [...stage.querySelectorAll('.ask')]
  mark({ type: 'start' })
  await sleep(450)
  // The questions pile up, each a little quicker than the last.
  let pause = 1050
  for (const [index, ask] of asks.entries()) {
    asks.slice(0, index).forEach((earlier) => earlier.classList.add('old'))
    ask.classList.add('on')
    if (index === 2) shot('opening-questions')
    await sleep(pause)
    pause = Math.max(620, pause * 0.86)
  }
  asks.forEach((ask) => ask.classList.remove('old'))
  shot('opening-all')
  await sleep(900)
  // They all fall into one point, and the answer appears there.
  for (const ask of asks) {
    const rect = ask.getBoundingClientRect()
    const dx = 960 - (rect.left + rect.width / 2)
    const dy = 500 - (rect.top + rect.height / 2)
    ask.style.transform = `translate(${dx}px, ${dy}px) scale(0.04)`
    ask.style.opacity = 0
  }
  await sleep(480)
  $('intro-mark').classList.add('on')
  await sleep(900)
  $('intro-line').classList.add('on')
  await sleep(900)
  // What it brings together, one part at a time.
  const parts = [...stage.querySelectorAll('#intro-parts b')]
  for (const part of parts) {
    part.classList.add('on')
    await sleep(260)
  }
  await sleep(500)
  for (const part of parts) {
    part.classList.add('lit')
    await sleep(230)
  }
  shot('opening-intro')
  await sleep(1900)
  stage.style.opacity = 0
  await sleep(750)
  stage.style.display = 'none'
  shot('home-before')
  await sleep(900)
}

// ---- 1 home: the next five days, and the assistant ------------------------------------------

/** Type a question (seen up close), then pull back before sending so the answer is in view. */
async function ask(text) {
  const input = await waitFor(() => {
    const field = q('#agent-message')
    return field && !field.disabled ? field : null
  })
  await click(input)
  await focus(input.closest('form') || input, { zoom: 1.35 })
  await type(input, text, 55)
  await sleep(450)
  await caption('')
  await wide(500)
  const before = all('.agent-text').length
  input.form.requestSubmit()
  await waitFor(() => all('.agent-text').length > before && !q('.agent-thinking'), { speed: 4 })
  await sleep(500)
}

async function home() {
  await menu(L('主页', 'Home'), { hint: L('接下来 5 天 · AI 助手', 'Next 5 days · AI assistant') })
  await waitFor(() => q('.week-item'))
  await caption(L('主页：这几天的安排，一眼看到', 'Home: the days ahead at a glance'), { lead: true })
  shot('home-first')
  await sleep(2300)
  win().scrollBy({ top: 210, behavior: 'smooth' })
  await sleep(600)
  await focus(q('.week-ahead'), { zoom: 1.22, at: [0.5, 0.42] })
  await caption(L('接下来 5 天：日程和截止事项', 'Next 5 days: events and deadlines'))
  await sleep(2300)
  const urgent = q('.week-dot.is-urgent')
  if (urgent) {
    await focus(urgent.closest('.week-item'), { zoom: 1.85 })
    await caption(L('24 小时内截止，有提醒', 'Due within 24 hours? It gets flagged'))
    shot('home-urgent')
    await sleep(2000)
  }
  await caption('')
  await wide(600)
  win().scrollTo({ top: 0, behavior: 'smooth' })
  await sleep(700)
  // The assistant sits on the home page.
  await caption(L('想知道什么，直接问 AI 助手', 'Just ask the AI assistant'), { lead: true })
  await sleep(1200)
  await ask(L('我明天有什么安排？', 'What do I have tomorrow?'))
  shot('ai-schedule')
  await sleep(3000)
  await ask(L('学校附近有什么好吃的', 'Where can I eat near campus?'))
  const choice = await waitFor(() => all('.agent-choices button').find((button) => /中餐|chinese/i.test(button.innerText)) || q('.agent-choices button'), { timeout: 20000 })
  await intoView(choice)
  await sleep(1100)
  let before = all('.agent-text').length
  await click(choice)
  await waitFor(() => q('.agent-places') && all('.agent-text').length > before && !q('.agent-thinking'), {
    speed: 4,
  })
  await sleep(500)
  const places = q('.agent-places')
  await intoView(places, { block: 'start' })
  await sleep(900)
  await focus(places, { zoom: 1.25, at: [0.5, 0.4] })
  await caption(L('吃什么也能问', 'Even where to eat'))
  shot('ai-places')
  await sleep(2800)
  await caption('')
  await wide(500)
  // It can prepare a schedule item; nothing is added until the user confirms.
  await ask(L('帮我把周五下午三点到四点的小组讨论加进日程', 'Add a group discussion this Friday from 3 to 4 pm to my schedule'))
  const event = await waitFor(() => all('.agent-event').at(-1), { timeout: 20000 })
  await intoView(event)
  await sleep(900)
  await focus(event, { zoom: 1.4 })
  await caption(L('让它加日程：你确认了才会加', 'It adds events only after you confirm'))
  shot('ai-event')
  await sleep(1700)
  const confirm = withText(L('确认添加', 'Add it'))
  if (confirm) await click(confirm)
  await sleep(1600)
  await caption('')
  await wide(500)
}

// ---- 2 schedule: the list, adding by hand, the timetable -------------------------------------

async function schedule() {
  await menu(L('日程', 'Schedule'), { hint: L('我的日程 · 我的课表', 'My schedule · My timetable') })
  // The item the assistant just added is already in the list.
  const added = await waitFor(() => all('.agenda-list *:not(:has(*))').find((item) => /小组讨论|discussion/i.test(item.textContent)))
  const row = added.closest('li, article') || added
  await caption(L('我的日程：刚才 AI 加的，已经在这里', 'My schedule: the AI’s event is already here'), { lead: true })
  await sleep(1200)
  await focus(row, { zoom: 1.5 })
  shot('schedule-ai-item')
  await sleep(2300)
  await caption('')
  await wide(500)
  // Adding one by hand: a deadline.
  win().scrollTo({ top: 0, behavior: 'smooth' })
  await sleep(500)
  await click(q('.add-button'))
  const form = await waitFor(() => q('.schedule-form'))
  await sleep(500)
  await caption(L('自己加一条：活动，或截止事项', 'Add your own: an event or a deadline'))
  await click(all('.schedule-kind label')[1])
  const title = form.querySelector('input[data-autofocus]')
  await click(title)
  await type(title, 'DASC7606 Assignment 3', 55)
  fill(form.querySelector('input[type="date"]'), hkDate(3))
  await sleep(350)
  fill(form.querySelector('input[type="time"]'), '23:59')
  await sleep(600)
  shot('schedule-form')
  await click(form.querySelector('button[type="submit"]'))
  const mine = await waitFor(() => withText('DASC7606 Assignment 3', '.agenda-list *:not(:has(*))'))
  await sleep(500)
  await focus(mine.closest('li, article') || mine, { zoom: 1.5 })
  await caption(L('截止还剩多久，进度条看得见', 'A bar shows how much time is left'))
  shot('schedule-deadline')
  await sleep(2600)
  await caption('')
  await wide(500)
  // The timetable: one link, the whole semester. A new mail "arrives" meanwhile for later.
  void fetch('/__demo/deliver')
  win().scrollTo({ top: 0, behavior: 'smooth' })
  await sleep(500)
  await click(await waitFor(() => all('.section-tabs button')[1]))
  const input = await waitFor(() => q('#timetable-link'))
  await sleep(500)
  await caption(L('我的课表：整学期，一次导入', 'Timetable: the whole semester in one import'), { lead: true })
  await sleep(1700)
  await focus(q('.timetable-import-form'), { zoom: 1.45 })
  await caption(L('粘贴 HKU 的课表链接', 'Paste your HKU timetable link'))
  await click(input)
  await type(input, 'https://sis.hku.hk/calendar/subscription/', 16)
  input.style.filter = 'blur(4px)' // a real link carries a private token
  await sleep(500)
  shot('timetable-before-click')
  await click(q('.timetable-import-submit'))
  await caption('')
  await waitFor(() => q('.timetable-card'), { speed: 4 })
  await sleep(250)
  // The biggest move of the film: pull back from the button, then glide down the semester.
  const grid = q('.timetable')
  const top = grid.getBoundingClientRect().top + win().scrollY - 40
  const height = await unrollPage({ zoom: 0.86, top, ms: 1400 })
  shot('timetable-top')
  await caption(L('整学期的课，都在这里', 'Every class of the semester'))
  await glideTo(height, 3400)
  shot('timetable-bottom')
  await sleep(900)
  await caption('')
  normalPage()
  const today = await waitFor(() => q('.timetable-today'))
  today.scrollIntoView({ block: 'start' })
  win().scrollBy(0, -205)
  await wide(900)
  shot('timetable-week')
  await sleep(900)
  // Back on the home page everything shows up together.
  await menu(L('主页', 'Home'), { hint: L('课表和日程都更新了', 'Timetable and schedule, updated') })
  await waitFor(() => q('.week-item'))
  win().scrollBy({ top: 210, behavior: 'smooth' })
  await sleep(600)
  await focus(q('.week-ahead'), { zoom: 1.22, at: [0.5, 0.42] })
  await caption(L('课、日程、截止事项，都回到主页', 'Classes, events and deadlines, all on Home'))
  shot('home-after')
  await sleep(3000)
  await caption('')
  await wide(600)
  win().scrollTo({ top: 0, behavior: 'smooth' })
  await sleep(600)
}

// ---- 3 mail -----------------------------------------------------------------------------------

async function mail() {
  // Wait for the background check to find the mail and the local model to summarise it.
  let notice
  for (let waited = false; !notice; ) {
    const data = await get('/mail-notifications')
    notice = data.items.find((item) => item.status === 'ready')
    if (notice) break
    if (!waited) setSpeed(8)
    waited = true
    await new Promise((resolve) => setTimeout(resolve, 400))
  }
  setSpeed(0)
  // The system banner, drawn here with the real sender, subject and summary.
  $('banner-title').textContent = notice.sender.replace(/\s*<.*>$/, '')
  $('banner-subtitle').textContent = notice.subject
  $('banner-body').textContent = notice.summary.overview
  $('banner').classList.add('on')
  await sleep(600)
  await caption(L('邮件来了，先看一句话', 'New mail: read one line first'), { lead: true })
  await sleep(700)
  shot('mail-banner')
  await sleep(2700)
  $('banner').classList.remove('on')
  await menu(L('邮件', 'Mail'), { hint: L('收件箱 · 起草邮件 · 邮箱管理', 'Inbox · Compose · Mailboxes') })
  const tabs = await waitFor(() => q('.inbox-mailboxes'))
  await waitFor(() => q('.inbox-mailbox-count'))
  await focus(tabs, { zoom: 1.6 })
  await caption(L('几个邮箱，分开看', 'Each mailbox has its own tab'))
  shot('mail-tabs')
  await sleep(2100)
  const card = await waitFor(() => q('.new-mail-card'))
  await focus(card, { zoom: 1.12 })
  await caption(L('自动分类，自动摘要', 'Sorted and summarized automatically'))
  shot('mail-card')
  await sleep(2800)
  // Back out before clicking, so the reply window is seen opening.
  await caption('')
  await wide(550)
  await click(all('.new-mail-actions button')[2])
  const generate = await waitFor(() => q('.reply-generate button'))
  await sleep(700)
  await click(generate)
  const editor = await waitFor(() => q('.reply-editor textarea'), { speed: 4 })
  await sleep(400)
  shot('mail-draft-wide')
  await sleep(700)
  await focus(editor, { zoom: 1.12 })
  await caption(L('帮你起草，由你发送', 'It drafts; you send'))
  shot('mail-draft')
  await sleep(2600)
  await caption('')
  await wide(500)
  await click(q('.preview-dialog-close'))
  await sleep(400)
  // The list below: every mail already has its category.
  const first = await waitFor(() => q('.inbox-list .mail-item'))
  first.scrollIntoView({ block: 'start', behavior: 'smooth' })
  await sleep(700)
  win().scrollBy({ top: -120, behavior: 'smooth' })
  await sleep(500)
  await caption(L('每封邮件都有类别，摘要在本机生成', 'Every mail is labelled; summaries stay on your Mac'))
  shot('mail-list')
  await sleep(1200)
  win().scrollBy({ top: 240, behavior: 'smooth' })
  await sleep(2100)
  await caption('')
}

// ---- 4 lecture --------------------------------------------------------------------------------

async function lecture() {
  await menu(L('课堂翻译', 'Lectures'), { hint: L('实时翻译 · 课程记录', 'Live translation · Records') })
  await click(await waitFor(() => withText(L('开始课程', 'Start lecture'))))
  await click(await waitFor(() => withText(L('开始录音', 'Start recording'))))
  await sleep(500)
  const consent = withText(L('我已确认，开始录音', 'Confirmed, start recording'))
  if (consent) await click(consent)
  await caption(L('英文讲课，中文跟上', 'English lecture, Chinese captions'), { lead: true })
  const first = await waitFor(() => q('.lecture-caption-en'), { timeout: 60000 })
  await waitFor(() => q('.lecture-caption p:nth-of-type(2)') || all('.lecture-caption p').length > 1, {
    timeout: 60000,
  })
  shot('lecture-captions-wide')
  await sleep(1500)
  // In for a closer look at the captions while the lecturer keeps talking.
  await focus(first.closest('.lecture-captions') || first, { zoom: 1.3, at: [0.5, 0.35] })
  shot('lecture-captions')
  await sleep(11000)
  shot('lecture-captions-later')
  // A note while listening: both columns in view.
  await wide(550)
  await caption(L('边听边记', 'Take notes as you listen'))
  const noteField = q('.lecture-note-input textarea, .lecture-note-input input')
  await click(noteField)
  await type(noteField, L('学习率太大，loss 会震荡', 'Learning rate too high: loss oscillates'), 70)
  await sleep(300)
  await click(q('.lecture-note-input button[type="submit"]'))
  await click(await waitFor(() => withText(L('标为重点', 'Mark as key'), '.lecture-note-actions button')))
  shot('lecture-note')
  await sleep(1500)
  const end = await waitFor(() => withText(L('结束课程', 'End lecture')))
  await sleep(600)
  await click(end)
  await sleep(500)
  const confirm = withText(L('结束课程', 'End lecture'), '.schedule-confirm button, button.danger-text')
  if (confirm && confirm !== end) await click(confirm)
  await waitFor(() => q(`[aria-label="${SAVE}"]`), { timeout: 60000 })
  await caption(L('下课就有重点', 'Key points right after class'), { lead: true })
  await waitFor(() => !q('.lecture-summary-banner') && q('.lecture-summary-option'), {
    speed: 8,
    timeout: 240000,
  })
  await sleep(400)
  const summary = q('.lecture-summary-option')
  summary.scrollIntoView({ block: 'start', behavior: 'smooth' })
  await sleep(800)
  win().scrollBy({ top: -210, behavior: 'smooth' })
  await sleep(700)
  shot('lecture-summary-wide')
  await sleep(1400)
  await focus(summary, { zoom: 1.18, at: [0.5, 0.4] })
  await caption(L('每条重点都带时间和原话', 'Each point links to the time and the quote'))
  shot('lecture-summary')
  await sleep(3400)
  await caption('')
  await wide(500)
  // Name the lecture and keep it.
  const name = q(`[aria-label="${SAVE}"] input[placeholder*="Deep Learning"]`)
  await click(name)
  await type(name, 'Deep Learning', 60)
  await caption(L('存下来，以后再看', 'Save it for later'))
  const save = q(`[aria-label="${SAVE}"] button[type="submit"]`)
  await click(save)
  await waitFor(() => !q(`[aria-label="${SAVE}"]`), { timeout: 30000 })
  await sleep(900)
  shot('lecture-saved')
  await sleep(1500)
  await caption('')
}

// ---- 5 guide ----------------------------------------------------------------------------------

async function guide() {
  await menu(L('HKU 指南', 'HKU guide'), { hint: L('图书馆 · 交通与校园位置 · 学生服务', 'Library · Getting around · Student services') })
  const floors = await waitFor(() => q('.library-floors'))
  await caption(L('HKU 指南：校园里的事，查得到', 'HKU guide: campus answers in one place'), { lead: true })
  await sleep(2200)
  // The whole library, floor by floor.
  const layout = q('.library-layout')
  // Frame the whole model with its floor buttons, so nothing scrolls while floors are chosen.
  const frameOn = async (element, offset) => {
    win().scrollBy({ top: element.getBoundingClientRect().top - offset, behavior: 'smooth' })
    await sleep(750)
  }
  await frameOn(q('.library-stack'), 84)
  await caption(L('Main Library 每一层，点开看', 'Main Library, floor by floor'))
  shot('guide-library')
  await sleep(1800)
  const tabs = all('.library-floor-tabs .floor-tab')
  for (const tab of tabs.slice().reverse()) {
    await click(tab, { stay: 250 })
    await sleep(1000)
  }
  shot('guide-floor')
  // A closer look at one floor's facilities.
  await focus(layout, { zoom: 1.3, at: [0.72, 0.4] })
  await caption(L('这一层有哪些设施、在哪一翼', 'What is on this floor, and in which wing'))
  await sleep(2600)
  await caption('')
  await wide(500)
  // Every facility filter in turn: the floors that have it light up.
  await frameOn(q('.library-filters'), 92)
  await caption(L('找打印、扫描、自习位：点一下，楼层亮起', 'Printing, scanning, study space: floors light up'))
  for (const chip of all('.library-filters .guide-chip')) {
    await click(chip, { stay: 250 })
    await sleep(1500)
    if (chip === all('.library-filters .guide-chip')[0]) shot('guide-print')
  }
  // Printers: which floor, which wing, which number.
  await click(all('.library-filters .guide-chip')[0], { stay: 250 })
  await sleep(700)
  const printers = q('.library-printers')
  if (printers) {
    await focus(printers, { zoom: 1.5 })
    await caption(L('打印机在哪层、哪一翼、几号机', 'Which printer, which floor, which wing'))
    shot('guide-printers')
    await sleep(2800)
    await caption('')
    await wide(500)
  }
  // The rest of the library page: hours, borrowing, rooms, printing.
  await caption(L('开放时间、借书规则、订讨论室、打印', 'Hours, borrowing, room booking, printing'))
  const cards = all('.hku-guide-document .hku-guide-section')
  for (const card of cards.slice(0, 4)) {
    card.scrollIntoView({ block: 'center', behavior: 'smooth' })
    await sleep(1500)
  }
  shot('guide-cards')
  await caption('')
  // Transport and the campus map.
  win().scrollTo({ top: 0, behavior: 'smooth' })
  await sleep(700)
  await click(all('.section-tabs button')[1])
  const map = await waitFor(() => q('.campus-map-image img, .campus-map-image'))
  await sleep(900)
  map.scrollIntoView({ block: 'center', behavior: 'smooth' })
  await sleep(800)
  await caption(L('交通与校园位置：整张校园地图', 'Getting around: the full campus map'), { lead: true })
  shot('guide-map')
  await sleep(2000)
  // Travel across the map, close enough to read the buildings.
  await focus(map, { zoom: 1.9, at: [0.25, 0.45], ms: 900 })
  await sleep(1300)
  await focus(map, { zoom: 1.9, at: [0.75, 0.5], ms: 1800 })
  await sleep(1300)
  await caption('')
  await wide(700)
  const official = q('.campus-map-frame')
  official.scrollIntoView({ block: 'center', behavior: 'smooth' })
  await sleep(900)
  await caption(L('官方在线地图也在页面里', 'The official online map is embedded too'))
  shot('guide-official-map')
  await sleep(2400)
  // How to get there: MTR, bus and minibus, the campus shuttle.
  const facts = all('.hku-guide-document .hku-guide-section')
  const lines = [L('坐港铁：哪个出口最近', 'MTR: which exit is closest'), '', L('巴士和小巴：坐哪几路', 'Buses and minibuses: which routes'), L('校园穿梭巴士：路线', 'Campus shuttle: routes'), L('穿梭巴士：车费与班次', 'Campus shuttle: fares and service')]
  for (const [index, card] of facts.entries()) {
    if (index === 1) continue // shown together with the first card
    card.scrollIntoView({ block: 'center', behavior: 'smooth' })
    await sleep(800)
    await caption(lines[index] || '')
    await focus(card, { zoom: index === 0 ? 1.0 : 1.25 })
    if (index >= 3) shot(`guide-shuttle-${index}`)
    await sleep(2400)
    await wide(450)
  }
  await caption('')
  // Student services.
  win().scrollTo({ top: 0, behavior: 'smooth' })
  await sleep(700)
  await click(all('.section-tabs button')[2])
  await sleep(1300)
  await caption(L('学生证、学费、医疗、心理辅导，也查得到', 'Student card, fees, health, counselling'), { lead: true })
  shot('guide-services')
  await sleep(1400)
  win().scrollBy({ top: 520, behavior: 'smooth' })
  await sleep(1700)
  win().scrollBy({ top: 520, behavior: 'smooth' })
  await sleep(1700)
  await caption('')
  void floors
}

// ---- 7 ending ---------------------------------------------------------------------------------

async function ending() {
  hidePointer()
  win().scrollTo({ top: 0, behavior: 'smooth' })
  q(`.main-nav-link[aria-label^="${L('主页', 'Home')}"]`).click()
  await sleep(1100)
  // The window shrinks to one tidy card.
  $('stage').style.transition = 'background 0.8s'
  $('stage').style.background = '#2b2825'
  const cam = $('cam')
  cam.classList.add('card')
  cam.style.transitionDuration = '900ms'
  const k = 1.08
  cam.style.transform = `translate(${(1920 - W * k) / 2}px, ${(1080 - H * k) / 2}px) scale(${k})`
  await sleep(950)
  await caption(L('一处看完', 'All in one place'), { lead: true })
  shot('ending-card')
  await sleep(2600)
  await caption('')
  $('end-line').textContent = L('留一点时间给生活', 'Make time for life')
  $('ending').style.opacity = 1
  await sleep(900)
  shot('ending')
  await sleep(2800)
}

// ---- running order ----------------------------------------------------------------------------

const SCENES = { opening, home, schedule, mail, lecture, guide, ending }

async function main() {
  await prepare()
  await loadApp()
  await wide(0)
  if (only.length && !only.includes('opening')) $('opening').style.display = 'none'
  for (const [name, scene] of Object.entries(SCENES)) {
    if (only.length && !only.includes(name)) continue
    mark({ type: 'scene', name })
    await scene()
  }
  await sleep(600)
  mark({ type: 'done' })
}

main().catch((error) => {
  mark({ type: 'error', message: String(error && error.stack ? error.stack : error) })
})
