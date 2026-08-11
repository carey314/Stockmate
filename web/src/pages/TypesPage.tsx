import {
  App,
  Button,
  Checkbox,
  Empty,
  Input,
  Modal,
  Popconfirm,
  Select,
  Skeleton,
  Tag,
  Typography,
} from 'antd'
import { DeleteOutlined, PlusOutlined, StarFilled, StarOutlined, ThunderboltOutlined } from '@ant-design/icons'
import { useCallback, useEffect, useState } from 'react'
import api from '../api/client'
import { useAuth } from '../auth'
import { T, cardStyle } from '../theme'

// ===== 类型 =====
interface FieldDef {
  id?: number
  key: string
  label: string
  type: 'text' | 'number' | 'select' | 'date' | 'boolean'
  scope: 'product' | 'sku'
  options: string[] | string | null
  unit: string | null
  required: number | boolean
  affectsStock: number | boolean
  sortOrder: number
}
interface ProductType {
  id: number
  name: string
  description: string | null
  isPreset: number
  fields: FieldDef[]
  productCount?: number
}

// 本地草稿字段（新建/加字段用）
interface FieldDraft {
  key: string
  label: string
  type: FieldDef['type']
  scope: 'product' | 'sku'
  options: string[]
  required: boolean
  affectsStock: boolean
}

const TYPE_LABEL: Record<string, string> = { text: '文本', number: '数字', select: '选项', date: '日期', boolean: '是否' }
const asOptions = (o: FieldDef['options']): string[] =>
  Array.isArray(o) ? o.map(String) : typeof o === 'string' ? (() => { try { const a = JSON.parse(o); return Array.isArray(a) ? a.map(String) : [] } catch { return [] } })() : []
const genKey = (i: number) => `field_${Date.now().toString(36)}_${i}`

// ===== 字段草稿编辑行 =====
function FieldEditor({
  fields,
  onChange,
}: {
  fields: FieldDraft[]
  onChange: (f: FieldDraft[]) => void
}) {
  const patch = (i: number, p: Partial<FieldDraft>) => onChange(fields.map((f, idx) => (idx === i ? { ...f, ...p } : f)))
  const remove = (i: number) => onChange(fields.filter((_, idx) => idx !== i))

  const group = (scope: 'product' | 'sku') => {
    const rows = fields.map((f, i) => ({ f, i })).filter((x) => x.f.scope === scope)
    return (
      <div style={{ marginBottom: 12 }}>
        <Typography.Text strong style={{ fontSize: 13 }}>
          {scope === 'product' ? '商品描述字段' : '规格维度（区分同款不同规格）'}
        </Typography.Text>
        <Typography.Text type="secondary" style={{ fontSize: 11, marginLeft: 8 }}>
          {scope === 'product' ? '如品牌 / 产地 / 保质期' : '如容量 / 颜色 / 杯型；勾"产生库存"的维度才拆库存'}
        </Typography.Text>
        <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 8 }}>
          {rows.length === 0 && <Typography.Text type="secondary" style={{ fontSize: 12 }}>暂无</Typography.Text>}
          {rows.map(({ f, i }) => (
            <div
              key={f.key}
              style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', background: T.surfaceContainerLow, padding: '8px 10px', borderRadius: 12 }}
            >
              <Input size="small" value={f.label} placeholder="字段名" style={{ width: 110 }} onChange={(e) => patch(i, { label: e.target.value })} />
              <Select
                size="small"
                value={f.type}
                style={{ width: 84 }}
                onChange={(v) => patch(i, { type: v })}
                options={Object.entries(TYPE_LABEL).map(([value, label]) => ({ value, label }))}
              />
              {f.type === 'select' && (
                <Input
                  size="small"
                  value={f.options.join('、')}
                  placeholder="选项，顿号分隔"
                  style={{ width: 180 }}
                  onChange={(e) => patch(i, { options: e.target.value.split(/[、,，]/).map((s) => s.trim()).filter(Boolean) })}
                />
              )}
              <Checkbox checked={f.required} onChange={(e) => patch(i, { required: e.target.checked })} style={{ fontSize: 12 }}>
                必填
              </Checkbox>
              {scope === 'sku' && (
                <Checkbox checked={f.affectsStock} onChange={(e) => patch(i, { affectsStock: e.target.checked })} style={{ fontSize: 12 }}>
                  产生库存
                </Checkbox>
              )}
              <Button size="small" type="text" danger icon={<DeleteOutlined />} onClick={() => remove(i)} />
            </div>
          ))}
          <Button
            size="small"
            type="dashed"
            icon={<PlusOutlined />}
            onClick={() =>
              onChange([...fields, { key: genKey(fields.length), label: '', type: scope === 'sku' ? 'select' : 'text', scope, options: [], required: false, affectsStock: true }])
            }
            style={{ alignSelf: 'flex-start' }}
          >
            加{scope === 'product' ? '字段' : '规格维度'}
          </Button>
        </div>
      </div>
    )
  }

  return (
    <div>
      {group('product')}
      {group('sku')}
    </div>
  )
}

export default function TypesPage() {
  const { user, profile, refreshProfile } = useAuth()
  const { message } = App.useApp()
  const isAdmin = user?.role === 'admin'

  const [types, setTypes] = useState<ProductType[] | null>(null)
  const load = useCallback(() => {
    api
      .get<ProductType[]>('/product-types')
      .then((d) => setTypes(d.map((t) => ({ ...t, productCount: (t as unknown as { productCount?: number; _count?: { products: number } })._count?.products ?? (t as { productCount?: number }).productCount ?? 0 }))))
      .catch((e) => message.error((e as Error).message))
  }, [message])
  useEffect(load, [load])

  // ===== 新建/编辑 =====
  const [open, setOpen] = useState(false)
  const [editing, setEditing] = useState<ProductType | null>(null)
  const [name, setName] = useState('')
  const [desc, setDesc] = useState('')
  const [drafts, setDrafts] = useState<FieldDraft[]>([])
  const [aiBusy, setAiBusy] = useState(false)
  const [busy, setBusy] = useState(false)

  const openCreate = () => {
    setEditing(null)
    setName('')
    setDesc('')
    setDrafts([])
    setOpen(true)
  }
  const openEdit = (t: ProductType) => {
    setEditing(t)
    setName(t.name)
    setDesc(t.description ?? '')
    setDrafts(
      t.fields.map((f) => ({
        key: f.key,
        label: f.label,
        type: f.type,
        scope: f.scope,
        options: asOptions(f.options),
        required: !!f.required,
        affectsStock: !!f.affectsStock,
      })),
    )
    setOpen(true)
  }

  // ✨ AI 配字段
  const aiFill = async () => {
    if (!name.trim()) return message.warning('先填品类名，AI 才知道帮你配什么')
    setAiBusy(true)
    try {
      const r = await api.post<{ fields: FieldDef[]; specs: FieldDef[] }>('/ai/generate-fields', { theme: name.trim() })
      const mapped: FieldDraft[] = [
        ...(r.fields ?? []).map((f, i) => ({ key: f.key || genKey(i), label: f.label, type: f.type, scope: 'product' as const, options: asOptions(f.options), required: !!f.required, affectsStock: true })),
        ...(r.specs ?? []).map((f, i) => ({ key: f.key || genKey(100 + i), label: f.label, type: f.type, scope: 'sku' as const, options: asOptions(f.options), required: !!f.required, affectsStock: f.affectsStock === undefined ? true : !!f.affectsStock })),
      ]
      setDrafts(mapped)
      message.success(`AI 配了 ${mapped.length} 个字段，可以再改`)
    } catch (e) {
      message.error((e as Error).message)
    } finally {
      setAiBusy(false)
    }
  }

  const toPayloadField = (f: FieldDraft, i: number) => ({
    key: f.key,
    label: f.label.trim(),
    type: f.type,
    scope: f.scope,
    options: f.type === 'select' ? f.options : undefined,
    required: f.required,
    affectsStock: f.scope === 'sku' ? f.affectsStock : true,
    sortOrder: i,
  })

  const submit = async () => {
    if (!name.trim()) return message.warning('填品类名')
    const bad = drafts.find((f) => !f.label.trim())
    if (bad) return message.warning('有字段没填名称')
    const badSel = drafts.find((f) => f.type === 'select' && f.options.length === 0)
    if (badSel) return message.warning(`「${badSel.label}」是选项类型，至少给一个选项`)
    setBusy(true)
    try {
      if (editing) {
        // 编辑：改名 + 字段全量替换（先删旧字段再加新的，避免逐字段 diff）
        await api.put(`/product-types/${editing.id}`, { name: name.trim(), description: desc.trim() || null })
        const oldIds = editing.fields.map((f) => f.id).filter(Boolean) as number[]
        for (const fid of oldIds) await api.delete(`/product-types/${editing.id}/fields/${fid}`).catch(() => {})
        for (let i = 0; i < drafts.length; i++) await api.post(`/product-types/${editing.id}/fields`, toPayloadField(drafts[i], i))
        message.success('已保存')
      } else {
        await api.post('/product-types', {
          name: name.trim(),
          description: desc.trim() || null,
          fields: drafts.map(toPayloadField),
        })
        message.success(`已创建「${name.trim()}」`)
      }
      setOpen(false)
      load()
    } catch (e) {
      message.error((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const remove = async (t: ProductType) => {
    try {
      await api.delete(`/product-types/${t.id}`)
      message.success(`已删除「${t.name}」`)
      load()
    } catch (e) {
      message.error((e as Error).message)
    }
  }

  const setMain = async (t: ProductType) => {
    try {
      await api.put('/settings/main-type', { productTypeId: t.id })
      await refreshProfile()
      message.success(`已把「${t.name}」设为主营，商品/开单默认落它`)
    } catch (e) {
      message.error((e as Error).message)
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 }}>
        <Typography.Text type="secondary" style={{ fontSize: 13 }}>
          品类决定商品有哪些字段和规格维度。换个行业？新建一个品类,让 AI 帮你配字段,30 秒配成自己的进销存。
        </Typography.Text>
        <Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>
          新建品类
        </Button>
      </div>

      {types === null ? (
        <Skeleton active />
      ) : types.length === 0 ? (
        <Empty description="还没有品类，新建一个开始" />
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))', gap: 16 }}>
          {types.map((t) => {
            const isMain = profile?.mainTypeId === t.id
            const productFields = t.fields.filter((f) => f.scope === 'product')
            const skuFields = t.fields.filter((f) => f.scope === 'sku')
            return (
              <div key={t.id} style={{ ...cardStyle, padding: 20 }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <Typography.Text strong style={{ fontSize: 16 }}>
                      {t.name}
                    </Typography.Text>
                    {isMain && <Tag color="purple" style={{ borderRadius: 999 }}>主营</Tag>}
                    {t.isPreset === 1 && <Tag style={{ borderRadius: 999 }}>预设</Tag>}
                  </div>
                  <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                    {t.productCount} 个商品
                  </Typography.Text>
                </div>
                <div style={{ fontSize: 12, color: T.secondary, minHeight: 40, marginBottom: 10 }}>
                  {productFields.length > 0 && <div>字段：{productFields.map((f) => f.label).join('、')}</div>}
                  {skuFields.length > 0 && <div>规格：{skuFields.map((f) => f.label).join('、')}</div>}
                  {t.fields.length === 0 && <div>无自定义字段</div>}
                </div>
                <div style={{ display: 'flex', gap: 4, borderTop: `1px solid ${T.surfaceContainerLow}`, paddingTop: 10 }}>
                  <Button size="small" type="text" icon={isMain ? <StarFilled style={{ color: T.primary }} /> : <StarOutlined />} onClick={() => setMain(t)} disabled={isMain}>
                    {isMain ? '主营' : '设为主营'}
                  </Button>
                  <Button size="small" type="text" onClick={() => openEdit(t)}>
                    编辑
                  </Button>
                  {isAdmin && (
                    <Popconfirm
                      title={`删除「${t.name}」？`}
                      description={t.productCount ? `该品类下有 ${t.productCount} 个商品，删不了` : '删除后不可恢复'}
                      onConfirm={() => remove(t)}
                    >
                      <Button size="small" type="text" danger icon={<DeleteOutlined />} />
                    </Popconfirm>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      )}

      <Modal
        title={editing ? `编辑品类：${editing.name}` : '新建品类'}
        open={open}
        onCancel={() => setOpen(false)}
        onOk={submit}
        confirmLoading={busy}
        okText={editing ? '保存' : '创建'}
        width={640}
      >
        <div style={{ display: 'flex', gap: 10, marginBottom: 12, alignItems: 'flex-start' }}>
          <div style={{ flex: 1 }}>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="品类名，如：奶茶 / 五金 / 母婴" maxLength={20} />
          </div>
          <Button icon={<ThunderboltOutlined />} loading={aiBusy} onClick={aiFill}>
            ✨ AI 配字段
          </Button>
        </div>
        <Input.TextArea value={desc} onChange={(e) => setDesc(e.target.value)} placeholder="备注（选填）" autoSize={{ minRows: 1, maxRows: 2 }} style={{ marginBottom: 16 }} maxLength={100} />
        <FieldEditor fields={drafts} onChange={setDrafts} />
        {editing && (
          <Typography.Text type="secondary" style={{ fontSize: 11 }}>
            提示：保存会用当前字段列表覆盖旧字段（已有商品的字段值不受影响）。
          </Typography.Text>
        )}
      </Modal>
    </div>
  )
}
