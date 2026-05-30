import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import App from './App'

beforeEach(() => {
  ;(window as unknown as { api: unknown }).api = {
    runAgent: vi.fn().mockResolvedValue({ text: '你的网络是通的。', toolCalls: [] })
  }
})

describe('App', () => {
  it('提交问题后调用引擎并展示返回的结论', async () => {
    render(<App />)
    fireEvent.change(screen.getByLabelText('问题描述'), { target: { value: '我连不上网' } })
    fireEvent.click(screen.getByText('开始排查'))

    await waitFor(() =>
      expect(screen.getByLabelText('结果')).toHaveTextContent('你的网络是通的。')
    )
    expect(window.api.runAgent).toHaveBeenCalledWith('我连不上网')
  })
})
