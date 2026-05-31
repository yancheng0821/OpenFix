import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react'
import App from './App'

beforeEach(() => {
  ;(window as unknown as { api: unknown }).api = {
    runAgent: vi.fn().mockResolvedValue({
      text: '你的网络是通的。',
      toolCalls: [],
      changes: [],
      rolledBack: false
    }),
    rollback: vi.fn().mockResolvedValue({ ok: true }),
    onConfirm: vi.fn().mockReturnValue(() => {}),
    respondConfirm: vi.fn().mockResolvedValue({ ok: true }),
    getConfig: vi.fn().mockResolvedValue({
      cloud: { baseURL: 'https://x/v1', apiKey: 'k', model: 'm' },
      local: { baseURL: 'http://localhost:11434/v1', model: 'qwen3:8b' }
    }),
    setConfig: vi.fn().mockResolvedValue({ ok: true })
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
    expect(window.api.runAgent).toHaveBeenCalledWith(
      [{ role: 'user', content: '我连不上网' }],
      expect.any(Function)
    )
    expect((box as HTMLTextAreaElement).value).toBe('')
  })

  it('Shift+Enter 不发送（用于换行）', () => {
    render(<App />)
    const box = screen.getByLabelText('问题描述')
    fireEvent.change(box, { target: { value: '换行测试' } })
    fireEvent.keyDown(box, { key: 'Enter', shiftKey: true })
    expect(window.api.runAgent).not.toHaveBeenCalled()
  })

  it('有改动时展示"我改了啥"并能一键还原', async () => {
    ;(window.api.runAgent as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      text: '已把 DNS 改成 1.1.1.1。',
      toolCalls: [],
      changes: [{ id: 1, description: '把 Wi-Fi 的 DNS 设为 1.1.1.1', riskLevel: 'reversible' }],
      rolledBack: false
    })
    render(<App />)
    fireEvent.change(screen.getByLabelText('问题描述'), { target: { value: '上不了网' } })
    fireEvent.keyDown(screen.getByLabelText('问题描述'), { key: 'Enter' })

    await waitFor(() =>
      expect(screen.getByText(/把 Wi-Fi 的 DNS 设为 1\.1\.1\.1/)).toBeInTheDocument()
    )
    fireEvent.click(screen.getByText('一键还原'))
    await waitFor(() => expect(window.api.rollback).toHaveBeenCalled())
    await waitFor(() => expect(screen.getByText('已还原')).toBeInTheDocument())
  })

  it('收到确认请求时弹窗，点确认回传 respondConfirm', () => {
    render(<App />)
    const cb = (window.api.onConfirm as ReturnType<typeof vi.fn>).mock.calls[0][0]
    act(() => cb({ id: 7, description: '关闭挡路的代理' }))
    expect(screen.getByText('关闭挡路的代理')).toBeInTheDocument()
    fireEvent.click(screen.getByText('确认执行'))
    expect(window.api.respondConfirm).toHaveBeenCalledWith(7, true)
  })

  it('打开设置、点保存调用 setConfig', async () => {
    render(<App />)
    fireEvent.click(screen.getByLabelText('设置'))
    await waitFor(() =>
      expect(screen.getByText('云端模型（默认、全能力）')).toBeInTheDocument()
    )
    fireEvent.click(screen.getByText('保存'))
    expect(window.api.setConfig).toHaveBeenCalled()
  })
})
