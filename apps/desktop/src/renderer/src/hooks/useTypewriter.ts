import { useEffect, useRef, useState } from 'react'

/** 纯逻辑：给定已显示与目标全文，算出下一帧应显示到的子串。落后越多走越快，靠近时放慢。 */
export function advance(shown: string, target: string): string {
  if (shown.length >= target.length) return target
  const step = Math.max(2, Math.ceil((target.length - shown.length) / 8))
  return target.slice(0, shown.length + step)
}

/**
 * 打字机缓冲：把"已收到的全文"以平滑节奏逐步显示，与网络/IPC 的分块解耦。
 * 不管 provider 一次吐多少，显示都按帧匀速推进；active=false（结束/空闲）时直接显示全文。
 */
export function useTypewriter(target: string, active: boolean): string {
  const [shown, setShown] = useState('')
  const targetRef = useRef(target)
  targetRef.current = target

  useEffect(() => {
    if (!active) {
      setShown(targetRef.current)
      return
    }
    if (typeof requestAnimationFrame !== 'function') {
      setShown(targetRef.current)
      return
    }
    setShown('') // 新一轮从头开始
    let raf = 0
    const tick = (): void => {
      setShown((cur) => advance(cur, targetRef.current))
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [active])

  return shown
}
