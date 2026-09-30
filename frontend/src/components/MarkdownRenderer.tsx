import { useCallback, useEffect, useRef, useState } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import rehypeHighlight from 'rehype-highlight'
import type { Components } from 'react-markdown'
import 'highlight.js/styles/github.css'
import './MarkdownRenderer.css'

interface Props {
  content: string
}

function CodeBlock({
  className,
  children,
}: {
  className?: string
  children?: React.ReactNode
}) {
  const [copied, setCopied] = useState(false)
  const text = String(children ?? '').replace(/\n$/, '')
  const lang = /language-(\w+)/.exec(className || '')?.[1]

  const onCopy = async () => {
    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      /* ignore */
    }
  }

  // 行内代码
  if (!className) {
    return <code className="md-inline-code">{children}</code>
  }

  return (
    <div className="md-code-wrap">
      <div className="md-code-bar">
        <span>{lang || 'code'}</span>
        <button type="button" onClick={onCopy}>
          {copied ? '已复制' : '复制'}
        </button>
      </div>
      <pre className="md-pre">
        <code className={className}>{children}</code>
      </pre>
    </div>
  )
}

const components: Components = {
  code({ className, children }) {
    return <CodeBlock className={className}>{children}</CodeBlock>
  },
  a({ href, children }) {
    return (
      <a href={href} target="_blank" rel="noreferrer">
        {children}
      </a>
    )
  },
}

export function MarkdownRenderer({ content }: Props) {
  return (
    <div className="md-body">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[rehypeHighlight]}
        components={components}
      >
        {content || ' '}
      </ReactMarkdown>
    </div>
  )
}

/** 相对时间展示 */
export function useRelativeTime(iso: string): string {
  const format = useCallback((value: string) => {
    const t = new Date(value).getTime()
    if (Number.isNaN(t)) return ''
    const diff = Date.now() - t
    const sec = Math.floor(diff / 1000)
    if (sec < 60) return '刚刚'
    const min = Math.floor(sec / 60)
    if (min < 60) return `${min} 分钟前`
    const hour = Math.floor(min / 60)
    if (hour < 24) return `${hour} 小时前`
    const day = Math.floor(hour / 24)
    if (day < 7) return `${day} 天前`
    return new Date(value).toLocaleDateString('zh-CN')
  }, [])

  const [text, setText] = useState(() => format(iso))
  const isoRef = useRef(iso)

  useEffect(() => {
    isoRef.current = iso
    setText(format(iso))
    const id = window.setInterval(() => setText(format(isoRef.current)), 60000)
    return () => window.clearInterval(id)
  }, [iso, format])

  return text
}
