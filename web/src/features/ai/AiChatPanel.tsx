import { App, Button, Typography } from 'antd'
import { ClearOutlined, SendOutlined } from '@ant-design/icons'
import { useEffect, useRef, useState } from 'react'
import api from '../../api/client'
import { SS } from '../../lib/storage'
import { useAuth } from '../../auth'
import { sessionSnapshot, isCurrentSession } from '../../lib/session'
import { T } from '../../theme'
import { t } from '../../lib/i18n'
import { AiQuotaTag, handleAiQuotaError } from '../../components/AiQuota'
import { refreshEntitlement } from '../../hooks/useEntitlement'

interface Msg {
  role: 'user' | 'assistant'
  content: string
  status?: 'loading' | 'error'
}

// 只恢复明确属于当前店铺/账号的缓存，旧版无身份缓存直接清理。
const QUICK = [
  t('今天卖了多少', 'How much did I sell today'),
  t('谁欠我钱', 'Who owes me money'),
  t('什么货该补了', 'What needs restocking'),
]

function loadMsgs(storeKey: string): Msg[] {
  sessionStorage.removeItem(SS.legacyChat)
  try {
    const raw = sessionStorage.getItem(storeKey)
    const arr = raw ? (JSON.parse(raw) as Msg[]) : []
    return arr.filter((m) => m.status !== 'loading') // 挂起中的占位不恢复
  } catch {
    return []
  }
}

export default function AiChatPanel() {
  const { user, profile } = useAuth()
  const key = `${SS.chatPrefix}${profile?.storeId ?? 'account'}:${user?.id ?? 'none'}`
  if (!user) return null
  return <IdentityChat key={`${key}:${sessionSnapshot().revision}`} storeKey={key} />
}

function IdentityChat({ storeKey }: { storeKey: string }) {
  const { modal } = App.useApp()
  const [msgs, setMsgs] = useState<Msg[]>(() => loadMsgs(storeKey))
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  const lastQuestion = useRef<string>('')
  const requestVersion = useRef(0)
  useEffect(() => () => { requestVersion.current++ }, [])
  const listRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    sessionStorage.setItem(storeKey, JSON.stringify(msgs))
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight })
  }, [msgs, storeKey])

  const send = async (q: string) => {
    const question = q.trim()
    if (question.length < 2 || busy) return
    const snapshot = sessionSnapshot()
    const version = ++requestVersion.current
    const current = () => version === requestVersion.current && isCurrentSession(snapshot)
    lastQuestion.current = question
    setBusy(true)
    setInput('')
    // history：只带成功轮次（过滤 error），最近 6 条（后端上限）
    const history = msgs
      .filter((m) => !m.status)
      .slice(-6)
      .map((m) => ({ role: m.role, content: m.content }))
    setMsgs((p) => [...p, { role: 'user', content: question }, { role: 'assistant', content: '', status: 'loading' }])
    try {
      const data = await api.post<{ answer: string }>('/ai/ask', { question, history })
      if (!current()) return
      refreshEntitlement()
      setMsgs((p) => [...p.slice(0, -1), { role: 'assistant', content: data.answer }])
    } catch (e) {
      if (!current()) return
      handleAiQuotaError(e, modal, true)
      const raw = (e as Error).message
      const friendly = raw.includes('timeout')
        ? t('AI 想久了没回来，网络可能不稳', 'AI took too long to answer — the network may be unstable')
        : raw
      setMsgs((p) => [...p.slice(0, -1), { role: 'assistant', content: friendly, status: 'error' }])
    } finally {
      if (current()) setBusy(false)
    }
  }

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        // 高度由 RightPanel 的拖拽分隔条分配（sm_panel_ratio），这里只负责填满
        height: '100%',
        minHeight: 0,
      }}
    >
      <div
        style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}
      >
        <Typography.Text strong style={{ fontSize: 17 }}>
          ✨ {t('AI 问生意', 'Ask AI')}
        </Typography.Text>
        <span style={{ marginLeft: 'auto', marginRight: 6 }}><AiQuotaTag bucket="other" /></span>
        {msgs.length > 0 && (
          <Button
            size="small"
            type="text"
            icon={<ClearOutlined />}
            title={t('清空对话', 'Clear conversation')}
            onClick={() => { requestVersion.current++; setMsgs([]); setBusy(false) }}
          />
        )}
      </div>
      <div ref={listRef} style={{ flex: 1, overflowY: 'auto', paddingRight: 4, minHeight: 0 }}>
        {msgs.length === 0 ? (
          <div>
            <Typography.Text type="secondary" style={{ fontSize: 12.5 }}>
              {t(
                '基于你店里的真实经营数据回答，答不了会诚实说。试试：',
                'Answers come from your real store data, and it will say so when it cannot answer. Try:',
              )}
            </Typography.Text>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 10 }}>
              {QUICK.map((q) => (
                <span
                  key={q}
                  onClick={() => send(q)}
                  style={{
                    padding: '5px 12px',
                    borderRadius: 999,
                    background: T.surfaceContainer,
                    color: T.primary,
                    fontSize: 12.5,
                    fontWeight: 600,
                    cursor: 'pointer',
                  }}
                >
                  {q}
                </span>
              ))}
            </div>
          </div>
        ) : (
          msgs.map((m, i) => (
            <div
              key={i}
              style={{
                display: 'flex',
                justifyContent: m.role === 'user' ? 'flex-end' : 'flex-start',
                marginBottom: 10,
              }}
            >
              <div
                style={{
                  maxWidth: '86%',
                  padding: '8px 12px',
                  fontSize: 13,
                  lineHeight: '20px',
                  whiteSpace: 'pre-wrap',
                  wordBreak: 'break-word',
                  ...(m.role === 'user'
                    ? { background: T.primary, color: '#fff', borderRadius: '16px 4px 16px 16px' }
                    : m.status === 'error'
                      ? {
                          background: T.errorContainer,
                          color: T.error,
                          borderRadius: '4px 16px 16px 16px',
                        }
                      : {
                          background: T.surfaceContainerLow,
                          color: T.onSurface,
                          borderRadius: '4px 16px 16px 16px',
                        }),
                }}
              >
                {m.status === 'loading' ? (
                  <span className="ai-dots">
                    <span />
                    <span />
                    <span />
                  </span>
                ) : (
                  <>
                    {m.content}
                    {m.status === 'error' && (
                      <div>
                        <Button
                          size="small"
                          style={{ marginTop: 6 }}
                          onClick={() => send(lastQuestion.current)}
                        >
                          {t('重试', 'Retry')}
                        </Button>
                      </div>
                    )}
                  </>
                )}
              </div>
            </div>
          ))
        )}
      </div>
      <div style={{ paddingTop: 10, flexShrink: 0 }}>
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            background: '#fff',
            border: `1px solid ${T.outlineVariant}`,
            borderRadius: 20,
            padding: '4px 6px 4px 16px',
          }}
        >
          {/* 原生 input：antd Input 的 borderless 在 focus 时仍有蓝边框会裁掉首字，换原生彻底干净 */}
          <input
            placeholder={t('问问你的生意…', 'Ask about your business…')}
            value={input}
            disabled={busy}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && send(input)}
            style={{
              flex: 1,
              minWidth: 0,
              border: 'none',
              outline: 'none',
              background: 'transparent',
              fontSize: 13,
              padding: '6px 0 6px 2px',
              color: T.onSurface,
            }}
          />
          <Button
            type="primary"
            shape="circle"
            size="small"
            icon={<SendOutlined />}
            loading={busy}
            onClick={() => send(input)}
            style={{ width: 32, height: 32, flexShrink: 0 }}
          />
        </div>
      </div>
    </div>
  )
}
