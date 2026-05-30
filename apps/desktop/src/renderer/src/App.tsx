import { useEffect, useRef, useState } from 'react'
import './App.css'

interface ChatMessage {
  role: 'user' | 'assistant'
  content: string
}

function App(): React.JSX.Element {
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const logRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const el = logRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [messages, loading])

  async function handleSubmit(): Promise<void> {
    const text = input.trim()
    if (!text || loading) return
    const history: ChatMessage[] = [...messages, { role: 'user', content: text }]
    setMessages(history)
    setInput('')
    setLoading(true)
    try {
      const res = await window.api.runAgent(history)
      setMessages((prev) => [...prev, { role: 'assistant', content: res.text }])
    } catch (e) {
      setMessages((prev) => [
        ...prev,
        { role: 'assistant', content: `出错了：${(e as Error).message}` }
      ])
    } finally {
      setLoading(false)
    }
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>): void {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      void handleSubmit()
    }
  }

  return (
    <div className="chat">
      <header className="chat__header">OpenFix</header>

      <div className="chat__log" ref={logRef} aria-label="对话">
        {messages.length === 0 && (
          <p className="chat__empty">说说你的电脑/网络问题，比如：我连不上网</p>
        )}
        {messages.map((m, i) => (
          <div key={i} className={`msg msg--${m.role}`}>
            <pre className="msg__content">{m.content}</pre>
          </div>
        ))}
        {loading && (
          <div className="msg msg--assistant">
            <span className="msg__typing">排查中…</span>
          </div>
        )}
      </div>

      <div className="chat__input">
        <textarea
          aria-label="问题描述"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="回车发送，Shift+Enter 换行"
          rows={2}
        />
        <button onClick={() => void handleSubmit()} disabled={loading || !input.trim()}>
          发送
        </button>
      </div>
    </div>
  )
}

export default App
