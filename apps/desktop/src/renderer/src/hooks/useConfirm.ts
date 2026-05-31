import { useEffect, useState } from 'react'

export interface ConfirmReq {
  id: number
  description: string
}

/** 订阅 main 的确认请求；弹窗回应后通过 respondConfirm 回传。 */
export function useConfirm(): { request: ConfirmReq | null; respond: (ok: boolean) => void } {
  const [request, setRequest] = useState<ConfirmReq | null>(null)

  useEffect(() => {
    const off = window.api.onConfirm((req) => setRequest(req))
    return off
  }, [])

  function respond(ok: boolean): void {
    setRequest((cur) => {
      if (cur) void window.api.respondConfirm(cur.id, ok)
      return null
    })
  }

  return { request, respond }
}
