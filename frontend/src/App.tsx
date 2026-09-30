import { useCallback, useEffect, useRef, useState } from 'react'
import {
  api,
  streamChat,
  streamEdit,
  streamRegenerate,
} from './api/client'
import { ChatView } from './components/ChatView'
import { Sidebar } from './components/Sidebar'
import type { AppSettings, Message, Session, StreamEvent } from './types'
import './App.css'

function tempId(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`
}

export default function App() {
  const [sessions, setSessions] = useState<Session[]>([])
  const [activeId, setActiveId] = useState<string | null>(null)
  const [messages, setMessages] = useState<Message[]>([])
  const [title, setTitle] = useState('新对话')
  const [model, setModel] = useState('gpt-4o-mini')
  const [settings, setSettings] = useState<AppSettings | null>(null)
  const [streaming, setStreaming] = useState(false)
  const [streamingId, setStreamingId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [exporting, setExporting] = useState(false)
  const abortRef = useRef<AbortController | null>(null)
  const activeIdRef = useRef<string | null>(null)
  const messagesRef = useRef<Message[]>([])

  useEffect(() => {
    activeIdRef.current = activeId
  }, [activeId])

  useEffect(() => {
    messagesRef.current = messages
  }, [messages])

  const refreshSessions = useCallback(async () => {
    const list = await api.listSessions()
    setSessions(list)
    return list
  }, [])

  const loadSession = useCallback(async (id: string) => {
    const detail = await api.getSession(id)
    setActiveId(detail.id)
    setTitle(detail.title)
    setModel(detail.model)
    setMessages(detail.messages)
    setError(null)
  }, [])

  useEffect(() => {
    ;(async () => {
      try {
        const s = await api.getSettings()
        setSettings(s)
        setModel(s.default_model)
        const list = await refreshSessions()
        if (list.length > 0) {
          await loadSession(list[0].id)
        }
      } catch (e) {
        setError(e instanceof Error ? e.message : '初始化失败')
      }
    })()
  }, [loadSession, refreshSessions])

  const handleCreate = async () => {
    if (streaming) return
    try {
      const created = await api.createSession({ model })
      await refreshSessions()
      await loadSession(created.id)
    } catch (e) {
      setError(e instanceof Error ? e.message : '创建会话失败')
    }
  }

  const handleDelete = async (id: string) => {
    if (streaming) return
    try {
      await api.deleteSession(id)
      const list = await refreshSessions()
      if (activeId === id) {
        if (list.length > 0) {
          await loadSession(list[0].id)
        } else {
          setActiveId(null)
          setMessages([])
          setTitle('新对话')
        }
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : '删除失败')
    }
  }

  const handleModelChange = async (next: string) => {
    setModel(next)
    if (!activeId) return
    try {
      const updated = await api.updateSession(activeId, { model: next })
      setSessions((prev) =>
        prev.map((s) => (s.id === updated.id ? { ...s, ...updated } : s)),
      )
    } catch (e) {
      setError(e instanceof Error ? e.message : '更新模型失败')
    }
  }

  const runStream = async (
    sessionId: string,
    start: (signal: AbortSignal, onEvent: (e: StreamEvent) => void) => Promise<void>,
    options?: {
      baseMessages?: Message[]
      prependUser?: { content: string }
      truncateAfterMessageId?: string
      removeFromMessageId?: string
    },
  ) => {
    setError(null)
    setStreaming(true)

    let workingMessages = [...(options?.baseMessages ?? messagesRef.current)]
    if (options?.truncateAfterMessageId) {
      const idx = workingMessages.findIndex(
        (m) => m.id === options.truncateAfterMessageId,
      )
      if (idx >= 0) {
        workingMessages = workingMessages.slice(0, idx + 1)
        if (options.prependUser) {
          workingMessages[idx] = {
            ...workingMessages[idx],
            content: options.prependUser.content,
          }
        }
      }
    } else if (options?.removeFromMessageId) {
      const idx = workingMessages.findIndex(
        (m) => m.id === options.removeFromMessageId,
      )
      if (idx >= 0) {
        workingMessages = workingMessages.slice(0, idx)
      }
    } else if (options?.prependUser) {
      const userMsg: Message = {
        id: tempId('user'),
        session_id: sessionId,
        role: 'user',
        content: options.prependUser.content,
        created_at: new Date().toISOString(),
      }
      workingMessages = [...workingMessages, userMsg]
    }

    const assistantLocalId = tempId('assistant')
    const assistantMsg: Message = {
      id: assistantLocalId,
      session_id: sessionId,
      role: 'assistant',
      content: '',
      created_at: new Date().toISOString(),
    }
    workingMessages = [...workingMessages, assistantMsg]
    setMessages(workingMessages)
    setStreamingId(assistantLocalId)

    let currentAssistantId = assistantLocalId
    const controller = new AbortController()
    abortRef.current = controller

    try {
      await start(controller.signal, (event) => {
        if (event.type === 'meta') {
          currentAssistantId = event.message_id
          setStreamingId(event.message_id)
          setMessages((prev) =>
            prev.map((m) =>
              m.id === assistantLocalId ? { ...m, id: event.message_id } : m,
            ),
          )
          return
        }
        if (event.type === 'delta') {
          const targetId = currentAssistantId
          setMessages((prev) =>
            prev.map((m) =>
              m.id === targetId || m.id === assistantLocalId
                ? { ...m, content: m.content + event.content }
                : m,
            ),
          )
          return
        }
        if (event.type === 'error') {
          setError(event.message)
        }
      })
      await refreshSessions()
      const detail = await api.getSession(sessionId)
      setTitle(detail.title)
      setModel(detail.model)
      setMessages(detail.messages)
    } catch (e) {
      if ((e as Error).name !== 'AbortError') {
        setError(e instanceof Error ? e.message : '生成失败')
      }
      try {
        const detail = await api.getSession(sessionId)
        setMessages(detail.messages)
        setTitle(detail.title)
      } catch {
        /* ignore */
      }
    } finally {
      setStreaming(false)
      setStreamingId(null)
      abortRef.current = null
    }
  }

  const ensureSession = async (): Promise<string> => {
    if (activeIdRef.current) return activeIdRef.current
    const created = await api.createSession({ model })
    await refreshSessions()
    setActiveId(created.id)
    activeIdRef.current = created.id
    setTitle(created.title)
    setModel(created.model)
    setMessages([])
    messagesRef.current = []
    return created.id
  }

  const handleSend = async (text: string) => {
    if (streaming) return
    try {
      const sessionId = await ensureSession()
      await runStream(
        sessionId,
        (signal, onEvent) =>
          streamChat(sessionId, { content: text, model }, onEvent, signal),
        {
          baseMessages: messagesRef.current,
          prependUser: { content: text },
        },
      )
    } catch (e) {
      setError(e instanceof Error ? e.message : '发送失败')
      setStreaming(false)
    }
  }

  const handleEdit = async (messageId: string, content: string) => {
    if (!activeId || streaming) return
    await runStream(
      activeId,
      (signal, onEvent) =>
        streamEdit(activeId, messageId, { content, model }, onEvent, signal),
      {
        truncateAfterMessageId: messageId,
        prependUser: { content },
      },
    )
  }

  const handleRegenerate = async (messageId: string) => {
    if (!activeId || streaming) return
    await runStream(
      activeId,
      (signal, onEvent) =>
        streamRegenerate(activeId, messageId, { model }, onEvent, signal),
      { removeFromMessageId: messageId },
    )
  }

  const handleStop = () => {
    abortRef.current?.abort()
  }

  const handleExport = async (format: 'docx' | 'pdf') => {
    if (!activeId || exporting || streaming) return
    setExporting(true)
    setError(null)
    try {
      await api.downloadExport(activeId, format)
    } catch (e) {
      setError(e instanceof Error ? e.message : '导出失败')
    } finally {
      setExporting(false)
    }
  }

  const models = settings?.available_models?.length
    ? settings.available_models
    : [model || 'gpt-4o-mini']

  return (
    <div className="app-shell">
      <Sidebar
        sessions={sessions}
        activeId={activeId}
        onSelect={(id) => {
          if (streaming) return
          void loadSession(id)
        }}
        onCreate={() => void handleCreate()}
        onDelete={(id) => void handleDelete(id)}
      />
      <ChatView
        title={title}
        model={model}
        models={models}
        messages={messages}
        streaming={streaming}
        streamingId={streamingId}
        error={error}
        canExport={Boolean(activeId && messages.length > 0)}
        exporting={exporting}
        onModelChange={(m) => void handleModelChange(m)}
        onSend={(t) => void handleSend(t)}
        onStop={handleStop}
        onEdit={(id, content) => void handleEdit(id, content)}
        onRegenerate={(id) => void handleRegenerate(id)}
        onExport={(format) => void handleExport(format)}
      />
    </div>
  )
}
