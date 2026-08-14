import { Empty, Input, Modal, Spin } from 'antd'
import { AppstoreOutlined, ArrowRightOutlined, ProfileOutlined, TeamOutlined } from '@ant-design/icons'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import api from '../api/client'
import { useAuth } from '../auth'
import { NAV } from '../layout/SideNav'
import { T, primaryRgba } from '../theme'
import { t } from '../lib/i18n'

// Cmd+K 全局搜索：页面导航 + 商品 + 客户 + 订单（单号/客户名模糊），↑↓ 选择 Enter 跳转。
// 订单结果走 /orders?id= 深链直接打开详情抽屉。
interface Item {
  key: string
  group: string
  icon: React.ReactNode
  title: string
  desc?: string
  go: () => void
}

export default function CommandPalette({ open, onClose }: { open: boolean; onClose: () => void }) {
  const navigate = useNavigate()
  const { user } = useAuth()
  const isAdmin = user?.role === 'admin'
  const [q, setQ] = useState('')
  const [items, setItems] = useState<Item[]>([])
  const [active, setActive] = useState(0)
  const [busy, setBusy] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout>>(null)

  const jump = useCallback(
    (path: string) => {
      onClose()
      navigate(path)
    },
    [navigate, onClose],
  )

  const search = useCallback(
    async (kw: string) => {
      const navItems: Item[] = NAV.filter((n) => (isAdmin || !n.adminOnly) && n.label.includes(kw)).map((n) => ({
        key: `nav${n.key}`,
        group: t('页面', 'Pages'),
        icon: n.icon,
        title: n.label,
        go: () => jump(n.key),
      }))
      if (!kw.trim()) {
        setItems(navItems)
        setActive(0)
        return
      }
      setBusy(true)
      try {
        const [prods, custs, ords] = await Promise.all([
          api
            .get<{ list: { id: number; name: string; code: string }[] }>('/products', { keyword: kw, pageSize: 5 })
            .catch(() => ({ list: [] })),
          api
            .get<{ list: { id: number; name: string; phone: string | null; owed: number }[] }>('/customers', {
              keyword: kw,
              pageSize: 5,
            })
            .catch(() => ({ list: [] })),
          api
            .get<{ list: { id: number; orderNo: string; actualAmount: number; customer: { name: string } | null }[] }>(
              '/orders',
              { keyword: kw, pageSize: 5 },
            )
            .catch(() => ({ list: [] })),
        ])
        const prodItems: Item[] = prods.list.map((p) => ({
          key: `p${p.id}`,
          group: t('商品', 'Products'),
          icon: <AppstoreOutlined />,
          title: p.name,
          desc: p.code,
          go: () => jump(`/products?kw=${encodeURIComponent(p.name)}`),
        }))
        const custItems: Item[] = custs.list.map((c) => ({
          key: `c${c.id}`,
          group: t('客户', 'Customers'),
          icon: <TeamOutlined />,
          title: c.name,
          desc: c.owed > 0 ? `${t('欠', 'Owes')} ¥${c.owed}` : (c.phone ?? undefined),
          go: () => jump(`/partners?kw=${encodeURIComponent(c.name)}`),
        }))
        const ordItems: Item[] = ords.list.map((o) => ({
          key: `o${o.id}`,
          group: t('订单', 'Orders'),
          icon: <ProfileOutlined />,
          title: o.orderNo,
          desc: `${o.customer?.name ?? t('散客', 'Walk-in')} · ¥${o.actualAmount}`,
          go: () => jump(`/orders?id=${o.id}`),
        }))
        setItems([...navItems, ...prodItems, ...custItems, ...ordItems])
        setActive(0)
      } finally {
        setBusy(false)
      }
    },
    [isAdmin, jump],
  )

  useEffect(() => {
    if (!open) return
    setQ('')
    search('')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  const onChange = (v: string) => {
    setQ(v)
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(() => search(v), 250)
  }

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setActive((a) => Math.min(a + 1, items.length - 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setActive((a) => Math.max(a - 1, 0))
    } else if (e.key === 'Enter' && items[active]) {
      items[active].go()
    }
  }

  let lastGroup = ''
  return (
    <Modal
      open={open}
      onCancel={onClose}
      footer={null}
      closable={false}
      width={560}
      style={{ top: 110 }}
      styles={{ body: { padding: 8 } }}
      destroyOnHidden
    >
      <Input
        autoFocus
        size="large"
        variant="borderless"
        placeholder={t('搜页面、商品、客户…', 'Search pages, products, customers…')}
        value={q}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={onKey}
        suffix={busy ? <Spin size="small" /> : <span style={{ fontSize: 11, color: T.outlineVariant }}>esc</span>}
      />
      <div style={{ maxHeight: 420, overflowY: 'auto', borderTop: `1px solid ${T.cardBorder}`, marginTop: 4 }}>
        {items.length === 0 && !busy ? (
          <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={t('没有匹配结果', 'No matches')} style={{ padding: 24 }} />
        ) : (
          items.map((it, i) => {
            const showGroup = it.group !== lastGroup
            lastGroup = it.group
            return (
              <div key={it.key}>
                {showGroup && (
                  <div style={{ fontSize: 11, color: T.secondary, padding: '10px 12px 4px', fontWeight: 600 }}>
                    {it.group}
                  </div>
                )}
                <div
                  onClick={it.go}
                  onMouseEnter={() => setActive(i)}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 10,
                    padding: '9px 12px',
                    borderRadius: 10,
                    cursor: 'pointer',
                    background: i === active ? primaryRgba(0.08) : 'transparent',
                    color: i === active ? T.primary : T.onSurface,
                  }}
                >
                  <span style={{ fontSize: 15, display: 'flex' }}>{it.icon}</span>
                  <span style={{ fontSize: 13.5, fontWeight: 600 }}>{it.title}</span>
                  {it.desc && <span style={{ fontSize: 12, color: T.secondary }}>{it.desc}</span>}
                  {i === active && <ArrowRightOutlined style={{ marginLeft: 'auto', fontSize: 11 }} />}
                </div>
              </div>
            )
          })
        )}
      </div>
    </Modal>
  )
}
