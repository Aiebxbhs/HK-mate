import { expect, it } from 'vitest'
import { parseSection, wideSections } from './GuideSection'

const facts = (count) => ({
  blocks: parseSection(Array.from({ length: count }, (_, n) => `- 标签${n}：内容`).join('\n')),
})

it('gives a half-width card that would sit alone the full row', () => {
  // Two short cards share a row; a third one alone takes the full width.
  expect(wideSections([facts(3), facts(3), facts(3)])).toEqual([false, false, true])
  // A lone short card before a long one also takes the full width.
  expect(wideSections([facts(3), facts(8), facts(3), facts(3)])).toEqual([true, true, false, false])
  expect(wideSections([facts(3), facts(3), facts(8)])).toEqual([false, false, true])
})
