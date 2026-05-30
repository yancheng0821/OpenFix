import { useState } from 'react'

function App(): React.JSX.Element {
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState('')

  async function handleSubmit(): Promise<void> {
    if (!input.trim() || loading) return
    setLoading(true)
    setResult('')
    try {
      const res = await window.api.runAgent(input)
      setResult(res.text)
    } catch (e) {
      setResult(`出错了：${(e as Error).message}`)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="container">
      <h1>OpenFix</h1>
      <textarea
        aria-label="问题描述"
        value={input}
        onChange={(e) => setInput(e.target.value)}
        placeholder="说说你的问题，比如：我连不上网"
      />
      <button onClick={handleSubmit} disabled={loading}>
        {loading ? '排查中…' : '开始排查'}
      </button>
      {result && <pre aria-label="结果">{result}</pre>}
    </div>
  )
}

export default App
