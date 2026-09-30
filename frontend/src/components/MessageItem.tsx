import { useEffect, useState } from 'react'
import { MarkdownRenderer } from './MarkdownRenderer'
import type { Message } from '../types'
import './MessageItem.css'

interface Props {
  message: Message
  streaming?: boolean
  showActions?: boolean
  onRegenerate?: () => void
  onEdit?: (content: string) => void
}

export function MessageItem({
  message,
  streaming,
  showActions,
  onRegenerate,
  onEdit,
}: Props) {
  const isUser = message.role === 'user'
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(message.content)

  useEffect(() => {
    setDraft(message.content)
  }, [message.content])

  return (
    <div className={`msg-row ${isUser ? 'user' : 'assistant'}`}>
      <div className="msg-avatar" aria-hidden>
        {isUser ? '你' : 'AI'}
      </div>
      <div className="msg-body">
        <div className="msg-role">{isUser ? '你' : '助手'}</div>
        {editing ? (
          <div className="msg-edit">
            <textarea
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              rows={4}
            />
            <div className="msg-edit-actions">
              <button
                type="button"
                className="btn-primary"
                disabled={!draft.trim()}
                onClick={() => {
                  onEdit?.(draft.trim())
                  setEditing(false)
                }}
              >
                保存并提交
              </button>
              <button
                type="button"
                className="btn-ghost"
                onClick={() => {
                  setDraft(message.content)
                  setEditing(false)
                }}
              >
                取消
              </button>
            </div>
          </div>
        ) : isUser ? (
          <div className="msg-text">{message.content}</div>
        ) : (
          <div className="msg-text">
            <MarkdownRenderer content={message.content} />
            {streaming && <span className="streaming-cursor" />}
          </div>
        )}

        {showActions && !editing && !streaming && (
          <div className="msg-actions">
            {isUser && onEdit && (
              <button type="button" onClick={() => setEditing(true)}>
                编辑
              </button>
            )}
            {!isUser && onRegenerate && (
              <button type="button" onClick={onRegenerate}>
                重新生成
              </button>
            )}
            <button
              type="button"
              onClick={() => navigator.clipboard.writeText(message.content)}
            >
              复制
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
