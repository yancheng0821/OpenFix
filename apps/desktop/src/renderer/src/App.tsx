import { useEffect, useRef, useState } from 'react'
import './App.css'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import logo from './assets/logo.png'
import { useAgentRun, type RunStep } from './hooks/useAgentRun'
import { useConfirm } from './hooks/useConfirm'
import { useTypewriter } from './hooks/useTypewriter'
import { toolLabel, formatDetail } from './lib/toolLabels'

/** 统一的 markdown 渲染（流式与最终都走它，避免先看到原始星号）。 */
function MD({ children }: { children: string }): React.JSX.Element {
  return (
    <div className="md">
      <ReactMarkdown remarkPlugins={[remarkGfm]}>{children}</ReactMarkdown>
    </div>
  )
}

/** 执行过的步骤清单（运行中实时显示；完成后折叠保留供查看）。 */
function StepList({ steps }: { steps: RunStep[] }): React.JSX.Element {
  return (
    <ul className="timeline">
      {steps.map((s) => {
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
  )
}

const EXAMPLES = ['我连不上网', 'GitHub 打不开', '网速很慢', '电脑好卡']
const PHASE_LABEL: Record<string, string> = {
  thinking: '正在思考…',
  investigating: '正在排查',
  working: '正在操作',
  fixing: '正在修复',
  verifying: '正在复测',
  idle: '正在思考…'
}

interface AppConfig {
  cloud: { baseURL: string; apiKey: string; model: string }
  local: { baseURL: string; model: string }
}

function App(): React.JSX.Element {
  const { messages, run, running, changes, reverted, send, rollback, reset } = useAgentRun()
  const confirm = useConfirm()
  const [input, setInput] = useState('')
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [cfg, setCfg] = useState<AppConfig | null>(null)
  const logRef = useRef<HTMLDivElement>(null)
  // 打字机缓冲：与网络分块解耦，按帧平滑吐字
  const streamed = useTypewriter(run.streamingText, running)

  useEffect(() => {
    const el = logRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [messages, run, running, streamed])

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

  function openSettings(): void {
    void window.api.getConfig().then(setCfg)
    setSettingsOpen(true)
  }
  function updCfg(section: 'cloud' | 'local', key: string, val: string): void {
    setCfg((c) => (c ? { ...c, [section]: { ...c[section], [key]: val } } : c))
  }
  function saveSettings(): void {
    if (cfg) void window.api.setConfig(cfg)
    setSettingsOpen(false)
  }

  const empty = messages.length === 0 && !running
  const lastStep = run.steps[run.steps.length - 1]
  const pillTail = lastStep ? toolLabel(lastStep.tool).label : ''

  return (
    <div className="app">
      <header className="titlebar">
        {messages.length > 0 && (
          <button
            className="titlebar__new"
            onClick={reset}
            disabled={running}
            aria-label="新对话"
            title="新对话"
          >
            ＋ 新对话
          </button>
        )}
        <span className="titlebar__ctr">
          <img className="titlebar__logo" src={logo} alt="" aria-hidden />
          OpenFix
        </span>
        <button className="titlebar__gear" onClick={openSettings} aria-label="设置">
          ⚙
        </button>
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
              {m.role === 'assistant' ? <MD>{m.content}</MD> : m.content}
            </div>
            {m.role === 'assistant' && m.steps && m.steps.length > 0 && (
              <details className="ran">
                <summary className="ran__sum">查看执行过程（{m.steps.length} 步）</summary>
                <StepList steps={m.steps} />
              </details>
            )}
          </div>
        ))}

        {running && (
          <div className="activity" aria-label="排查进度">
            <div className="pill">
              <span className="pulse" aria-hidden />
              {PHASE_LABEL[run.phase] ?? '正在思考…'}
              {pillTail && <span className="pill__tail"> · {pillTail}</span>}
            </div>
            {run.steps.length > 0 && <StepList steps={run.steps} />}
            {run.streamingText && (
              <div className="concl">
                <MD>{streamed}</MD>
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
            placeholder="电脑上的事，尽管跟我说…"
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

      {confirm.request && (
        <div className="modal-overlay">
          <div className="modal">
            <div className="modal__title">需要你确认</div>
            <pre className="modal__desc">{confirm.request.description}</pre>
            <div className="modal__actions">
              <button className="modal__cancel" onClick={() => confirm.respond(false)}>
                取消
              </button>
              <button className="modal__ok" onClick={() => confirm.respond(true)}>
                确认执行
              </button>
            </div>
          </div>
        </div>
      )}

      {settingsOpen && cfg && (
        <div className="modal-overlay">
          <div className="modal">
            <div className="modal__title">设置</div>
            <div className="settings">
              <div className="settings__group">云端模型（默认、全能力）</div>
              <label className="settings__row">
                接口地址
                <input
                  value={cfg.cloud.baseURL}
                  onChange={(e) => updCfg('cloud', 'baseURL', e.target.value)}
                  placeholder="https://…/v1"
                />
              </label>
              <label className="settings__row">
                API Key
                <input
                  type="password"
                  value={cfg.cloud.apiKey}
                  onChange={(e) => updCfg('cloud', 'apiKey', e.target.value)}
                />
              </label>
              <label className="settings__row">
                模型
                <input
                  value={cfg.cloud.model}
                  onChange={(e) => updCfg('cloud', 'model', e.target.value)}
                />
              </label>
              <div className="settings__group">本地模型（可选 · 断网兜底，仅修网络）</div>
              <label className="settings__row">
                接口地址
                <input
                  value={cfg.local.baseURL}
                  onChange={(e) => updCfg('local', 'baseURL', e.target.value)}
                  placeholder="http://localhost:11434/v1"
                />
              </label>
              <label className="settings__row">
                模型
                <input
                  value={cfg.local.model}
                  onChange={(e) => updCfg('local', 'model', e.target.value)}
                  placeholder="qwen3:8b"
                />
              </label>
              <div className="settings__hint">
                可选项，不装也不影响联网正常使用。想让断网时也能用，需自行安装 Ollama
                并执行 ollama pull qwen3:8b——之后联网失败会自动切到它（仅排查网络问题）。
              </div>
              <div className="settings__group">记忆</div>
              <div className="settings__hint">
                OpenFix 会自动记住这台机器的事实和你的偏好（只存非敏感信息），让以后更快帮上忙。
              </div>
              <button
                className="changes__undo"
                style={{ alignSelf: 'flex-start' }}
                onClick={() => void window.api.openMemoryFile()}
              >
                打开记忆文件
              </button>
            </div>
            <div className="modal__actions">
              <button className="modal__cancel" onClick={() => setSettingsOpen(false)}>
                取消
              </button>
              <button className="modal__ok" onClick={saveSettings}>
                保存
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

export default App
