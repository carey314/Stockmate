import { App, Button, InputNumber, Modal, Select, Spin } from 'antd'
import { DeleteOutlined, PlusOutlined } from '@ant-design/icons'
import { useEffect, useState } from 'react'
import api from '../api/client'
import { fmtQty } from '../lib/format'
import { t } from '../lib/i18n'
import { T } from '../theme'

// 配方（一级 BOM）：卖这个成品时扣原料库存不扣自身。GET/PUT /skus/:id/recipe（后端现成）。
// 后端守卫：不能含自己、原料不能再是成品（拒多级）、上限 30 行——这里不重复实现只透传报错。
interface RecipeRow {
  componentSkuId: number
  qty: number
  productName?: string
  specText?: string
  unit?: string
  stock?: number
}
interface SkuOpt {
  skuId: number
  label: string
}

let rowKey = 0

export default function RecipeModal({
  sku,
  skuOpts,
  onClose,
}: {
  sku: { id: number; label: string } | null
  skuOpts: SkuOpt[]
  onClose: () => void
}) {
  const { message } = App.useApp()
  const [rows, setRows] = useState<(RecipeRow & { key: number })[]>([])
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!sku) return
    setLoading(true)
    api
      .get<RecipeRow[]>(`/skus/${sku.id}/recipe`)
      .then((d) => setRows(d.map((r) => ({ ...r, key: ++rowKey }))))
      .catch((e) => message.error((e as Error).message))
      .finally(() => setLoading(false))
  }, [sku?.id]) // eslint-disable-line react-hooks/exhaustive-deps

  const save = async () => {
    if (!sku) return
    const valid = rows.filter((r) => r.componentSkuId && r.qty > 0)
    if (valid.length !== rows.length) return message.warning(t('每行都要选原料并填用量', 'Every line needs an ingredient and quantity'))
    setSaving(true)
    try {
      await api.put(`/skus/${sku.id}/recipe`, {
        components: valid.map((r) => ({ componentSkuId: r.componentSkuId, qty: r.qty })),
      })
      message.success(
        valid.length === 0
          ? t('配方已清除，此后卖它扣自身库存', 'Recipe cleared — selling it now deducts its own stock')
          : t(`配方已保存（${valid.length} 种原料），卖它自动扣原料`, `Recipe saved (${valid.length} ingredients)`),
      )
      onClose()
    } catch (e) {
      message.error((e as Error).message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal
      open={!!sku}
      onCancel={onClose}
      onOk={save}
      confirmLoading={saving}
      okText={t('保存配方', 'Save recipe')}
      title={sku ? t(`配方 · ${sku.label}`, `Recipe · ${sku.label}`) : ''}
      width={600}
    >
      {loading ? (
        <div style={{ textAlign: 'center', padding: 32 }}>
          <Spin />
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10, paddingTop: 4 }}>
          <div style={{ fontSize: 12, color: T.secondary }}>
            {t('设了配方后，卖这个商品会自动扣原料库存、不扣它自己；原料不能再是别的配方成品（只支持一级）。', 'With a recipe, selling this item deducts ingredient stock instead of its own. One level only.')}
          </div>
          {rows.map((r) => (
            <div key={r.key} style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <Select
                showSearch
                placeholder={t('选原料（商品/规格）', 'Pick an ingredient')}
                optionFilterProp="label"
                value={r.componentSkuId || undefined}
                onChange={(v) => setRows((p) => p.map((x) => (x.key === r.key ? { ...x, componentSkuId: v } : x)))}
                options={skuOpts.filter((o) => o.skuId !== sku?.id).map((o) => ({ value: o.skuId, label: o.label }))}
                style={{ flex: 1, minWidth: 0 }}
              />
              <InputNumber
                placeholder={t('用量', 'Qty')}
                min={0.001}
                value={r.qty || null}
                onChange={(v) => setRows((p) => p.map((x) => (x.key === r.key ? { ...x, qty: v ?? 0 } : x)))}
                style={{ width: 100 }}
              />
              {r.stock !== undefined && (
                <span style={{ fontSize: 11, color: T.secondary, width: 70 }}>
                  {t(`存${fmtQty(r.stock)}`, `stk ${fmtQty(r.stock)}`)}
                </span>
              )}
              <Button size="small" type="text" danger icon={<DeleteOutlined />} onClick={() => setRows((p) => p.filter((x) => x.key !== r.key))} />
            </div>
          ))}
          <Button
            size="small"
            icon={<PlusOutlined />}
            disabled={rows.length >= 30}
            onClick={() => setRows((p) => [...p, { key: ++rowKey, componentSkuId: 0, qty: 0 }])}
            style={{ alignSelf: 'flex-start' }}
          >
            {t('加原料', 'Add ingredient')}
          </Button>
        </div>
      )}
    </Modal>
  )
}
