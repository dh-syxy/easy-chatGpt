import type { AppSettings, Session, SessionDetail, StreamEvent } from '../types'

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    headers: { 'Content-Type': 'application/json', ...(init?.headers || {}) },
    ...init,
  })
  if (!res.ok) {
    let detail = res.statusText
    try {
      const data = await res.json()
      detail = data.detail || JSON.stringify(data)
    } catch {
      /* ignore */
    }
    throw new Error(typeof detail === 'string' ? detail : '请求失败')
  }
  if (res.status === 204) {
    return undefined as T
  }
  return res.json() as Promise<T>
}

export const api = {
  getSettings(): Promise<AppSettings> {
    return request('/api/settings')
  },

  listSessions(): Promise<Session[]> {
    return request('/api/sessions')
  },

  createSession(body?: { title?: string; model?: string }): Promise<Session> {
    return request('/api/sessions', {
      method: 'POST',
      body: JSON.stringify(body || {}),
    })
  },

  getSession(id: string): Promise<SessionDetail> {
    return request(`/api/sessions/${id}`)
  },

  updateSession(
    id: string,
    body: { title?: string; model?: string },
  ): Promise<Session> {
    return request(`/api/sessions/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(body),
    })
  },

  deleteSession(id: string): Promise<{ ok: boolean }> {
    return request(`/api/sessions/${id}`, { method: 'DELETE' })
  },

  /** 下载会话导出文件（docx / pdf） */
  async downloadExport(
    id: string,
    format: 'docx' | 'pdf',
  ): Promise<void> {
    const res = await fetch(`/api/sessions/${id}/export?format=${format}`)
    if (!res.ok) {
      let detail = res.statusText
      try {
        const data = await res.json()
        detail = data.detail || detail
      } catch {
        /* ignore */
      }
      throw new Error(typeof detail === 'string' ? detail : '导出失败')
    }

    const blob = await res.blob()
    const disposition = res.headers.get('Content-Disposition') || ''
    let filename = `chat.${format}`
    const utf8Match = /filename\*=UTF-8''([^;]+)/i.exec(disposition)
    const asciiMatch = /filename="([^"]+)"/i.exec(disposition)
    if (utf8Match?.[1]) {
      filename = decodeURIComponent(utf8Match[1])
    } else if (asciiMatch?.[1]) {
      filename = asciiMatch[1]
    }

    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = filename
    document.body.appendChild(a)
    a.click()
    a.remove()
    URL.revokeObjectURL(url)
  },
}

/** 解析 SSE 流并回调事件 */
export async function consumeSSE(
  response: Response,
  onEvent: (event: StreamEvent) => void,
  signal?: AbortSignal,
): Promise<void> {
  if (!response.ok || !response.body) {
    let detail = response.statusText
    try {
      const data = await response.json()
      detail = data.detail || detail
    } catch {
      /* ignore */
    }
    throw new Error(typeof detail === 'string' ? detail : '流式请求失败')
  }

  const reader = response.body.getReader()
  const decoder = new TextDecoder('utf-8')
  let buffer = ''

  const handleBlock = (block: string) => {
    for (const line of block.split('\n')) {
      const trimmed = line.trim()
      if (!trimmed.startsWith('data:')) continue
      const raw = trimmed.slice(5).trim()
      if (!raw || raw === '[DONE]') continue
      try {
        const event = JSON.parse(raw) as StreamEvent
        onEvent(event)
      } catch {
        /* 忽略不完整 JSON */
      }
    }
  }

  try {
    while (true) {
      if (signal?.aborted) {
        await reader.cancel()
        break
      }
      const { done, value } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      const parts = buffer.split('\n\n')
      buffer = parts.pop() || ''
      for (const part of parts) {
        handleBlock(part)
      }
    }
    if (buffer.trim()) {
      handleBlock(buffer)
    }
  } finally {
    reader.releaseLock()
  }
}

export async function streamChat(
  sessionId: string,
  body: { content: string; model?: string },
  onEvent: (event: StreamEvent) => void,
  signal?: AbortSignal,
): Promise<void> {
  const res = await fetch(`/api/sessions/${sessionId}/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal,
  })
  await consumeSSE(res, onEvent, signal)
}

export async function streamEdit(
  sessionId: string,
  messageId: string,
  body: { content: string; model?: string },
  onEvent: (event: StreamEvent) => void,
  signal?: AbortSignal,
): Promise<void> {
  const res = await fetch(
    `/api/sessions/${sessionId}/messages/${messageId}/edit`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal,
    },
  )
  await consumeSSE(res, onEvent, signal)
}

export async function streamRegenerate(
  sessionId: string,
  messageId: string,
  body: { model?: string },
  onEvent: (event: StreamEvent) => void,
  signal?: AbortSignal,
): Promise<void> {
  const res = await fetch(
    `/api/sessions/${sessionId}/messages/${messageId}/regenerate`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal,
    },
  )
  await consumeSSE(res, onEvent, signal)
}
