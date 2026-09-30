import { useRelativeTime } from './MarkdownRenderer'
import type { Session } from '../types'
import './Sidebar.css'

interface Props {
  sessions: Session[]
  activeId: string | null
  onSelect: (id: string) => void
  onCreate: () => void
  onDelete: (id: string) => void
}

function SessionRow({
  session,
  active,
  onSelect,
  onDelete,
}: {
  session: Session
  active: boolean
  onSelect: () => void
  onDelete: () => void
}) {
  const relative = useRelativeTime(session.updated_at)

  return (
    <div className={`session-row ${active ? 'active' : ''}`}>
      <button type="button" className="session-main" onClick={onSelect}>
        <span className="session-title">{session.title || '新对话'}</span>
        <span className="session-time">{relative}</span>
      </button>
      <button
        type="button"
        className="session-delete"
        title="删除对话"
        onClick={(e) => {
          e.stopPropagation()
          if (window.confirm('确定删除该对话？此操作不可恢复。')) {
            onDelete()
          }
        }}
      >
        删除
      </button>
    </div>
  )
}

export function Sidebar({
  sessions,
  activeId,
  onSelect,
  onCreate,
  onDelete,
}: Props) {
  return (
    <aside className="sidebar">
      <div className="sidebar-brand">Easy Chat</div>
      <button type="button" className="new-chat-btn" onClick={onCreate}>
        ＋ 新建聊天
      </button>
      <div className="session-list">
        {sessions.length === 0 && (
          <div className="session-empty">暂无对话，点击上方新建</div>
        )}
        {sessions.map((s) => (
          <SessionRow
            key={s.id}
            session={s}
            active={s.id === activeId}
            onSelect={() => onSelect(s.id)}
            onDelete={() => onDelete(s.id)}
          />
        ))}
      </div>
    </aside>
  )
}
