export interface Message {
  id: string
  session_id: string
  role: 'user' | 'assistant' | 'system' | string
  content: string
  created_at: string
  parent_id?: string | null
}

export interface Session {
  id: string
  title: string
  model: string
  created_at: string
  updated_at: string
}

export interface SessionDetail extends Session {
  messages: Message[]
}

export interface AppSettings {
  default_model: string
  available_models: string[]
  base_url_configured: boolean
}

export type StreamEvent =
  | { type: 'meta'; message_id: string; model?: string }
  | { type: 'delta'; content: string }
  | { type: 'done'; message_id: string }
  | { type: 'error'; message: string; message_id?: string }
