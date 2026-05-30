import { useEffect, useRef, useState } from 'react'
import './App.css'
import { useAgentRun } from './hooks/useAgentRun'
import { toolLabel } from './lib/toolLabels'

const EXAMPLES = ['我连不上网', 'GitHub 打不开', '网速很慢', '电脑好卡']
const PHASE_LABEL: Record<string, string> = {
  investigating: '正在排查',
  fixing: '正在修复',
  verifying: '正在复测',
  idle: '正在排查'
}

function App(): React.JSX.Element {
  const { messages, run, running, changes, reverted, send, rollback } = useAgentRun()
  const [input, setInput] = useState('')
  const logRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const el = logRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [messages, run, running])

  function submit(): void {
    const t = input.trim()
    if (!t || running) return
    setInput('')
    void send(t)
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>): void {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      submit()
    }
  }

  const empty = messages.length === 0 && !running
  const currentStep = run.steps.length > 0 ? toolLabel(run.steps[run.steps.length - 1]).label : ''

  return (
    <div className="app">
      <header className="titlebar">
        <span className="titlebar__logo" aria-hidden />
        <span className="titlebar__name">OpenFix</span>
      </header>

      <div className="log" ref={logRef} aria-label="对话">
        {empty && (
          <div className="empty">
            <div className="empty__mark" aria-hidden />
            <h2 className="empty__title">电脑哪儿不舒服？</h2>
            <p className="empty__sub">说一句话，我来查、来修，全程可一键还原。</p>
            <div className="empty__chips">
              {EXAMPLES.map((ex) => (
                <button key={ex} className="chip" onClick={() => setInput(ex)}>
                  {ex}
                </button>
              ))}
            </div>
          </div>
        )}

        {messages.map((m, i) => (
          <div key={i} className={`msg msg--${m.role}`}>
            <div className="msg__bubble">{m.content}</div>
          </div>
        ))}

        {running && (
          <div className="activity" aria-label="排查进度">
            <div className="activity__pill">
              <span className="pulse" aria-hidden />
              {PHASE_LABEL[run.phase] ?? '正在排查'}
              {currentStep && <span className="activity__cur"> · {currentStep}</span>}
            </div>
            {run.steps.length > 0 && (
              <ul className="timeline">
                {run.steps.map((tool, i) => {
                  const { label, risk } = toolLabel(tool)
                  return (
                    <li key={i} className={`tl tl--${risk}`}>
                      <span className="tl__dot" aria-hidden />
                      {label}
                    </li>
                  )
                })}
              </ul>
            )}
            {run.streamingText && (
              <div className="streaming">
                {run.streamingText}
                <span className="caret" aria-hidden>
                  ▍
                </span>
              </div>
            )}
          </div>
        )}
      </div>

      {changes.length > 0 && (
        <div className="changes" aria-label="本次改动">
          <div className="changes__title">我改了这些（可还原）：</div>
          <ul className="changes__list">
            {changes.map((c) => (
              <li key={c.id}>{c.description}</li>
            ))}
          </ul>
          <button className="changes__undo" onClick={() => void rollback()}>
            一键还原
          </button>
        </div>
      )}
      {reverted && <div className="changes changes--reverted">已还原</div>}

      <div className="composer">
        <textarea
          aria-label="问题描述"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder="回车发送，Shift+Enter 换行"
          rows={1}
          disabled={running}
        />
        <button
          className="composer__send"
          onClick={submit}
          disabled={running || !input.trim()}
          aria-label="发送"
        >
          ↑
        </button>
      </div>
    </div>
  )
}

export default App
