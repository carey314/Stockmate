import { Empty, Skeleton, Tag, Typography } from 'antd'
import {
  AccountBookOutlined,
  InboxOutlined,
  RiseOutlined,
  ShoppingOutlined,
  TeamOutlined,
  WarningOutlined,
} from '@ant-design/icons'
import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import api from '../api/client'
import { useAuth } from '../auth'
import { fmtMoney, fmtQty } from '../lib/format'
import { t } from '../lib/i18n'
import { T, cardStyle } from '../theme'

interface Overview {
  todaySales: number
  todayOrderCount: number
  todayProfit: number
  profitUnreliable: boolean
  lowStockCount: number
}
interface AlertRow {
  id: number
  quantity: number
  minQuantity: number
  sku: { specText: string; product: { name: string; unit: string } }
}
interface Party {
  id: number
  name: string
  owed?: number
  unpaidCount?: number
}

function Card({
  icon,
  title,
  count,
  countColor,
  children,
}: {
  icon: React.ReactNode
  title: string
  count?: number
  countColor?: string
  children: React.ReactNode
}) {
  return (
    <div style={{ ...cardStyle, padding: 22 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14 }}>
        <span style={{ fontSize: 18, color: countColor ?? T.primary }}>{icon}</span>
        <Typography.Text strong style={{ fontSize: 16 }}>
          {title}
        </Typography.Text>
        {count != null && count > 0 && (
          <Tag color={countColor === T.error ? 'red' : 'blue'} style={{ borderRadius: 999 }}>
            {count}
          </Tag>
        )}
      </div>
      {children}
    </div>
  )
}

// 一条待办行：文案 + 右侧跳转
function Row({ text, action, onClick }: { text: React.ReactNode; action: string; onClick: () => void }) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '8px 12px',
        borderRadius: 12,
        background: T.surfaceContainerLow,
        marginBottom: 6,
        fontSize: 13,
      }}
    >
      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{text}</span>
      <a onClick={onClick} style={{ flexShrink: 0, marginLeft: 10, color: T.primary, cursor: 'pointer' }}>
        {action} →
      </a>
    </div>
  )
}

export default function TodoPage() {
  const { user, profile } = useAuth()
  const navigate = useNavigate()
  const isAdmin = user?.role === 'admin'

  const [ov, setOv] = useState<Overview | null>(null)
  const [alerts, setAlerts] = useState<AlertRow[] | null>(null)
  const [owedCustomers, setOwedCustomers] = useState<Party[] | null>(null)
  const [owedSuppliers, setOwedSuppliers] = useState<Party[] | null>(null)

  useEffect(() => {
    api.get<Overview>('/stats/overview').then(setOv).catch(() => setOv(null))
    api.get<AlertRow[]>('/inventory/alerts').then(setAlerts).catch(() => setAlerts([]))
    api
      .get<{ list: Party[] }>('/customers', { pageSize: 200 })
      .then((d) => setOwedCustomers(d.list.filter((c) => (c.owed ?? 0) > 0).sort((a, b) => (b.owed ?? 0) - (a.owed ?? 0))))
      .catch(() => setOwedCustomers([]))
    api
      .get<{ list: Party[] }>('/suppliers', { pageSize: 200 })
      .then((d) => setOwedSuppliers(d.list.filter((s) => (s.owed ?? 0) > 0).sort((a, b) => (b.owed ?? 0) - (a.owed ?? 0))))
      .catch(() => setOwedSuppliers([]))
  }, [])

  const totalCustomerOwed = (owedCustomers ?? []).reduce((s, c) => s + (c.owed ?? 0), 0)
  const totalSupplierOwed = (owedSuppliers ?? []).reduce((s, c) => s + (c.owed ?? 0), 0)

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <Typography.Text type="secondary" style={{ fontSize: 13 }}>
        {profile?.shopName || t('你的店', 'Your store')}
        {t(' 今天要处理的事，都聚在这', ' — everything that needs your attention today, in one place')}
      </Typography.Text>

      {/* 今日小结 */}
      <Card icon={<RiseOutlined />} title={t('今日小结', "Today's summary")}>
        {ov ? (
          <div style={{ display: 'flex', gap: 32, flexWrap: 'wrap' }}>
            <Stat icon={<AccountBookOutlined />} label={t('今日销售额', "Today's sales")} value={fmtMoney(ov.todaySales)} />
            <Stat icon={<ShoppingOutlined />} label={t('今日订单', "Today's orders")} value={String(ov.todayOrderCount)} />
            {isAdmin && (
              <Stat
                icon={<RiseOutlined />}
                label={ov.profitUnreliable ? t('今日毛利*', "Today's gross profit*") : t('今日毛利', "Today's gross profit")}
                value={fmtMoney(ov.todayProfit)}
              />
            )}
          </div>
        ) : (
          <Skeleton active paragraph={{ rows: 1 }} />
        )}
      </Card>

      {/* 缺货补货 */}
      <Card
        icon={<InboxOutlined />}
        title={t('该补的货', 'Stock to reorder')}
        count={alerts?.length}
        countColor={alerts && alerts.length > 0 ? T.error : undefined}
      >
        {alerts === null ? (
          <Skeleton active paragraph={{ rows: 2 }} />
        ) : alerts.length === 0 ? (
          <Typography.Text type="secondary" style={{ fontSize: 13 }}>
            {t('✓ 没有低于预警线的商品', '✓ Nothing below its reorder point')}
          </Typography.Text>
        ) : (
          alerts.map((a) => (
            <Row
              key={a.id}
              text={
                <>
                  <WarningOutlined style={{ color: T.error, marginRight: 6 }} />
                  {a.sku.product.name}
                  {a.sku.specText ? t(`（${a.sku.specText}）`, ` (${a.sku.specText})`) : ''}
                  {t(' 只剩 ', ' is down to ')}
                  <b style={{ color: T.error }}>{fmtQty(a.quantity)}</b>
                  <span style={{ color: T.secondary }}>/{fmtQty(a.minQuantity)}{a.sku.product.unit}</span>
                </>
              }
              action={t('去进货', 'Purchase')}
              onClick={() => navigate('/purchase')}
            />
          ))
        )}
      </Card>

      {/* 客户欠款 */}
      <Card
        icon={<TeamOutlined />}
        title={t('谁欠我钱', 'Who owes me')}
        count={owedCustomers?.length}
        countColor={owedCustomers && owedCustomers.length > 0 ? T.error : undefined}
      >
        {owedCustomers === null ? (
          <Skeleton active paragraph={{ rows: 2 }} />
        ) : owedCustomers.length === 0 ? (
          <Typography.Text type="secondary" style={{ fontSize: 13 }}>
            {t('✓ 没有客户欠款', '✓ No customer owes you anything')}
          </Typography.Text>
        ) : (
          <>
            <Typography.Paragraph style={{ fontSize: 12.5, color: T.secondary, marginBottom: 8 }}>
              {t('共欠 ', 'Outstanding total ')}
              <b style={{ color: T.error }}>{fmtMoney(totalCustomerOwed)}</b>
              {t('，按金额从高到低：', ', highest first:')}
            </Typography.Paragraph>
            {owedCustomers.slice(0, 8).map((c) => (
              <Row
                key={c.id}
                text={
                  <>
                    {c.name}
                    {t(' 欠 ', ' owes ')}
                    <b style={{ color: T.error }}>{fmtMoney(c.owed!)}</b>
                    <span style={{ color: T.secondary }}>{t(`（${c.unpaidCount} 单）`, ` (${c.unpaidCount} orders)`)}</span>
                  </>
                }
                action={t('打对账单', 'Statement')}
                onClick={() => navigate('/statements')}
              />
            ))}
          </>
        )}
      </Card>

      {/* 欠供应商 */}
      <Card
        icon={<InboxOutlined />}
        title={t('我欠谁钱', 'Who I owe')}
        count={owedSuppliers?.length}
        countColor={owedSuppliers && owedSuppliers.length > 0 ? T.orange : undefined}
      >
        {owedSuppliers === null ? (
          <Skeleton active paragraph={{ rows: 1 }} />
        ) : owedSuppliers.length === 0 ? (
          <Typography.Text type="secondary" style={{ fontSize: 13 }}>
            {t('✓ 没有欠供应商货款', '✓ Nothing owed to suppliers')}
          </Typography.Text>
        ) : (
          <>
            <Typography.Paragraph style={{ fontSize: 12.5, color: T.secondary, marginBottom: 8 }}>
              {t('共欠供应商 ', 'Total payable to suppliers ')}
              <b style={{ color: T.orange }}>{fmtMoney(totalSupplierOwed)}</b>
              {t('：', ':')}
            </Typography.Paragraph>
            {owedSuppliers.slice(0, 8).map((s) => (
              <Row
                key={s.id}
                text={
                  <>
                    {s.name}
                    {t(' 欠 ', ' is owed ')}
                    <b style={{ color: T.orange }}>{fmtMoney(s.owed!)}</b>
                    <span style={{ color: T.secondary }}>{t(`（${s.unpaidCount} 单）`, ` (${s.unpaidCount} bills)`)}</span>
                  </>
                }
                action={t('去付款', 'Pay')}
                onClick={() => navigate('/purchase')}
              />
            ))}
          </>
        )}
      </Card>

      {alerts?.length === 0 && owedCustomers?.length === 0 && owedSuppliers?.length === 0 && (
        <Empty description={t('太好了，没有待办事项 🎉', 'All clear — nothing to handle 🎉')} style={{ padding: 20 }} />
      )}
    </div>
  )
}

function Stat({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
      <span style={{ fontSize: 17, color: T.primary }}>{icon}</span>
      <div>
        <div style={{ fontSize: 12, color: T.secondary }}>{label}</div>
        <div style={{ fontSize: 18, fontWeight: 700 }}>{value}</div>
      </div>
    </div>
  )
}
