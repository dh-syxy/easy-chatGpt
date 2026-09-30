import { useEffect, useRef, useState } from 'react'
import { Composer } from './Composer'
import { MessageItem } from './MessageItem'
import type { Message } from '../types'
import './ChatView.css'

interface Props {
  title: string
  model: string
  models: string[]
  messages: Message[]
  streaming: boolean
  streamingId: string | null
  error: string | null
  canExport: boolean
  exporting: boolean
  onModelChange: (model: string) => void
  onSend: (text: string) => void
  onStop: () => void
  onEdit: (messageId: string, content: string) => void
  onRegenerate: (messageId: string) => void
  onExport: (format: 'docx' | 'pdf') => void
}

export function ChatView({
  title,
  model,
  models,
  messages,
  streaming,
  streamingId,
  error,
  canExport,
  exporting,
  onModelChange,
  onSend,
  onStop,
  onEdit,
  onRegenerate,
  onExport,
}: Props) {
  const bottomRef = useRef<HTMLDivElement>(null)
  const exportRef = useRef<HTMLDivElement>(null)
  const [exportOpen, setExportOpen] = useState(false)

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, streaming])

  useEffect(() => {
    if (!exportOpen) return
    const onClick = (e: MouseEvent) => {
      if (!exportRef.current?.contains(e.target as Node)) {
        setExportOpen(false)
      }
    }
    document.addEventListener('mousedown', onClick)
    return () => document.removeEventListener('mousedown', onClick)
  }, [exportOpen])

  return (
    <main className="chat-view">
      <header className="chat-header">
        <h1 className="chat-title">{title || '新对话'}</h1>
        <div className="chat-header-actions">
          <div className="export-wrap" ref={exportRef}>
            <button
              type="button"
              className="export-btn"
              disabled={!canExport || exporting || streaming}
              title={canExport ? '下载当前对话' : '暂无可导出的对话'}
              onClick={() => setExportOpen((v) => !v)}
            >
              {exporting ? '导出中…' : '下载对话'}
            </button>
            {exportOpen && (
              <div className="export-menu" role="menu">
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    setExportOpen(false)
                    onExport('docx')
                  }}
                >
                  保存为 Word（.docx）
                </button>
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    setExportOpen(false)
                    onExport('pdf')
                  }}
                >
                  保存为 PDF（.pdf）
                </button>
              </div>
            )}
          </div>
          <label className="model-select">
            <span>模型</span>
            <select
              value={model}
              disabled={streaming}
              onChange={(e) => onModelChange(e.target.value)}
            >
              {models.map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </select>
          </label>
        </div>
      </header>

      <div className="chat-scroll">
        {messages.length === 0 ? (
          <div className="chat-empty">
            <div className="chat-empty-brand">Easy Chat</div>
            <p>有什么可以帮忙的？</p>
          </div>
        ) : (
          messages.map((m) => (
            <MessageItem
              key={m.id}
              message={m}
              streaming={streaming && m.id === streamingId}
              showActions={!streaming}
              onEdit={
                m.role === 'user' ? (content) => onEdit(m.id, content) : undefined
              }
              onRegenerate={
                m.role === 'assistant' ? () => onRegenerate(m.id) : undefined
              }
            />
          ))
        )}
        {error && <div className="chat-error">{error}</div>}
        <div ref={bottomRef} />
      </div>

      <Composer streaming={streaming} onSend={onSend} onStop={onStop} />
    </main>
  )
}
