import {
  App,
  Alert,
  Skeleton,
  Button,
  Form,
  Input,
  InputNumber,
  Modal,
  Popconfirm,
  Radio,
  Select,
  Table,
  Typography,
} from 'antd'
import type { ColumnsType } from 'antd/es/table'
import { DeleteOutlined, EditOutlined, PlusOutlined, SearchOutlined } from '@ant-design/icons'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import api, { assetUrl } from '../api/client'
import { fetchAllPages } from '../api/pagination'
import { useAuth } from '../auth'
import { useInventoryAlerts } from '../hooks/useInventoryAlerts'
import { sessionSnapshot, isCurrentSession } from '../lib/session'
import { EditNum, EditText } from '../components/EditableCells'
import ImageUpload from '../components/ImageUpload'
import InventoryMoveModal from '../components/InventoryMoveModal'
import SkuRecordsDrawer from '../components/SkuRecordsDrawer'
import RecipeModal from '../components/RecipeModal'
import { fmtMoney, fmtQty } from '../lib/format'
import { t } from '../lib/i18n'
import { T, cardStyle } from '../theme'

// ===== 类型（形状对齐 docs/web-design-spec.md 与 products 控制器）=====
interface FieldDef {
  id: number
  key: string
  label: string
  type: string
  scope: 'product' | 'sku'
  options: string | string[] | null // 该接口已把 JSON 解码成数组，但防御性兼容字符串
  unit: string | null
  required: number
  sortOrder: number
}
interface ProductType {
  id: number
  name: string
  fields?: FieldDef[]
}
interface SkuRow {
  id: number
  code: string
  specText: string
  price: number
  costPrice: number | null
  barcode: string | null
  isDefault: number
  inventory: { quantity: number; minQuantity: number } | null
}
interface ProductRow {
  id: number
  code: string
  name: string
  unit: string
  barcode: string | null
  imageUrl: string | null
  productTypeId: number
  productType: { id: number; name: string }
  customFields: Record<string, unknown>
  skus: SkuRow[]
  totalStock: number
}
interface AlertRow {
  id: number
  quantity: number
  minQuantity: number
  sku: { id: number; specText: string; product: { id: number; name: string; unit: string } }
}

const parseOptions = (o: string | string[] | null): string[] => {
  if (Array.isArray(o)) return o.map(String)
  try {
    const a = JSON.parse(o ?? '[]')
    return Array.isArray(a) ? a.map(String) : []
  } catch {
    return []
  }
}

// 品类字段动态表单项（新建商品的商品字段 / 新增规格的规格维度共用）
function DynField({ f, ns = 'customFields' }: { f: FieldDef; ns?: string }) {
  const opts = parseOptions(f.options)
  return (
    <Form.Item
      key={f.key}
      name={[ns, f.key]}
      label={f.label + (f.unit ? `（${f.unit}）` : '')}
      rules={f.required === 1 ? [{ required: true, message: t(`${f.label}为必填`, `${f.label} is required`) }] : undefined}
    >
      {opts.length > 0 ? (
        <Select options={opts.map((o) => ({ value: o, label: o }))} allowClear placeholder={t('请选择', 'Select')} />
      ) : f.type === 'number' ? (
        <InputNumber style={{ width: '100%' }} placeholder={t('请输入', 'Enter a value')} />
      ) : (
        <Input placeholder={t('请输入', 'Enter a value')} />
      )}
    </Form.Item>
  )
}

const round2 = (n: number) => Math.round(n * 100) / 100

export default function ProductsPage() {
  const { user, profile } = useAuth()
  const { message } = App.useApp()
  const isAdmin = user?.role === 'admin'

  const [types, setTypes] = useState<ProductType[]>([])
  const [typeFilter, setTypeFilter] = useState<number | 'all' | 'lowstock'>('all')
  // ?kw= 初始关键词（Cmd+K 全局搜索跳转带过来的；只读初始值，输入过程不回写 URL）
  const [urlParams] = useSearchParams()
  const [keyword, setKeyword] = useState(() => urlParams.get('kw') ?? '')
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(20)
  const [rows, setRows] = useState<ProductRow[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(false)
  const alertState = useInventoryAlerts()
  const alerts = alertState.data ?? []
  const loadAlerts = alertState.refresh
  const [loadError, setLoadError] = useState<string | null>(null)
  const [lastLoadedAt, setLastLoadedAt] = useState<string | null>(null)
  const productRequest = useRef(0)
  const alive = useRef(true)
  useEffect(() => { alive.current = true; return () => { alive.current = false; productRequest.current++ } }, [])
  const [selectedKeys, setSelectedKeys] = useState<React.Key[]>([])
  // 出入库/报损、库存流水、配方（两端功能对齐补齐项）
  const [moveOpen, setMoveOpen] = useState(false)
  const [recordsSku, setRecordsSku] = useState<{ id: number; label: string } | null>(null)
  const [recipeSku, setRecipeSku] = useState<{ id: number; label: string } | null>(null)
  const [allSkuOpts, setAllSkuOpts] = useState<{ skuId: number; label: string }[]>([])
  const ensureAllSkuOpts = () => {
    if (allSkuOpts.length) return
    fetchAllPages<{ name: string; skus: { id: number; specText: string }[] }>('/products')
      .then((d) => {
        const opts: { skuId: number; label: string }[] = []
        for (const pp of d) for (const ss of pp.skus) opts.push({ skuId: ss.id, label: `${pp.name}${ss.specText ? ` ${ss.specText}` : ''}` })
        setAllSkuOpts(opts)
      })
      .catch((e) => message.error((e as Error).message))
  }
  const initialType = useRef(false)

  // ===== 数据加载 =====
  const load = useCallback(async () => {
    const ticket = ++productRequest.current, owner = sessionSnapshot()
    const current = () => alive.current && ticket === productRequest.current && isCurrentSession(owner)
    setLoading(true)
    setLoadError(null)
    try {
      const data = await api.get<{ list: ProductRow[]; pagination: { total: number } }>('/products', {
        page,
        pageSize,
        ...(keyword ? { keyword } : {}),
        // 搜索时忽略品类筛选，跨全部品类找（在"馄饨"tab 搜"啤酒"也要搜得到，符合直觉）
        ...(!keyword && typeof typeFilter === 'number' ? { productTypeId: typeFilter } : {}),
      })
      if (current()) { setRows(data.list); setTotal(data.pagination.total); setLastLoadedAt(new Date().toISOString()) }
    } catch (e) {
      if (current()) setLoadError((e as Error).message)
    } finally {
      if (current()) setLoading(false)
    }
  }, [page, pageSize, keyword, typeFilter])

  useEffect(() => {
    api
      .get<ProductType[] | { list: ProductType[] }>('/product-types')
      .then((d) => setTypes(Array.isArray(d) ? d : d.list))
      .catch(() => {})
    loadAlerts()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // 默认落在主营品类（与 App 一致）。profile 是异步来的，所以单独一个 effect，只应用一次
  useEffect(() => {
    if (!initialType.current && profile?.mainTypeId && types.some((t) => t.id === profile.mainTypeId)) {
      initialType.current = true
      setTypeFilter(profile.mainTypeId)
      setPage(1)
    }
  }, [profile?.mainTypeId, types])

  useEffect(() => {
    if (typeFilter !== 'lowstock') load()
    else loadAlerts() // 进低库存视图时重拉，预警数据不吃缓存
  }, [load, loadAlerts, typeFilter])

  // Entering the page, returning to the visible tab, and explicit refresh re-read stock.
  // This is not a real-time push subscription.
  useEffect(() => {
    const refreshVisible = () => {
      if (document.visibilityState !== 'visible') return
      if (typeFilter !== 'lowstock') void load()
      void loadAlerts()
    }
    window.addEventListener('focus', refreshVisible)
    document.addEventListener('visibilitychange', refreshVisible)
    return () => { window.removeEventListener('focus', refreshVisible); document.removeEventListener('visibilitychange', refreshVisible) }
  }, [load, loadAlerts, typeFilter])

  const reloadAfterChange = () => { void load(); void loadAlerts() }

  // ===== 行内直改 =====
  const patchSku = (skuId: number, patch: Partial<SkuRow> & { quantity?: number; minQuantity?: number }) => {
    setRows((prev) =>
      prev.map((p) => {
        const skus = p.skus.map((s) => {
          if (s.id !== skuId) return s
          const { quantity, minQuantity, ...skuPatch } = patch
          return {
            ...s,
            ...skuPatch,
            inventory:
              quantity !== undefined || minQuantity !== undefined
                ? {
                    quantity: quantity ?? s.inventory?.quantity ?? 0,
                    minQuantity: minQuantity ?? s.inventory?.minQuantity ?? 0,
                  }
                : s.inventory,
          }
        })
        // 主行「库存合计」是后端算好的 totalStock，行内直改后必须同步重算，否则合计停在旧值
        return { ...p, skus, totalStock: skus.reduce((n, x) => n + (x.inventory?.quantity ?? 0), 0) }
      }),
    )
  }

  const saveSku = async (skuId: number, body: Record<string, unknown>, patch: Parameters<typeof patchSku>[1]) => {
    await api.put(`/skus/${skuId}`, body)
    patchSku(skuId, patch)
  }
  // 铁律：库存改动必须走 /inventory/adjust 留「手动调整」流水，绝不直接写数
  const saveStock = async (skuId: number, quantity: number) => {
    await api.post('/inventory/adjust', { skuId, quantity, reason: '手动调整库存（Web 后台）' })
    patchSku(skuId, { quantity })
    loadAlerts()
  }

  // ===== 批量改价 =====
  const [batchOpen, setBatchOpen] = useState(false)
  const [batchBusy, setBatchBusy] = useState(false)
  const [batchForm] = Form.useForm()
  const selectedProducts = useMemo(
    () => rows.filter((r) => selectedKeys.includes(r.id)),
    [rows, selectedKeys],
  )
  const selectedSkuCount = selectedProducts.reduce((n, p) => n + p.skus.length, 0)

  // ===== 批量删除（仅老板；复用单删接口=复用软删守卫，逐个报成败不静默吞）=====
  const [batchDeleting, setBatchDeleting] = useState(false)
  const batchDelete = async () => {
    setBatchDeleting(true)
    try {
      const results = await Promise.allSettled(selectedKeys.map((id) => api.delete(`/products/${id}`)))
      const okN = results.filter((r) => r.status === 'fulfilled').length
      const failN = results.length - okN
      if (failN === 0) message.success(t(`已删除 ${okN} 个商品`, `Deleted ${okN} products`))
      else {
        const firstErr = (results.find((r) => r.status === 'rejected') as PromiseRejectedResult)?.reason?.message ?? ''
        message.warning(
          t(`删除 ${okN} 个成功，${failN} 个失败（${firstErr}）`, `${okN} deleted, ${failN} failed (${firstErr})`),
        )
      }
      setSelectedKeys([])
      reloadAfterChange()
    } finally {
      setBatchDeleting(false)
    }
  }

  const runBatch = async () => {
    const { mode, value } = await batchForm.validateFields()
    if (!value) return
    setBatchBusy(true)
    let ok = 0
    let bad = 0
    for (const p of selectedProducts) {
      for (const s of p.skus) {
        const next = round2(Math.max(0, mode === 'percent' ? s.price * (1 + value / 100) : s.price + value))
        try {
          await api.put(`/skus/${s.id}`, { price: next })
          patchSku(s.id, { price: next })
          ok++
        } catch {
          bad++
        }
      }
    }
    setBatchBusy(false)
    setBatchOpen(false)
    setSelectedKeys([])
    if (bad) message.warning(t(`改价完成：成功 ${ok} 个规格，失败 ${bad} 个`, `Repricing done: ${ok} variants updated, ${bad} failed`))
    else message.success(t(`已批量改价 ${ok} 个规格`, `Repriced ${ok} variants`))
  }

  // ===== 新建商品 =====
  const [createOpen, setCreateOpen] = useState(false)
  const [createBusy, setCreateBusy] = useState(false)
  const [createForm] = Form.useForm()
  const createTypeId = Form.useWatch('productTypeId', createForm)
  const createType = types.find((t) => t.id === createTypeId)
  const productFields = (createType?.fields ?? [])
    .filter((f) => f.scope === 'product')
    .sort((a, b) => a.sortOrder - b.sortOrder)
  // 品类带规格维度（如奶茶的 规格/温度/糖度）时，必须随单建首个规格——后端自动建的默认规格 {} 过不了必填校验
  const createSkuFields = (createType?.fields ?? [])
    .filter((f) => f.scope === 'sku')
    .sort((a, b) => a.sortOrder - b.sortOrder)

  const runCreate = async () => {
    const v = await createForm.validateFields()
    setCreateBusy(true)
    try {
      const clean = (o: Record<string, unknown> | undefined) =>
        Object.fromEntries(
          Object.entries(o ?? {}).filter(([, val]) => val !== undefined && val !== null && val !== ''),
        )
      const created = await api.post<ProductRow>('/products', {
        name: v.name,
        productTypeId: v.productTypeId,
        unit: v.unit || '件',
        defaultPrice: v.defaultPrice ?? 0,
        costPrice: v.costPrice ?? null,
        barcode: v.barcode?.trim() || null,
        minQuantity: v.minQuantity ?? undefined,
        customFields: clean(v.customFields),
        // 有规格维度 → 随单建首个规格（initQuantity 由后端建库存+初始入库流水）；
        // 无规格维度 → 不传 skus，后端自动建默认规格
        skus:
          createSkuFields.length > 0
            ? [
                {
                  specValues: clean(v.skuValues),
                  price: v.defaultPrice ?? 0,
                  costPrice: v.costPrice ?? null,
                  barcode: v.barcode?.trim() || null,
                  initQuantity: v.initQuantity ?? 0,
                  minQuantity: v.minQuantity ?? 0,
                },
              ]
            : undefined,
      })
      // 无规格品类：初始库存走 adjust 留流水（不直接写数）
      if (createSkuFields.length === 0 && v.initQuantity) {
        const defSku = created.skus?.[0]
        if (defSku) {
          await api.post('/inventory/adjust', {
            skuId: defSku.id,
            quantity: v.initQuantity,
            reason: '新建商品初始库存（Web 后台）',
          })
        }
      }
      message.success(t(`已创建「${v.name}」`, `Created "${v.name}"`))
      setCreateOpen(false)
      createForm.resetFields()
      reloadAfterChange()
    } catch (e) {
      message.error((e as Error).message)
    } finally {
      setCreateBusy(false)
    }
  }

  // ===== 新增规格 =====
  const [skuTarget, setSkuTarget] = useState<ProductRow | null>(null)
  const [skuBusy, setSkuBusy] = useState(false)
  const [skuForm] = Form.useForm()
  const skuFields = useMemo(() => {
    if (!skuTarget) return []
    const t = types.find((t) => t.id === skuTarget.productTypeId)
    return (t?.fields ?? []).filter((f) => f.scope === 'sku').sort((a, b) => a.sortOrder - b.sortOrder)
  }, [skuTarget, types])

  const runAddSku = async () => {
    if (!skuTarget) return
    const v = await skuForm.validateFields()
    setSkuBusy(true)
    try {
      await api.post(`/products/${skuTarget.id}/skus`, {
        specValues: Object.fromEntries(
          Object.entries((v.customFields ?? {}) as Record<string, unknown>).filter(
            ([, val]) => val !== undefined && val !== null && val !== '',
          ),
        ),
        price: v.price,
        costPrice: v.costPrice ?? null,
        barcode: v.barcode?.trim() || null,
        initQuantity: v.initQuantity ?? 0,
        minQuantity: v.minQuantity ?? 0,
      })
      message.success(t('规格已添加', 'Variant added'))
      setSkuTarget(null)
      skuForm.resetFields()
      reloadAfterChange()
    } catch (e) {
      message.error((e as Error).message)
    } finally {
      setSkuBusy(false)
    }
  }

  // ===== 编辑商品 SPU（改名/单位/条码/品类字段值；价格库存在 SKU 行内改）=====
  const [editProduct, setEditProduct] = useState<ProductRow | null>(null)
  const [editBusy, setEditBusy] = useState(false)
  const [editForm] = Form.useForm()
  const editProductFields = (() => {
    const t = types.find((t) => t.id === editProduct?.productTypeId)
    return (t?.fields ?? []).filter((f) => f.scope === 'product').sort((a, b) => a.sortOrder - b.sortOrder)
  })()
  const openEditProduct = (p: ProductRow) => {
    setEditProduct(p)
    editForm.setFieldsValue({ name: p.name, unit: p.unit, barcode: p.barcode, imageUrl: p.imageUrl, customFields: p.customFields ?? {} })
  }
  const runEditProduct = async () => {
    if (!editProduct) return
    const v = await editForm.validateFields()
    setEditBusy(true)
    try {
      await api.put(`/products/${editProduct.id}`, {
        name: v.name.trim(),
        unit: v.unit?.trim() || '件',
        barcode: v.barcode?.trim() || null,
        imageUrl: v.imageUrl ?? null,
        customFields: Object.fromEntries(
          Object.entries((v.customFields ?? {}) as Record<string, unknown>).filter(([, val]) => val !== undefined && val !== null && val !== ''),
        ),
      })
      message.success(t('已保存', 'Saved'))
      setEditProduct(null)
      reloadAfterChange()
    } catch (e) {
      message.error((e as Error).message)
    } finally {
      setEditBusy(false)
    }
  }

  // ===== 删除 =====
  const removeProduct = async (p: ProductRow) => {
    try {
      await api.delete(`/products/${p.id}`)
      message.success(t(`已删除「${p.name}」`, `Deleted "${p.name}"`))
      reloadAfterChange()
    } catch (e) {
      message.error((e as Error).message)
    }
  }
  const removeSku = async (s: SkuRow) => {
    try {
      await api.delete(`/skus/${s.id}`)
      message.success(t('规格已停用', 'Variant disabled'))
      reloadAfterChange()
    } catch (e) {
      message.error((e as Error).message)
    }
  }

  // ===== 表格列 =====
  const columns: ColumnsType<ProductRow> = [
    {
      title: t('商品', 'Product'),
      key: 'name',
      render: (_, p) => (
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          {p.imageUrl ? (
            <img
              src={assetUrl(p.imageUrl)!}
              alt=""
              style={{ width: 40, height: 40, borderRadius: 8, objectFit: 'cover', flexShrink: 0 }}
            />
          ) : (
            <div
              style={{
                width: 40,
                height: 40,
                borderRadius: 8,
                background: T.surfaceContainer,
                color: T.primary,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontWeight: 700,
                flexShrink: 0,
              }}
            >
              {p.name.slice(0, 1)}
            </div>
          )}
          <div style={{ minWidth: 0 }}>
            <div style={{ fontWeight: 600, fontSize: 14 }}>{p.name}</div>
            <div style={{ fontSize: 12, color: T.secondary, fontFamily: 'monospace' }}>{p.code}</div>
          </div>
        </div>
      ),
    },
    {
      title: t('品类', 'Category'),
      dataIndex: ['productType', 'name'],
      width: 92,
      render: (v: string) => (
        <span
          style={{
            padding: '4px 10px',
            borderRadius: 999,
            background: T.surfaceVariant,
            color: T.onSurfaceVariant,
            fontSize: 11,
            whiteSpace: 'nowrap',
          }}
        >
          {v}
        </span>
      ),
    },
    {
      title: t('价格', 'Price'),
      key: 'price',
      width: 130,
      render: (_, p) => {
        const prices = p.skus.map((s) => s.price)
        const lo = Math.min(...prices)
        const hi = Math.max(...prices)
        return prices.length === 0 ? '-' : lo === hi ? fmtMoney(lo) : `${fmtMoney(lo)} ~ ${fmtMoney(hi)}`
      },
    },
    {
      title: t('规格', 'Variants'),
      key: 'skuCount',
      width: 56,
      align: 'center',
      responsive: ['xl'],
      render: (_, p) => p.skus.length,
    },
    {
      title: t('库存合计', 'Total stock'),
      key: 'stock',
      width: 100,
      render: (_, p) => {
        const low = p.skus.some(
          (s) => (s.inventory?.minQuantity ?? 0) > 0 && (s.inventory?.quantity ?? 0) <= (s.inventory?.minQuantity ?? 0),
        )
        return (
          <span style={{ fontWeight: 600, color: p.totalStock <= 0 ? T.error : low ? T.orange : T.onSurface }}>
            {fmtQty(p.totalStock)} {p.unit}
          </span>
        )
      },
    },
    {
      title: t('操作', 'Actions'),
      key: 'ops',
      width: 132,
      fixed: 'right',
      render: (_, p) => (
        <span style={{ display: 'flex', gap: 2 }}>
          <Button
            size="small"
            type="text"
            icon={<EditOutlined />}
            title={t('编辑商品', 'Edit product')}
            onClick={() => openEditProduct(p)}
          />
          <Button size="small" type="text" style={{ color: T.primary }} onClick={() => setSkuTarget(p)}>
            {t('+规格', '+Variant')}
          </Button>
          {isAdmin && (
            <Popconfirm
              title={t(`删除「${p.name}」？`, `Delete "${p.name}"?`)}
              description={t(
                '商品会被移入回收（软删），单据历史不受影响',
                'The product is archived (soft delete). Existing documents are unaffected.',
              )}
              onConfirm={() => removeProduct(p)}
            >
              <Button size="small" type="text" danger icon={<DeleteOutlined />} />
            </Popconfirm>
          )}
        </span>
      ),
    },
  ]

  // SKU 子行：行内直改 价格/成本/条码/预警线（PUT /skus/:id）+ 库存（/inventory/adjust）
  const renderSkus = (p: ProductRow) => (
    <div style={{ padding: '4px 0 8px 52px' }}>
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'minmax(140px,1.2fr) 110px 110px 150px 110px 110px 150px',
          gap: 8,
          fontSize: 12,
          color: T.secondary,
          padding: '6px 0',
        }}
      >
        <span>{t('规格', 'Variant')}</span>
        <span>{t('售价', 'Price')}</span>
        <span>{t('成本价', 'Cost')}</span>
        <span>{t('条码', 'Barcode')}</span>
        <span>{t('库存（留流水）', 'Stock (logged)')}</span>
        <span>{t('预警线', 'Low-stock alert')}</span>
        <span />
      </div>
      {p.skus.map((s) => {
        const lowNow =
          (s.inventory?.minQuantity ?? 0) > 0 && (s.inventory?.quantity ?? 0) <= (s.inventory?.minQuantity ?? 0)
        return (
          <div
            key={s.id}
            style={{
              display: 'grid',
              gridTemplateColumns: 'minmax(140px,1.2fr) 110px 110px 150px 110px 110px 150px',
              gap: 8,
              alignItems: 'center',
              padding: '5px 0',
              borderTop: `1px solid ${T.surfaceContainerLow}`,
            }}
          >
            <span style={{ fontSize: 13 }}>
              {s.specText || <span style={{ color: T.secondary }}>{t('默认规格', 'Default variant')}</span>}
              {lowNow && (
                <span style={{ color: T.error, fontSize: 11, marginLeft: 6 }}>{t('低库存', 'Low stock')}</span>
              )}
            </span>
            <EditNum
              value={s.price}
              prefix="¥"
              onSave={(v) => saveSku(s.id, { price: v }, { price: v })}
            />
            <EditNum
              value={s.costPrice}
              prefix="¥"
              placeholder={t('未填', 'Not set')}
              onSave={(v) => saveSku(s.id, { costPrice: v }, { costPrice: v })}
            />
            <EditText
              value={s.barcode}
              placeholder={t('扫码枪对准输入', 'Scan or type barcode')}
              onSave={(v) => saveSku(s.id, { barcode: v }, { barcode: v })}
            />
            <EditNum
              value={s.inventory?.quantity ?? 0}
              precision={3}
              danger={lowNow}
              onSave={(v) => saveStock(s.id, v)}
            />
            <EditNum
              value={s.inventory?.minQuantity ?? 0}
              intOnly
              onSave={async (v) => {
                await saveSku(s.id, { minQuantity: v }, { minQuantity: v })
                loadAlerts() // 预警线变了，低库存角标同步
              }}
            />
            <span style={{ display: 'flex', gap: 2, alignItems: 'center' }}>
            <Button size="small" type="link" style={{ padding: '0 4px', fontSize: 12 }}
              onClick={() => setRecordsSku({ id: s.id, label: `${p.name}${s.specText ? ` ${s.specText}` : ''}` })}>
              {t('流水', 'History')}
            </Button>
            <Button size="small" type="link" style={{ padding: '0 4px', fontSize: 12 }}
              onClick={() => { ensureAllSkuOpts(); setRecipeSku({ id: s.id, label: `${p.name}${s.specText ? ` ${s.specText}` : ''}` }) }}>
              {t('配方', 'Recipe')}
            </Button>
            {isAdmin && p.skus.length > 1 ? (
              <Popconfirm
                title={t('删除该规格？', 'Delete this variant?')}
                description={t('有库存会被拒绝', 'Rejected if it still has stock')}
                onConfirm={() => removeSku(s)}
              >
                <Button size="small" type="text" danger icon={<DeleteOutlined />} />
              </Popconfirm>
            ) : (
              <span />
            )}
            </span>
          </div>
        )
      })}
    </div>
  )

  // ===== 低库存视图（数据源 /inventory/alerts，SKU 级平铺）=====
  const lowStockView = (
    <Table<AlertRow>
      rowKey="id"
      dataSource={alerts}
      loading={alertState.loading}
      pagination={false}
      size="middle"
      locale={{ emptyText: alertState.error || alertState.loading ? t('预警尚未更新', 'Alerts are not current') : t('没有低于预警线的规格 👍', 'Nothing below its low-stock alert 👍') }}
      columns={[
        {
          title: t('商品 / 规格', 'Product / Variant'),
          render: (_, a) => (
            <span>
              {a.sku.product.name}
              {a.sku.specText ? `（${a.sku.specText}）` : ''}
            </span>
          ),
        },
        {
          title: t('当前库存', 'Current stock'),
          width: 160,
          render: (_, a) => (
            <EditNum
              value={a.quantity}
              precision={3}
              danger
              onSave={async (v) => {
                await api.post('/inventory/adjust', {
                  skuId: a.sku.id,
                  quantity: v,
                  reason: '手动调整库存（Web 后台）',
                })
                reloadAfterChange()
              }}
            />
          ),
        },
        {
          title: t('预警线', 'Low-stock alert'),
          width: 140,
          render: (_, a) => `${fmtQty(a.minQuantity)} ${a.sku.product.unit}`,
        },
      ]}
    />
  )

  const tabs: { key: number | 'all' | 'lowstock'; label: string }[] = [
    { key: 'all', label: t('全部', 'All') },
    ...types.map((ty) => ({ key: ty.id, label: ty.name })),
    {
      key: 'lowstock' as const,
      label: t(`低库存${alertState.error ? ' · 未更新' : alerts.length ? ` ${alerts.length}` : ''}`, `Low stock${alertState.error ? ' · not current' : alerts.length ? ` ${alerts.length}` : ''}`),
    },
  ]

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {/* 筛选行：品类药丸 tabs + 搜索 + 新增 */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', flex: 1 }}>
          {tabs.map((t) => {
            const active = typeFilter === t.key
            const isLow = t.key === 'lowstock'
            return (
              <span
                key={String(t.key)}
                onClick={() => {
                  setTypeFilter(t.key)
                  setPage(1)
                  setSelectedKeys([])
                }}
                style={{
                  padding: '6px 14px',
                  borderRadius: 999,
                  fontSize: 13,
                  fontWeight: 600,
                  cursor: 'pointer',
                  background: active ? T.surfaceContainerLow : 'transparent',
                  color: active ? (isLow ? T.error : T.primary) : isLow && alerts.length ? T.error : T.secondary,
                  border: active ? `1px solid ${isLow ? T.error : T.primary}33` : '1px solid transparent',
                  transition: 'all .2s',
                }}
              >
                {t.label}
              </span>
            )
          })}
        </div>
        <Input
          allowClear
          prefix={<SearchOutlined style={{ color: T.secondary }} />}
          placeholder={t('搜名称 / 编码 / 条码 / 规格', 'Search name / code / barcode / variant')}
          style={{ width: 240, borderRadius: 999 }}
          onChange={(e) => {
            const v = e.target.value.trim()
            // 简单防抖
            window.clearTimeout((window as unknown as { __pk?: number }).__pk)
            ;(window as unknown as { __pk?: number }).__pk = window.setTimeout(() => {
              setKeyword(v)
              setPage(1)
            }, 400)
          }}
        />
        <Button onClick={() => { if (typeFilter !== 'lowstock') void load(); void loadAlerts() }}>{t('刷新库存', 'Refresh stock')}</Button>
        <Button type="primary" icon={<PlusOutlined />} onClick={() => setCreateOpen(true)}>
          {t('新增商品', 'New product')}
        </Button>
        <Button onClick={() => setMoveOpen(true)}>{t('出入库 / 报损', 'Stock in/out & loss')}</Button>
      </div>

      {alertState.error && <Alert type="warning" showIcon title={t('低库存加载失败', 'Low-stock alerts failed to load')} description={`${alertState.error}。${alertState.updatedAt ? t('当前展示旧数据，不代表最新库存。', 'Showing old data; stock may have changed.') : t('尚无成功数据，不能判断是否缺货。', 'No successful snapshot; stock status is unknown.')}`} action={<Button onClick={loadAlerts} loading={alertState.loading}>{t('重试预警', 'Retry alerts')}</Button>} />}
      {typeFilter !== 'lowstock' && loadError && <Alert type="warning" showIcon title={t('商品库存未刷新', 'Product stock was not refreshed')} description={`${loadError}${lastLoadedAt ? t(`；当前为旧数据，上次成功更新：${new Date(lastLoadedAt).toLocaleString()}`, `; old data, last updated: ${new Date(lastLoadedAt).toLocaleString()}`) : ''}`} action={<Button onClick={load}>{t('重试商品', 'Retry products')}</Button>} />}
      {typeFilter === 'lowstock' && alertState.updatedAt && <Typography.Text type="secondary">{t('上次成功更新：', 'Last successful update: ')}{new Date(alertState.updatedAt).toLocaleString()}{alertState.loading ? t(' · 正在刷新，以下为上次数据', ' · Refreshing; previous snapshot below') : ''}</Typography.Text>}
      <Typography.Text type="secondary">{t('进入页面、操作后和返回页面时刷新；也可点击“刷新库存”。页面持续停留时不会实时推送。', 'Refreshes on entry, after changes and on return. You can also refresh manually; stock is not pushed in real time.')}</Typography.Text>
      {/* 批量操作条 */}
      {selectedKeys.length > 0 && typeFilter !== 'lowstock' && (
        <div
          style={{
            ...cardStyle,
            padding: '10px 20px',
            display: 'flex',
            alignItems: 'center',
            gap: 16,
            borderColor: `${T.primary}44`,
          }}
        >
          <Typography.Text strong>
            {t(
              `已选 ${selectedKeys.length} 个商品（${selectedSkuCount} 个规格）`,
              `${selectedKeys.length} products selected (${selectedSkuCount} variants)`,
            )}
          </Typography.Text>
          <Button type="primary" size="small" onClick={() => setBatchOpen(true)}>
            {t('批量改价', 'Bulk reprice')}
          </Button>
          {isAdmin && (
            <Popconfirm
              title={t(`删除选中的 ${selectedKeys.length} 个商品？`, `Delete the ${selectedKeys.length} selected products?`)}
              description={t(
                '软删除：历史单据和报表保留原名，删后不可再开单卖它',
                'Soft delete: past documents and reports keep the original name, but you can no longer sell it.',
              )}
              okText={t('删除', 'Delete')}
              okButtonProps={{ danger: true }}
              onConfirm={batchDelete}
            >
              <Button size="small" danger loading={batchDeleting}>
                {t('批量删除', 'Bulk delete')}
              </Button>
            </Popconfirm>
          )}
          <Button size="small" onClick={() => setSelectedKeys([])}>
            {t('取消选择', 'Clear selection')}
          </Button>
        </div>
      )}

      <div style={{ ...cardStyle, padding: '8px 16px 16px', overflow: 'hidden' }}>
        {typeFilter === 'lowstock' ? (
          alertState.data === null ? (alertState.loading ? <><Typography.Text>{t('正在加载低库存…', 'Loading low-stock alerts…')}</Typography.Text><Skeleton active /></> : null) : lowStockView
        ) : (
          <Table<ProductRow>
            rowKey="id"
            columns={columns}
            dataSource={rows}
            loading={loading}
            size="middle"
            rowSelection={{ selectedRowKeys: selectedKeys, onChange: setSelectedKeys }}
            expandable={{ expandedRowRender: renderSkus }}
            pagination={{
              current: page,
              pageSize,
              total,
              showSizeChanger: true,
              showTotal: (n) => t(`共 ${n} 个商品`, `${n} products`),
              onChange: (p, ps) => {
                setPage(p)
                setPageSize(ps)
              },
            }}
            scroll={{ x: 860 }}
          />
        )}
      </div>

      {/* 批量改价 */}
      <Modal
        title={t(
          `批量改价（${selectedKeys.length} 个商品 / ${selectedSkuCount} 个规格）`,
          `Bulk reprice (${selectedKeys.length} products / ${selectedSkuCount} variants)`,
        )}
        open={batchOpen}
        onCancel={() => setBatchOpen(false)}
        onOk={runBatch}
        confirmLoading={batchBusy}
        okText={t('执行改价', 'Apply')}
      >
        <Form form={batchForm} layout="vertical" initialValues={{ mode: 'percent' }}>
          <Form.Item name="mode" label={t('方式', 'Method')}>
            <Radio.Group
              options={[
                {
                  value: 'percent',
                  label: t('按百分比（如 +5 = 涨价 5%，-10 = 降价 10%）', 'By percentage (+5 = raise 5%, -10 = cut 10%)'),
                },
                {
                  value: 'amount',
                  label: t('按金额（如 +2 = 每个规格加 2 元）', 'By amount (+2 = add ¥2 to every variant)'),
                },
              ]}
            />
          </Form.Item>
          <Form.Item
            name="value"
            label={t('调整值', 'Adjustment')}
            rules={[{ required: true, message: t('填一个数，可以是负数', 'Enter a number — negatives allowed') }]}
          >
            <InputNumber style={{ width: 200 }} precision={2} placeholder={t('正数涨、负数降', 'Positive up, negative down')} />
          </Form.Item>
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            {t(
              '改的是每个规格的售价，四舍五入到分，最低 0 元。成本价不动。',
              'Changes each variant’s selling price, rounded to the cent, never below 0. Cost is left alone.',
            )}
          </Typography.Text>
        </Form>
      </Modal>

      {/* 新建商品 */}
      <Modal
        title={t('新增商品', 'New product')}
        open={createOpen}
        onCancel={() => setCreateOpen(false)}
        onOk={runCreate}
        confirmLoading={createBusy}
        okText={t('创建', 'Create')}
        width={520}
      >
        <Form form={createForm} layout="vertical" initialValues={{ unit: '件' }}>
          <Form.Item
            name="productTypeId"
            label={t('品类', 'Category')}
            rules={[{ required: true, message: t('选择品类', 'Pick a category') }]}
          >
            <Select
              options={types.map((ty) => ({ value: ty.id, label: ty.name }))}
              placeholder={t('商品属于哪个品类', 'Which category does it belong to?')}
            />
          </Form.Item>
          <Form.Item
            name="name"
            label={t('商品名称', 'Product name')}
            rules={[{ required: true, message: t('填商品名', 'Enter a product name') }]}
          >
            <Input placeholder={t('如：泸州老窖 52度', 'e.g. Luzhou Laojiao 52%')} />
          </Form.Item>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <Form.Item
              name="defaultPrice"
              label={t('售价', 'Price')}
              rules={[{ required: true, message: t('填售价', 'Enter a price') }]}
            >
              <InputNumber style={{ width: '100%' }} prefix="¥" min={0} precision={2} />
            </Form.Item>
            <Form.Item name="costPrice" label={t('成本价（选填，算毛利用）', 'Cost (optional, used for margin)')}>
              <InputNumber style={{ width: '100%' }} prefix="¥" min={0} precision={2} />
            </Form.Item>
            <Form.Item name="unit" label={t('单位', 'Unit')}>
              <Input placeholder={t('件 / 瓶 / 斤', 'pc / bottle / kg')} />
            </Form.Item>
            <Form.Item name="barcode" label={t('条码（选填）', 'Barcode (optional)')}>
              <Input placeholder={t('扫码枪对准输入', 'Scan or type barcode')} />
            </Form.Item>
            <Form.Item name="initQuantity" label={t('初始库存（选填）', 'Opening stock (optional)')}>
              <InputNumber style={{ width: '100%' }} min={0} />
            </Form.Item>
            <Form.Item name="minQuantity" label={t('库存预警线（选填）', 'Low-stock alert (optional)')}>
              <InputNumber style={{ width: '100%' }} min={0} precision={0} />
            </Form.Item>
          </div>
          {productFields.length > 0 && (
            <>
              <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                {t(`「${createType?.name}」的品类字段：`, `Category fields for "${createType?.name}":`)}
              </Typography.Text>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginTop: 8 }}>
                {productFields.map((f) => (
                  <DynField key={f.key} f={f} />
                ))}
              </div>
            </>
          )}
          {createSkuFields.length > 0 && (
            <>
              <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                {t(
                  `首个规格（该品类按${createSkuFields.map((f) => f.label).join('/')}区分规格，之后可再加）：`,
                  `First variant (this category splits variants by ${createSkuFields.map((f) => f.label).join('/')}; you can add more later):`,
                )}
              </Typography.Text>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginTop: 8 }}>
                {createSkuFields.map((f) => (
                  <DynField key={f.key} f={f} ns="skuValues" />
                ))}
              </div>
            </>
          )}
        </Form>
      </Modal>

      {/* 新增规格 */}
      <Modal
        title={skuTarget ? t(`为「${skuTarget.name}」新增规格`, `Add a variant to "${skuTarget.name}"`) : ''}
        open={!!skuTarget}
        onCancel={() => setSkuTarget(null)}
        onOk={runAddSku}
        confirmLoading={skuBusy}
        okText={t('添加', 'Add')}
        width={480}
      >
        <Form form={skuForm} layout="vertical">
          {skuFields.length > 0 ? (
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              {skuFields.map((f) => (
                <DynField key={f.key} f={f} />
              ))}
            </div>
          ) : (
            <Typography.Paragraph type="secondary" style={{ fontSize: 12 }}>
              {t(
                '该品类没有规格维度字段，同一商品只能有一个默认规格；如需多规格，先去品类里加规格维度。',
                'This category has no variant dimensions, so each product has a single default variant. To use multiple variants, add a variant dimension to the category first.',
              )}
            </Typography.Paragraph>
          )}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <Form.Item
              name="price"
              label={t('售价', 'Price')}
              rules={[{ required: true, message: t('填售价', 'Enter a price') }]}
            >
              <InputNumber style={{ width: '100%' }} prefix="¥" min={0} precision={2} />
            </Form.Item>
            <Form.Item name="costPrice" label={t('成本价（选填）', 'Cost (optional)')}>
              <InputNumber style={{ width: '100%' }} prefix="¥" min={0} precision={2} />
            </Form.Item>
            <Form.Item name="barcode" label={t('条码（选填）', 'Barcode (optional)')}>
              <Input />
            </Form.Item>
            <Form.Item name="initQuantity" label={t('初始库存', 'Opening stock')}>
              <InputNumber style={{ width: '100%' }} min={0} />
            </Form.Item>
            <Form.Item name="minQuantity" label={t('预警线', 'Low-stock alert')}>
              <InputNumber style={{ width: '100%' }} min={0} precision={0} />
            </Form.Item>
          </div>
        </Form>
      </Modal>

      {/* 编辑商品 SPU */}
      <Modal
        title={editProduct ? t(`编辑「${editProduct.name}」`, `Edit "${editProduct.name}"`) : ''}
        open={!!editProduct}
        onCancel={() => setEditProduct(null)}
        onOk={runEditProduct}
        confirmLoading={editBusy}
        okText={t('保存', 'Save')}
        width={520}
      >
        <Form form={editForm} layout="vertical">
          <Form.Item
            name="name"
            label={t('商品名称', 'Product name')}
            rules={[{ required: true, message: t('填商品名', 'Enter a product name') }]}
          >
            <Input maxLength={40} />
          </Form.Item>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <Form.Item name="unit" label={t('单位', 'Unit')}>
              <Input placeholder={t('件 / 瓶 / 斤', 'pc / bottle / kg')} />
            </Form.Item>
            <Form.Item name="barcode" label={t('条码', 'Barcode')}>
              <Input placeholder={t('扫码枪对准输入', 'Scan or type barcode')} />
            </Form.Item>
          </div>
          <Form.Item name="imageUrl" label={t('商品图', 'Product image')}>
            <ImageUpload />
          </Form.Item>
          {editProductFields.length > 0 && (
            <>
              <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                {t(
                  `「${editProduct?.productType.name}」的品类字段：`,
                  `Category fields for "${editProduct?.productType.name}":`,
                )}
              </Typography.Text>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginTop: 8 }}>
                {editProductFields.map((f) => (
                  <DynField key={f.key} f={f} />
                ))}
              </div>
            </>
          )}
          <Typography.Text type="secondary" style={{ fontSize: 11 }}>
            {t(
              '价格、成本、库存在下面规格行里改；品类不可改（换品类请新建商品）。',
              'Price, cost and stock are edited on the variant rows below. Category cannot be changed — create a new product instead.',
            )}
          </Typography.Text>
        </Form>
      </Modal>

      {/* 出入库/报损 + 库存流水 + 配方（两端功能对齐） */}
      <InventoryMoveModal
        open={moveOpen}
        onClose={() => setMoveOpen(false)}
        onDone={() => {
          reloadAfterChange()
        }}
      />
      <SkuRecordsDrawer sku={recordsSku} onClose={() => setRecordsSku(null)} />
      <RecipeModal sku={recipeSku} skuOpts={allSkuOpts} onClose={() => setRecipeSku(null)} />
    </div>
  )
}
