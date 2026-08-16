import { App, Button, Typography } from 'antd'
import { ClearOutlined, SendOutlined } from '@ant-design/icons'
import { useEffect, useRef, useState } from 'react'
import api from '../../api/client'
import { T } from '../../theme'
import { t } from '../../lib/i18n'
import { AiQuotaTag, handleAiQuotaError } from '../../components/AiQuota'
import { refreshEntitlement } from '../../hooks/useEntitlement'

interface Msg {
  role: 'user' | 'assistant'
  content: string
  status?: 'loading' | 'error'
}

const STORE_KEY = 'sm_ai_chat' // sessionStorage 镜像：窄屏 Drawer 卸载重挂时聊天不丢
const QUICK = [
  t('今天卖了多少', 'How much did I sell today'),
  t('谁欠我钱', 'Who owes me money'),
  t('什么货该补了', 'What needs restocking'),
]

function loadMsgs(): Msg[] {
  try {
    const raw = sessionStorage.getItem(STORE_KEY)
    const arr = raw ? (JSON.parse(raw) as Msg[]) : []
    return arr.filter((m) => m.status !== 'loading') // 挂起中的占位不恢复
  } catch {
    return []
  }
}

export default function AiChatPanel() {
  const { modal } = App.useApp()
  const [msgs, setMsgs] = useState<Msg[]>(loadMsgs)
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  const lastQuestion = useRef<string>('')
  const listRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    sessionStorage.setItem(STORE_KEY, JSON.stringify(msgs))
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight })
  }, [msgs])

  const send = async (q: string) => {
    const question = q.trim()
    if (question.length < 2 || busy) return
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
      refreshEntitlement()
      setMsgs((p) => [...p.slice(0, -1), { role: 'assistant', content: data.answer }])
    } catch (e) {
      handleAiQuotaError(e, modal, true)
      const raw = (e as Error).message
      const friendly = raw.includes('timeout')
        ? t('AI 想久了没回来，网络可能不稳', 'AI took too long to answer — the network may be unstable')
        : raw
      setMsgs((p) => [...p.slice(0, -1), { role: 'assistant', content: friendly, status: 'error' }])
    } finally {
      setBusy(false)
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
            onClick={() => setMsgs([])}
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
