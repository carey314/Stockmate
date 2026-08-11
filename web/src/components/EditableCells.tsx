import { App, Input, InputNumber } from 'antd'
import { useEffect, useState } from 'react'

// 行内直改单元格：失焦/回车提交，失败回滚原值并报错。乐观更新由 onSave 内部决定。
export function EditNum({
  value,
  onSave,
  prefix,
  precision = 2,
  intOnly = false,
  width = 96,
  placeholder,
  danger,
}: {
  value: number | null
  onSave: (v: number) => Promise<void>
  prefix?: string
  precision?: number
  intOnly?: boolean
  width?: number
  placeholder?: string
  danger?: boolean
}) {
  const { message } = App.useApp()
  const [v, setV] = useState<number | null>(value)
  const [saving, setSaving] = useState(false)
  useEffect(() => setV(value), [value])

  const commit = async () => {
    if (v === null || v === value) {
      setV(value)
      return
    }
    const val = intOnly ? Math.round(v) : v
    setSaving(true)
    try {
      await onSave(val)
      // 成功轻提示（固定 key 去重，连续改只刷新一条不堆叠）
      message.success({ content: '已保存', key: 'cell-save', duration: 1 })
    } catch (e) {
      message.error((e as Error).message)
      setV(value)
    } finally {
      setSaving(false)
    }
  }

  return (
    <InputNumber
      size="small"
      value={v}
      min={0}
      precision={intOnly ? 0 : precision}
      prefix={prefix}
      placeholder={placeholder}
      disabled={saving}
      onChange={setV}
      onBlur={commit}
      onPressEnter={(e) => (e.target as HTMLInputElement).blur()}
      style={{ width, ...(danger ? { borderColor: '#ba1a1a' } : {}) }}
      controls={false}
    />
  )
}

export function EditText({
  value,
  onSave,
  width = 130,
  placeholder,
}: {
  value: string | null
  onSave: (v: string | null) => Promise<void>
  width?: number
  placeholder?: string
}) {
  const { message } = App.useApp()
  const [v, setV] = useState(value ?? '')
  const [saving, setSaving] = useState(false)
  useEffect(() => setV(value ?? ''), [value])

  const commit = async () => {
    const next = v.trim() || null
    if (next === (value ?? null)) {
      setV(value ?? '')
      return
    }
    setSaving(true)
    try {
      await onSave(next)
      message.success({ content: '已保存', key: 'cell-save', duration: 1 })
    } catch (e) {
      message.error((e as Error).message)
      setV(value ?? '')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Input
      size="small"
      value={v}
      placeholder={placeholder}
      disabled={saving}
      onChange={(e) => setV(e.target.value)}
      onBlur={commit}
      onPressEnter={(e) => (e.target as HTMLInputElement).blur()}
      style={{ width }}
    />
  )
}
