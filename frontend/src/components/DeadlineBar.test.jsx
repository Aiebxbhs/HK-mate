import { afterEach, expect, it } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import DeadlineBar, { deadlineLevel, remainingLabel } from './DeadlineBar'

afterEach(cleanup)
const now = new Date('2026-11-13T12:00:00+08:00')
const inDays = (days) => new Date(now.getTime() + days * 86_400_000).toISOString()

it.each([
  [20, 4, 'calm', '充裕'],
  [14, 4, 'calm', '充裕'],
  [7, 50, 'calm', '充裕'],
  [6.9, 51, 'calm', '注意'],
  [3, 79, 'calm', '注意'],
  [2.9, 79, 'soon', '临近'],
  [0.01, 100, 'soon', '临近'],
  [-0.5, 100, 'overdue', '已过期'],
])('%s days left fills %s%% as %s', (days, percent, tone, name) => {
  expect(deadlineLevel(inDays(days), now)).toMatchObject({ percent, tone, name })
})

it('describes the time left in days, hours or minutes', () => {
  expect(remainingLabel(4.5 * 86_400_000)).toBe('还剩 4 天')
  expect(remainingLabel(5 * 3_600_000 + 1)).toBe('还剩 5 小时')
  expect(remainingLabel(90_000)).toBe('还剩 2 分钟')
  expect(remainingLabel(0)).toBe('已过期')
})

it('renders one continuous bar with an accessible value', () => {
  const { container } = render(<DeadlineBar due={inDays(4)} now={now} />)
  const meter = screen.getByRole('meter', { name: '截止进度：注意，还剩 4 天' })
  expect(meter).toHaveAttribute('aria-valuenow', '71')
  expect(container.querySelector('.deadline-fill')).toHaveStyle({ width: '71%' })
  expect(container.querySelector('.deadline-cells')).toBeNull()
})
