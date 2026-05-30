import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import App from './App'

beforeEach(() => {
  ;(window as unknown as { api: unknown }).api = {
    runAgent: vi.fn().mockResolvedValue({ text: '你的网络是通的。', toolCalls: [] })
  }
})

describe('App 对话式', () => {
  it('回车发送：展示用户消息与 agent 回复，并把对话历史传给引擎，输入框清空', async () => {
    render(<App />)
    const box = screen.getByLabelText('问题描述')
    fireEvent.change(box, { target: { value: '我连不上网' } })
    fireEvent.keyDown(box, { key: 'Enter' })

    expect(screen.getByText('我连不上网')).toBeInTheDocument()
    await waitFor(() => expect(screen.getByText('你的网络是通的。')).toBeInTheDocument())
    expect(window.api.runAgent).toHaveBeenCalledWith([{ role: 'user', content: '我连不上网' }])
    expect((box as HTMLTextAreaElement).value).toBe('')
  })

  it('Shift+Enter 不发送（用于换行）', () => {
    render(<App />)
    const box = screen.getByLabelText('问题描述')
    fireEvent.change(box, { target: { value: '换行测试' } })
    fireEvent.keyDown(box, { key: 'Enter', shiftKey: true })
    expect(window.api.runAgent).not.toHaveBeenCalled()
  })
})
