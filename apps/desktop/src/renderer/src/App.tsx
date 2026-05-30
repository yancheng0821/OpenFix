import { useEffect, useRef, useState } from 'react'
import './App.css'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import logo from './assets/logo.png'
import { useAgentRun } from './hooks/useAgentRun'
import { toolLabel, formatDetail } from './lib/toolLabels'

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
  const lastStep = run.steps[run.steps.length - 1]
  const pillTail = lastStep ? toolLabel(lastStep.tool).label : ''

  return (
    <div className="app">
      <header className="titlebar">
        <span className="titlebar__ctr">
          <img className="titlebar__logo" src={logo} alt="" aria-hidden />
          OpenFix
        </span>
      </header>

      <div className="log" ref={logRef} aria-label="对话">
        {empty && (
          <div className="empty">
            <img className="empty__mark" src={logo} alt="" aria-hidden />
            <h2 className="empty__title">有什么可以帮你的？</h2>
            <p className="empty__sub">
              电脑、网络上的事，说一句话我来查、来修、修完帮你验证 —— 改了啥都能一键还原。
            </p>
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
            <div className="msg__bubble">
              {m.role === 'assistant' ? (
                <ReactMarkdown remarkPlugins={[remarkGfm]}>{m.content}</ReactMarkdown>
              ) : (
                m.content
              )}
            </div>
          </div>
        ))}

        {running && (
          <div className="activity" aria-label="排查进度">
            <div className="pill">
              <span className="pulse" aria-hidden />
              {PHASE_LABEL[run.phase] ?? '正在排查'}
              {pillTail && <span className="pill__tail"> · {pillTail}</span>}
            </div>
            {run.steps.length > 0 && (
              <ul className="timeline">
                {run.steps.map((s) => {
                  const { label, risk } = toolLabel(s.tool)
                  const detail = s.status === 'done' ? formatDetail(s.tool, s.output) : ''
                  return (
                    <li key={s.id} className="tl">
                      <span className="tl__ts mono">{s.at}</span>
                      <span className={`tl__ic ${s.status === 'done' ? 'done' : `r-${risk}`}`}>
                        {s.status === 'done' ? '✓' : '⏳'}
                      </span>
                      <span className="tl__body">
                        {label}
                        {detail && <span className="tl__val mono">{detail}</span>}
                        {risk === 'write' && s.status === 'done' && (
                          <span className="tl__chip">已快照·可还原</span>
                        )}
                      </span>
                    </li>
                  )
                })}
              </ul>
            )}
            {run.streamingText && (
              <div className="concl">
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
          <div className="changes__title">🛟 我改了这些（可一键还原）</div>
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
        <div className="field">
          <textarea
            aria-label="问题描述"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder="说说你的电脑/网络问题…"
            rows={1}
            disabled={running}
          />
          <button
            className="snd"
            onClick={submit}
            disabled={running || !input.trim()}
            aria-label="发送"
          >
            ↑
          </button>
        </div>
        <div className="hint mono">↩ 发送 · ⇧↩ 换行</div>
      </div>
    </div>
  )
}

export default App
