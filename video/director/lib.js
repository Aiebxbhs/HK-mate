// Camera, mouse pointer, captions and timing for the intro video. The real app runs in the
// iframe; everything here only looks at it, moves the camera over it and clicks it like a user.
//
// Camera rule: zooming in is for showing something for a moment. Before the next action the
// camera pulls back, and anything about to be clicked is brought into view first, so the viewer
// always sees what the pointer does and what happens next.

export const W = 1280
export const H = 720
const BASE = 1.5 // 1280 × 720 app pixels fill the 1920 × 1080 stage
const $ = (id) => document.getElementById(id)
export const frame = $('app')
const params = new URLSearchParams(location.search)
// ?fast=1 shortens pauses while a scene is being worked on.
const FAST = params.has('fast')
const STILLS = params.has('stills')

export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, FAST ? ms / 4 : ms))
/** Messages for the recorder: speed changes, still shots, the end. */
export const mark = (data) => console.log('@@' + JSON.stringify({ ...data, t: Date.now() }))

export const doc = () => frame.contentDocument
export const win = () => frame.contentWindow
export const q = (selector) => doc().querySelector(selector)
export const all = (selector) => [...doc().querySelectorAll(selector)]
/** The first element matching `selector` whose text contains `text`. */
export const withText = (text, selector = 'button') =>
  all(selector).find((element) =>
    (element.innerText ?? element.textContent ?? '').replace(/\s+/g, ' ').includes(text),
  )

export async function waitFor(find, { timeout = 60000, speed = 0, every = 150 } = {}) {
  const started = Date.now()
  let result = find()
  if (!result && speed) setSpeed(speed)
  while (!result) {
    if (Date.now() - started > timeout) {
      setSpeed(0)
      throw new Error('Timed out waiting for: ' + find)
    }
    await new Promise((resolve) => setTimeout(resolve, every))
    result = find()
  }
  if (speed) setSpeed(0)
  return result
}

/** Marks a stretch the recorder plays back faster, with a "×8" badge on screen. */
export function setSpeed(value) {
  $('speed').textContent = value ? `×${value}` : ''
  $('speed').style.opacity = value ? 1 : 0
  mark({ type: 'speed', value: value || 1 })
}

// ---- camera -------------------------------------------------------------------------------

const cam = { k: BASE, tx: 0, ty: 0, fw: W, fh: H }

function apply(ms) {
  $('cam').style.transitionDuration = `${FAST ? ms / 4 : ms}ms`
  $('cam').style.transform = `translate(${cam.tx}px, ${cam.ty}px) scale(${cam.k})`
}

/** Centre the camera on app point (x, y) at `zoom` (1 = the whole page). */
export async function camTo({ x, y, zoom = 1 }, ms = 600) {
  // Screenshots for the README show the whole page: the camera never moves in.
  if (STILLS && cam.fh === H) zoom = 1
  cam.k = BASE * zoom
  const clamp = (value, low) => Math.min(0, Math.max(low, value))
  cam.tx = clamp(960 - x * cam.k, 1920 - cam.fw * cam.k)
  cam.ty = clamp(540 - y * cam.k, 1080 - cam.fh * cam.k)
  apply(ms)
  await sleep(ms)
}
/** Pull back to the whole page. */
export async function wide(ms = 550) {
  if (Math.abs(cam.k - BASE) < 0.001 && cam.fh === H && cam.tx === 0 && cam.ty === 0) return
  await camTo({ x: W / 2, y: H / 2, zoom: 1 }, ms)
}

/** Unroll the whole document and look at it from a little further back, starting at `top`. */
export async function unrollPage({ zoom = 0.82, top = 0, ms = 1300 } = {}) {
  const height = Math.max(H, doc().documentElement.scrollHeight)
  win().scrollTo(0, 0)
  frame.style.height = `${height}px`
  cam.fw = W
  cam.fh = height
  await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))
  cam.k = zoom
  cam.tx = (1920 - W * zoom) / 2
  cam.ty = -top * zoom
  apply(ms)
  await sleep(ms)
  return height
}
/** Glide down an unrolled page until app row `bottom` reaches the foot of the stage. */
export async function glideTo(bottom, ms = 2600) {
  cam.ty = Math.min(0, 1080 - bottom * cam.k)
  $('cam').style.transitionTimingFunction = 'cubic-bezier(0.45, 0, 0.55, 1)'
  apply(ms)
  await sleep(ms)
  $('cam').style.transitionTimingFunction = ''
}
export function normalPage() {
  frame.style.height = `${H}px`
  cam.fw = W
  cam.fh = H
}

const toStage = (x, y) => [cam.tx + x * cam.k, cam.ty + y * cam.k]
function centre(target, at = [0.5, 0.5]) {
  if (!target.getBoundingClientRect) return [target.x, target.y]
  const rect = target.getBoundingClientRect()
  return [rect.left + rect.width * at[0], rect.top + rect.height * at[1]]
}

/** Scroll the app so `element` sits comfortably inside its window. */
export async function intoView(element, { block = 'center' } = {}) {
  const rect = element.getBoundingClientRect()
  if (rect.top < 96 || rect.bottom > H - 96) {
    element.scrollIntoView({ block, behavior: 'smooth' })
    await sleep(650)
  }
}
/** True when the camera currently shows the middle of `element`. */
function onStage(element) {
  const [x, y] = toStage(...centre(element))
  return x > 70 && x < 1850 && y > 70 && y < 1010
}

/** Move the camera in on `target` to show it; nothing is clicked. */
export async function focus(target, { zoom = 1.6, ms = 650, at } = {}) {
  if (target.getBoundingClientRect) await intoView(target)
  const [x, y] = centre(target, at)
  await camTo({ x, y, zoom }, ms)
}

// ---- the mouse pointer --------------------------------------------------------------------

let pointerAt = [1500, 820]
let hideTimer
function placePointer([x, y], ms) {
  clearTimeout(hideTimer)
  pointerAt = [x, y]
  const pointer = $('pointer')
  pointer.style.transitionDuration = `${FAST ? ms / 4 : ms}ms, 250ms`
  pointer.style.transform = `translate(${x}px, ${y}px)`
  pointer.style.opacity = 1
}
/** The pointer leaves the screen when it has nothing to do, so it never covers the content. */
export function hidePointer(after = 0) {
  clearTimeout(hideTimer)
  hideTimer = setTimeout(() => ($('pointer').style.opacity = 0), FAST ? after / 4 : after)
}

async function pointerTo(element, ms = 520) {
  // Whatever is about to be clicked must be visible first. If the camera already shows it,
  // nothing moves; otherwise the app scrolls to it and the camera pulls back.
  if (!onStage(element)) {
    await intoView(element)
    if (!onStage(element)) await wide(450)
  }
  const pointer = $('pointer')
  if (pointer.style.opacity !== '1') {
    // Appear a little away from the target, then travel to it.
    const [x, y] = toStage(...centre(element))
    pointer.style.transitionDuration = '0ms, 0ms'
    pointer.style.transform = `translate(${Math.min(1800, x + 180)}px, ${Math.min(1000, y + 130)}px)`
    void pointer.offsetWidth
  }
  placePointer(toStage(...centre(element)), ms)
  await sleep(ms + 120)
}

async function clickRing() {
  const ring = $('ripple')
  ring.style.transform = `translate(${pointerAt[0]}px, ${pointerAt[1]}px)`
  ring.classList.remove('go')
  void ring.offsetWidth
  ring.classList.add('go')
  $('pointer').classList.add('down')
  await sleep(170)
  $('pointer').classList.remove('down')
}

/** The pointer travels to the element and clicks it, then gets out of the way. */
export async function click(element, { stay = 500 } = {}) {
  await pointerTo(element)
  await clickRing()
  element.click()
  hidePointer(stay)
  await sleep(220)
}

/** Type into a React-controlled field one character at a time. */
export async function type(element, text, perChar = 55) {
  element.focus()
  const proto =
    element.tagName === 'TEXTAREA'
      ? win().HTMLTextAreaElement.prototype
      : win().HTMLInputElement.prototype
  const setValue = Object.getOwnPropertyDescriptor(proto, 'value').set
  let value = element.value
  for (const character of text) {
    value += character
    setValue.call(element, value)
    element.dispatchEvent(new (win().Event)('input', { bubbles: true }))
    await sleep(perChar)
  }
}

/** Set a React-controlled field's whole value at once (date and time fields). */
export function fill(element, value) {
  const proto =
    element.tagName === 'TEXTAREA'
      ? win().HTMLTextAreaElement.prototype
      : win().HTMLInputElement.prototype
  Object.getOwnPropertyDescriptor(proto, 'value').set.call(element, value)
  element.dispatchEvent(new (win().Event)('input', { bubbles: true }))
  element.dispatchEvent(new (win().Event)('change', { bubbles: true }))
}

// ---- captions and menus -------------------------------------------------------------------

export async function caption(text, { lead = false } = {}) {
  const element = $('caption')
  if (element.classList.contains('on')) {
    element.classList.remove('on')
    await sleep(220)
  }
  if (!text) return
  element.textContent = text
  element.classList.toggle('lead', lead)
  element.classList.add('on')
}

/**
 * Open a main menu the way a user would, and show which one: the camera moves in on the menu
 * bar, the pointer clicks the item and its name is shown large, then the camera pulls back.
 */
export async function menu(label, { title = label, hint = '' } = {}) {
  await caption('')
  win().scrollTo({ top: 0, behavior: 'smooth' })
  await wide(450)
  const button = q(`.main-nav-link[aria-label^="${label}"]`)
  await focus(button, { zoom: 1.9, ms: 600 })
  $('menu-name').textContent = title
  $('menu-hint').textContent = hint
  $('menu-title').classList.add('on')
  await click(button, { stay: 700 })
  mark({ type: 'shot', name: `menu-${label}` })
  await sleep(1200)
  $('menu-title').classList.remove('on')
  await wide(600)
  await sleep(350)
}
