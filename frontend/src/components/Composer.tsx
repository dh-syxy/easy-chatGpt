import { useEffect, useRef, useState } from 'react'
import './Composer.css'

interface Props {
  disabled?: boolean
  streaming?: boolean
  onSend: (text: string) => void
  onStop: () => void
}

export function Composer({ disabled, streaming, onSend, onStop }: Props) {
  const [text, setText] = useState('')
  const ref = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    const el = ref.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight, 180)}px`
  }, [text])

  const submit = () => {
    const value = text.trim()
    if (!value || disabled || streaming) return
    onSend(value)
    setText('')
  }

  return (
    <div className="composer">
      <div className="composer-box">
        <textarea
          ref={ref}
          value={text}
          placeholder="输入消息…（Enter 发送，Shift+Enter 换行）"
          disabled={disabled || streaming}
          rows={1}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault()
              submit()
            }
          }}
        />
        {streaming ? (
          <button type="button" className="composer-action stop" onClick={onStop}>
            停止生成
          </button>
        ) : (
          <button
            type="button"
            className="composer-action send"
            disabled={!text.trim() || disabled}
            onClick={submit}
          >
            发送
          </button>
        )}
      </div>
      <div className="composer-hint">内容由 AI 生成，请注意甄别。</div>
    </div>
  )
}
