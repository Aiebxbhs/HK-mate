import { afterEach, expect, it, vi } from 'vitest'
import { api } from './client'

afterEach(() => vi.unstubAllGlobals())

it('gets a CSRF token and sends the mutation with same-origin cookies', async () => {
  const fetch = vi
    .fn()
    .mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ csrf_token: 'csrf-example' }),
    })
    .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ id: 'user' }) })
  vi.stubGlobal('fetch', fetch)
  await api.login({ username: 'student_01', password: 'test-password' })
  expect(fetch.mock.calls[1][0]).toBe('/api/v1/auth/login')
  expect(fetch.mock.calls[1][1]).toMatchObject({
    credentials: 'same-origin',
    headers: { 'X-CSRF-Token': 'csrf-example' },
  })
})

it('turns a non-JSON server error into a usable message', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue({
      ok: false,
      status: 502,
      json: async () => {
        throw new Error('HTML response')
      },
    }),
  )
  await expect(api.me()).rejects.toMatchObject({
    status: 502,
    message: '服务暂时不可用，请稍后重试。',
  })
})
