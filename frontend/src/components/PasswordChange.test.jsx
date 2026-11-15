import { afterEach, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import PasswordChange from './PasswordChange'
import { api, ApiError } from '../api/client'

vi.mock('../api/client', async (original) => ({
  ApiError: (await original()).ApiError,
  api: { changePassword: vi.fn() },
}))

afterEach(() => {
  cleanup()
  vi.resetAllMocks()
})

async function fill(user, current, next, confirmation = next) {
  await user.type(screen.getByLabelText('当前密码'), current)
  await user.type(screen.getByLabelText('新密码'), next)
  await user.type(screen.getByLabelText('确认新密码'), confirmation)
  await user.click(screen.getByRole('button', { name: '更新密码' }))
}

it('changes the password and clears the form', async () => {
  api.changePassword.mockResolvedValue(null)
  render(<PasswordChange username="student_01" />)
  const user = userEvent.setup()
  await fill(user, 'old-example-password', 'new-example-password')
  expect(api.changePassword).toHaveBeenCalledWith({
    current_password: 'old-example-password',
    new_password: 'new-example-password',
  })
  expect(await screen.findByRole('status')).toHaveTextContent('其他设备上的登录已退出')
  expect(screen.getByLabelText('当前密码')).toHaveValue('')
  expect(screen.getByLabelText('新密码')).toHaveValue('')
})

it('checks the confirmation and an unchanged password before sending', async () => {
  render(<PasswordChange username="student_01" />)
  const user = userEvent.setup()
  await fill(user, 'old-example-password', 'new-example-password', 'different-password')
  expect(screen.getByRole('alert')).toHaveTextContent('两次输入的新密码不一致')
  await user.clear(screen.getByLabelText('新密码'))
  await user.clear(screen.getByLabelText('确认新密码'))
  await user.type(screen.getByLabelText('新密码'), 'old-example-password')
  await user.type(screen.getByLabelText('确认新密码'), 'old-example-password')
  await user.click(screen.getByRole('button', { name: '更新密码' }))
  expect(screen.getByRole('alert')).toHaveTextContent('新密码不能与当前密码相同')
  expect(api.changePassword).not.toHaveBeenCalled()
})

it('shows the server error and keeps what was typed', async () => {
  api.changePassword.mockRejectedValue(
    new ApiError('当前密码不正确。', 400, 'INVALID_CURRENT_PASSWORD'),
  )
  render(<PasswordChange username="student_01" />)
  const user = userEvent.setup()
  await fill(user, 'wrong-example-password', 'new-example-password')
  expect(await screen.findByRole('alert')).toHaveTextContent('当前密码不正确')
  expect(screen.getByLabelText('新密码')).toHaveValue('new-example-password')
})
