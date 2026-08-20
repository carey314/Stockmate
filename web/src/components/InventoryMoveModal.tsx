import { App, Button, Input, InputNumber, Modal, Segmented, Select } from 'antd'
import { DeleteOutlined, PlusOutlined } from '@ant-design/icons'
import { useEffect, useState } from 'react'
import api from '../api/client'
import { t } from '../lib/i18n'
import { T } from '../theme'

// 出入库/报损（对齐 App 的 /inventory-move 页）：多商品行，循环调 POST /inventory/inbound|outbound。
// 报损/过期/损坏/自用等出库，后端会按成本自动记一笔「库存损耗」开销——利润才真实。
interface SkuOpt {
  skuId: number
  label: string
}
interface Line {
  key: number
  skuId: number | null
  quantity: number | null
}

// 出库原因关键词要命中后端 /报损|过期|损坏|丢失|被偷|变质|自用/ 才会自动记损耗，别改这些词
const OUT_REASONS = ['报损', '过期', '损坏', '丢失', '自用', '其他']
const IN_REASONS = ['进货补录', '客户退回', '盘点纠错', '其他']

let lineKey = 0

export default function InventoryMoveModal({
  open,
  onClose,
  onDone,
}: {
  open: boolean
  onClose: () => void
  onDone: () => void // 完成后让父页刷新列表/预警
}) {
  const { message } = App.useApp()
  const [dir, setDir] = useState<'outbound' | 'inbound'>('outbound')
  const [reason, setReason] = useState('报损')
  const [note, setNote] = useState('')
  const [lines, setLines] = useState<Line[]>([{ key: ++lineKey, skuId: null, quantity: null }])
  const [skuOpts, setSkuOpts] = useState<SkuOpt[]>([])
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!open) return
    setDir('outbound')
    setReason('报损')
    setNote('')
    setLines([{ key: ++lineKey, skuId: null, quantity: null }])
    if (skuOpts.length === 0) {
      api
        .get<{ list: { name: string; skus: { id: number; specText: string }[] }[] }>('/products', { pageSize: 500 })
        .then((d) => {
          const opts: SkuOpt[] = []
          for (const p of d.list) for (const s of p.skus) opts.push({ skuId: s.id, label: `${p.name}${s.specText ? ` ${s.specText}` : ''}` })
          setSkuOpts(opts)
        })
        .catch(() => {})
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  const reasons = dir === 'outbound' ? OUT_REASONS : IN_REASONS

  const submit = async () => {
    const valid = lines.filter((l) => l.skuId && l.quantity && l.quantity > 0)
    if (valid.length === 0) return message.warning(t('至少填一行商品和数量', 'Add at least one line with quantity'))
    if (reason === '其他' && !note.trim()) return message.warning(t('选了「其他」要写清原因', 'Please describe the reason'))
    const reasonText = reason === '其他' ? note.trim() : note.trim() ? `${reason}·${note.trim()}` : reason
    setBusy(true)
    try {
      const results = await Promise.allSettled(
        valid.map((l) => api.post(`/inventory/${dir}`, { skuId: l.skuId, quantity: l.quantity, reason: reasonText })),
      )
      const okN = results.filter((r) => r.status === 'fulfilled').length
      const failN = results.length - okN
      if (failN === 0) {
        message.success(
          dir === 'outbound'
            ? t(`已出库 ${okN} 项${/报损|过期|损坏|丢失|自用/.test(reasonText) ? '，损耗已按成本自动记开销' : ''}`, `${okN} items checked out`)
            : t(`已入库 ${okN} 项`, `${okN} items checked in`),
        )
      } else {
        const first = (results.find((r) => r.status === 'rejected') as PromiseRejectedResult)?.reason?.message ?? ''
        message.warning(t(`成功 ${okN} 项，失败 ${failN} 项（${first}）`, `${okN} ok, ${failN} failed (${first})`))
      }
      onDone()
      onClose()
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal
      open={open}
      onCancel={onClose}
      onOk={submit}
      confirmLoading={busy}
      okText={dir === 'outbound' ? t('确认出库', 'Check out') : t('确认入库', 'Check in')}
      title={t('出入库 / 报损', 'Stock in/out & loss')}
      width={620}
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12, paddingTop: 4 }}>
        <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
          <Segmented
            value={dir}
            onChange={(v) => {
              setDir(v as 'outbound' | 'inbound')
              setReason(v === 'outbound' ? '报损' : '进货补录')
            }}
            options={[
              { label: t('出库（报损/自用）', 'Out (loss/own use)'), value: 'outbound' },
              { label: t('入库', 'In'), value: 'inbound' },
            ]}
          />
          <Select value={reason} onChange={setReason} options={reasons.map((r) => ({ value: r, label: r }))} style={{ width: 110 }} />
          <Input
            placeholder={reason === '其他' ? t('原因（必填）', 'Reason (required)') : t('补充说明（选填）', 'Note (optional)')}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            style={{ width: 200 }}
            maxLength={40}
          />
        </div>
        {dir === 'outbound' && (
          <div style={{ fontSize: 12, color: T.secondary }}>
            {t('报损/过期/损坏/丢失/自用出库，会按成本价自动记一笔「库存损耗」开销，利润里看得见。', 'Loss/expired/own-use checkouts auto-record a cost-based expense so profit stays honest.')}
          </div>
        )}
        {lines.map((l) => (
          <div key={l.key} style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <Select
              showSearch
              placeholder={t('选商品/规格', 'Pick a product/variant')}
              optionFilterProp="label"
              value={l.skuId}
              onChange={(v) => setLines((p) => p.map((x) => (x.key === l.key ? { ...x, skuId: v } : x)))}
              options={skuOpts.map((o) => ({ value: o.skuId, label: o.label }))}
              style={{ flex: 1, minWidth: 0 }}
            />
            <InputNumber
              placeholder={t('数量', 'Qty')}
              min={0.001}
              value={l.quantity}
              onChange={(v) => setLines((p) => p.map((x) => (x.key === l.key ? { ...x, quantity: v } : x)))}
              style={{ width: 110 }}
            />
            <Button
              size="small"
              type="text"
              danger
              icon={<DeleteOutlined />}
              disabled={lines.length === 1}
              onClick={() => setLines((p) => p.filter((x) => x.key !== l.key))}
            />
          </div>
        ))}
        <Button
          size="small"
          icon={<PlusOutlined />}
          onClick={() => setLines((p) => [...p, { key: ++lineKey, skuId: null, quantity: null }])}
          style={{ alignSelf: 'flex-start' }}
        >
          {t('加一行', 'Add line')}
        </Button>
      </div>
    </Modal>
  )
}
