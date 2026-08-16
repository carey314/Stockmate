import { App, Button, Drawer, Empty, List, Segmented, Spin, Tooltip } from 'antd'
import {
  CreditCardOutlined,
  DollarOutlined,
  InboxOutlined,
  LeftOutlined,
  MinusCircleOutlined,
  PlusCircleOutlined,
  RetweetOutlined,
  RightOutlined,
  RollbackOutlined,
  ShoppingCartOutlined,
  WalletOutlined,
} from '@ant-design/icons'
import type { ReactNode } from 'react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import dayjs, { type Dayjs } from 'dayjs'
import { useNavigate } from 'react-router-dom'
import api from '../api/client'
import { fmtMoney } from '../lib/format'
import { dateFormat, t } from '../lib/i18n'
import { T, cardStyle } from '../theme'
import { useAuth } from '../auth'
import CountUp from '../components/CountUp'

// ===== 类型（对齐 server/src/controllers/calendar.js 的响应）=====

interface DayTotal {
  income: number
  expense: number
  net: number
}
interface CalEvent {
  at: string
  kind: string
  direction: 'in' | 'out'
  amount: number
  title: string
  account?: string | null
  orderId?: number | null
  purchaseOrderId?: number | null
}
interface WeekDay extends DayTotal {
  count: number
  events: CalEvent[] // ⚠️ 每天只带前 8 笔，逐笔全量走 /calendar/day
}
interface MonthResp {
  month: string
  days: Record<string, DayTotal>
}
interface WeekResp {
  start: string
  days: Record<string, WeekDay>
}
interface DayResp {
  date: string
  day: DayTotal
  month: DayTotal
  year: DayTotal
  events: CalEvent[]
}

// key 与后端 calendar.js 的 kind 对齐（不可改），label 是渲染文案
const KIND: Record<string, { label: string; icon: ReactNode }> = {
  sale: { label: t('卖货收款', 'Sale payment'), icon: <ShoppingCartOutlined /> },
  receive: { label: t('收回欠款', 'Debt collected'), icon: <DollarOutlined /> },
  purchase: { label: t('进货付款', 'Purchase payment'), icon: <InboxOutlined /> },
  refundOut: { label: t('退款给客户', 'Refund to customer'), icon: <RollbackOutlined /> },
  refundIn: { label: t('供应商退回', 'Refund from supplier'), icon: <RetweetOutlined /> },
  dailyIncome: { label: t('其他收入', 'Other income'), icon: <WalletOutlined /> },
  expense: { label: t('开销', 'Expense'), icon: <CreditCardOutlined /> },
  otherIn: { label: t('收入', 'Income'), icon: <PlusCircleOutlined /> },
  otherOut: { label: t('支出', 'Expense'), icon: <MinusCircleOutlined /> },
}

const L_INCOME = t('收入', 'Income')
const L_EXPENSE = t('支出', 'Expense')
const L_NET = t('净', 'Net')

const GREEN = T.emerald
const RED = T.error

// 格子里的紧凑净额：+¥1.2万 / −¥612.6
const fmtNet = (n: number) => {
  const sign = n > 0 ? '+' : n < 0 ? '−' : ''
  const abs = Math.abs(n)
  const s =
    abs >= 10000
      ? t(
          `${(abs / 10000).toFixed(1).replace(/\.0$/, '')}万`,
          `${(abs / 1000).toFixed(1).replace(/\.0$/, '')}k`,
        )
      : abs.toLocaleString('zh-CN', { maximumFractionDigits: 2 })
  return `${sign}¥${s}`
}
const netColor = (n: number) => (n > 0 ? GREEN : n < 0 ? RED : T.secondary)

const WEEKDAYS = ['一', '二', '三', '四', '五', '六', '日']
const WEEKDAYS_EN = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
// 周一 = 0（表头与 Drawer 标题共用，两处必须一致）
const weekdayLabel = (i: number) => t(`周${WEEKDAYS[i]}`, WEEKDAYS_EN[i])
// 周一开头（与 App 月历一致）
const mondayOf = (d: Dayjs) => d.subtract((d.day() + 6) % 7, 'day').startOf('day')

// ===== 事件小卡（月/周格子里铺的那种）=====

function EventCard({ ev, onClick }: { ev: CalEvent; onClick?: () => void }) {
  const isIn = ev.direction === 'in'
  const color = isIn ? GREEN : RED
  return (
    <Tooltip title={`${dayjs(ev.at).format('HH:mm')} ${ev.title} · ${fmtMoney(ev.amount)}`} mouseEnterDelay={0.3}>
      <div
        onClick={onClick}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 5,
          padding: '2px 6px',
          borderRadius: 6,
          background: isIn ? 'rgba(16,185,129,0.10)' : 'rgba(186,26,26,0.08)',
          fontSize: 11,
          lineHeight: '17px',
          cursor: onClick ? 'pointer' : undefined,
          minWidth: 0,
        }}
      >
        <span style={{ width: 6, height: 6, borderRadius: 3, background: color, flexShrink: 0 }} />
        <span
          style={{
            flex: 1,
            minWidth: 0,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
            color: T.onSurfaceVariant,
          }}
        >
          {KIND[ev.kind]?.label ?? ev.title}
        </span>
        <span style={{ color, fontWeight: 700, flexShrink: 0 }}>
          {isIn ? '+' : '−'}
          {ev.amount.toLocaleString('zh-CN', { maximumFractionDigits: 2 })}
        </span>
      </div>
    </Tooltip>
  )
}

// ===== 页面 =====

export default function CalendarPage() {
  const { message } = App.useApp()
  const { user } = useAuth()
  const navigate = useNavigate()
  const [view, setView] = useState<'month' | 'week'>('month')
  const [anchor, setAnchor] = useState<Dayjs>(() => dayjs().startOf('day'))
  const [loading, setLoading] = useState(false)
  const [monthDays, setMonthDays] = useState<Record<string, DayTotal>>({})
  // 月/周格子的逐笔小卡都来自 /calendar/week（month 接口本身不带事件）
  const [weekDays, setWeekDays] = useState<Record<string, WeekDay>>({})

  const today = dayjs().startOf('day')
  const isAdmin = user?.role === 'admin'

  // 月视图网格：从当月 1 号所在周的周一起，铺满整月
  const gridStart = useMemo(() => mondayOf(anchor.startOf('month')), [anchor])
  const weekCount = useMemo(() => {
    const offset = (anchor.startOf('month').day() + 6) % 7
    return Math.ceil((offset + anchor.daysInMonth()) / 7)
  }, [anchor])

  const load = useCallback(async () => {
    setLoading(true)
    try {
      if (view === 'month') {
        // month 给每天的收/支/净；再用整月覆盖的几个 week 请求拿到每日前 8 笔喂格子小卡
        const starts = Array.from({ length: weekCount }, (_, i) => gridStart.add(i * 7, 'day'))
        const [m, ...weeks] = await Promise.all([
          api.get<MonthResp>('/calendar/month', { month: anchor.format('YYYY-MM') }),
          ...starts.map((s) => api.get<WeekResp>('/calendar/week', { start: s.format('YYYY-MM-DD') })),
        ])
        setMonthDays(m.days)
        const merged: Record<string, WeekDay> = {}
        for (const w of weeks) Object.assign(merged, w.days)
        setWeekDays(merged)
      } else {
        const w = await api.get<WeekResp>('/calendar/week', {
          start: mondayOf(anchor).format('YYYY-MM-DD'),
        })
        setWeekDays(w.days)
      }
    } catch (e) {
      message.error((e as Error).message)
    } finally {
      setLoading(false)
    }
  }, [view, anchor, gridStart, weekCount, message])

  useEffect(() => {
    if (isAdmin) load()
  }, [load, isAdmin])

  // ===== 选中日 Drawer（逐笔明细走 /calendar/day，全量）=====
  const [dayResp, setDayResp] = useState<DayResp | null>(null)
  const [dayLoading, setDayLoading] = useState(false)
  const openDay = async (dateKey: string) => {
    setDayLoading(true)
    setDayResp(null)
    try {
      setDayResp(await api.get<DayResp>('/calendar/day', { date: dateKey }))
    } catch (e) {
      message.error((e as Error).message)
    } finally {
      setDayLoading(false)
    }
  }

  const jumpToDoc = (ev: CalEvent) => {
    if (ev.orderId) navigate(`/orders?id=${ev.orderId}`)
    else if (ev.purchaseOrderId) navigate(`/purchase?id=${ev.purchaseOrderId}`)
  }

  if (!isAdmin) {
    return (
      <div style={{ ...cardStyle, padding: 48 }}>
        <Empty description={t('收益日历仅老板可用', 'The cash calendar is available to the owner only')} />
      </div>
    )
  }

  const step = (dir: 1 | -1) =>
    setAnchor((a) => (view === 'month' ? a.add(dir, 'month').startOf('month') : a.add(dir * 7, 'day')))

  const weekStarts7 = Array.from({ length: 7 }, (_, i) => mondayOf(anchor).add(i, 'day'))
  const monthDayFmt = t('M月D日', 'MMM D')
  const title =
    view === 'month'
      ? anchor.format(t('YYYY年M月', 'MMMM YYYY'))
      : `${weekStarts7[0].format(monthDayFmt)} – ${weekStarts7[6].format(monthDayFmt)}`

  // 顶部汇总条：月视图汇总当月，周视图汇总本周（都来自已加载数据，不多打接口）
  const summarySource: DayTotal[] =
    view === 'month'
      ? Object.values(monthDays)
      : weekStarts7.map((d) => weekDays[d.format('YYYY-MM-DD')]).filter(Boolean)
  const sum = summarySource.reduce(
    (a, d) => ({ income: a.income + d.income, expense: a.expense + d.expense }),
    { income: 0, expense: 0 },
  )
  const sumNet = Math.round((sum.income - sum.expense) * 100) / 100

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {/* 顶栏：视图切换 + 翻页 + 汇总 */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <Segmented
          value={view}
          onChange={(v) => setView(v as 'month' | 'week')}
          options={[
            { label: t('月', 'Month'), value: 'month' },
            { label: t('周', 'Week'), value: 'week' },
          ]}
        />
        <Button icon={<LeftOutlined />} size="small" shape="circle" onClick={() => step(-1)} />
        <span style={{ fontSize: 17, fontWeight: 700, color: T.onSurface, minWidth: 130, textAlign: 'center' }}>
          {title}
        </span>
        <Button icon={<RightOutlined />} size="small" shape="circle" onClick={() => step(1)} />
        <Button size="small" onClick={() => setAnchor(today)}>
          {t('回今天', 'Today')}
        </Button>
        <span style={{ marginLeft: 'auto', fontSize: 13, color: T.secondary }}>
          {view === 'month'
            ? t('本月收入', 'Income this month')
            : t('本周收入', 'Income this week')}{' '}
          <b style={{ color: GREEN }}>
            <CountUp value={sum.income} format={fmtMoney} speedBlur />
          </b>{' '}
          · {L_EXPENSE}{' '}
          <b style={{ color: RED }}>
            <CountUp value={sum.expense} format={fmtMoney} speedBlur />
          </b>{' '}
          · {L_NET}{' '}
          <b style={{ color: netColor(sumNet) }}>
            <CountUp value={sumNet} format={fmtNet} />
          </b>
          <span style={{ marginLeft: 8, color: T.outlineVariant }}>
            {t('现金口径，与资金流水一致', 'Cash basis, matching the cash flow report')}
          </span>
        </span>
      </div>

      <Spin spinning={loading}>
        {/* 窄屏时 7 列格子横向滚动（minWidth 兜底），不挤成一列竖条 */}
        <div style={{ ...cardStyle, padding: 20, overflowX: 'auto' }}>
          <div style={{ minWidth: 720 }}>
          {/* 星期表头 */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 8, marginBottom: 8 }}>
            {WEEKDAYS.map((w, i) => (
              <div key={w} style={{ textAlign: 'center', fontSize: 12, fontWeight: 700, color: T.secondary }}>
                {weekdayLabel(i)}
              </div>
            ))}
          </div>

          {view === 'month' ? (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 8 }}>
              {Array.from({ length: weekCount * 7 }, (_, i) => {
                const d = gridStart.add(i, 'day')
                const key = d.format('YYYY-MM-DD')
                const inMonth = d.month() === anchor.month()
                const isToday = d.isSame(today, 'day')
                const isFuture = d.isAfter(today, 'day')
                const total = monthDays[key]
                const wd = weekDays[key]
                const cards = wd?.events.slice(0, 3) ?? []
                const more = (wd?.count ?? 0) - cards.length
                return (
                  <div
                    key={key}
                    onClick={isFuture ? undefined : () => openDay(key)}
                    style={{
                      minHeight: 112,
                      borderRadius: 12,
                      border: isToday ? `1.5px solid ${T.primary}` : `1px solid ${T.cardBorder}`,
                      boxShadow: isToday ? T.glowShadow : undefined,
                      background: inMonth ? '#fff' : T.surfaceContainerLow,
                      opacity: isFuture ? 0.45 : inMonth ? 1 : 0.6,
                      padding: 6,
                      cursor: isFuture ? 'default' : 'pointer',
                      display: 'flex',
                      flexDirection: 'column',
                      gap: 3,
                      minWidth: 0,
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                      <span
                        style={{
                          fontSize: 12,
                          fontWeight: 700,
                          color: isToday ? '#fff' : T.onSurfaceVariant,
                          background: isToday ? T.primary : 'transparent',
                          borderRadius: 999,
                          minWidth: 20,
                          height: 20,
                          display: 'inline-flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          padding: '0 4px',
                        }}
                      >
                        {d.date()}
                      </span>
                      {total && (
                        <span style={{ fontSize: 11, fontWeight: 700, color: netColor(total.net) }}>
                          {fmtNet(total.net)}
                        </span>
                      )}
                    </div>
                    {cards.map((ev, j) => (
                      <EventCard key={j} ev={ev} />
                    ))}
                    {more > 0 && (
                      <span style={{ fontSize: 11, color: T.secondary, paddingLeft: 6 }}>
                        {t(`+${more} 笔`, `+${more} more`)}
                      </span>
                    )}
                  </div>
                )
              })}
            </div>
          ) : (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 8 }}>
              {weekStarts7.map((d) => {
                const key = d.format('YYYY-MM-DD')
                const isToday = d.isSame(today, 'day')
                const isFuture = d.isAfter(today, 'day')
                const wd = weekDays[key]
                const more = (wd?.count ?? 0) - (wd?.events.length ?? 0)
                return (
                  <div
                    key={key}
                    onClick={isFuture ? undefined : () => openDay(key)}
                    style={{
                      minHeight: 320,
                      borderRadius: 12,
                      border: isToday ? `1.5px solid ${T.primary}` : `1px solid ${T.cardBorder}`,
                      boxShadow: isToday ? T.glowShadow : undefined,
                      background: '#fff',
                      opacity: isFuture ? 0.45 : 1,
                      padding: 8,
                      cursor: isFuture ? 'default' : 'pointer',
                      display: 'flex',
                      flexDirection: 'column',
                      gap: 4,
                      minWidth: 0,
                    }}
                  >
                    <div style={{ textAlign: 'center', marginBottom: 4 }}>
                      <div style={{ fontSize: 15, fontWeight: 700, color: isToday ? T.primary : T.onSurface }}>
                        {d.date()}
                      </div>
                      {wd ? (
                        <div style={{ fontSize: 11, fontWeight: 700, color: netColor(wd.net) }}>{fmtNet(wd.net)}</div>
                      ) : (
                        <div style={{ fontSize: 11, color: T.outlineVariant }}>—</div>
                      )}
                    </div>
                    {wd?.events.map((ev, j) => (
                      <EventCard key={j} ev={ev} onClick={() => openDay(key)} />
                    ))}
                    {more > 0 && (
                      <span
                        style={{ fontSize: 11, color: T.primary, fontWeight: 600, textAlign: 'center', marginTop: 2 }}
                      >
                        {t(`+${more} 笔，点开看全部`, `+${more} more — tap to see all`)}
                      </span>
                    )}
                  </div>
                )
              })}
            </div>
          )}
          </div>
        </div>
      </Spin>

      {/* 选中日：日/月/年三级汇总 + 逐笔清单（全量，分页渲染） */}
      <Drawer
        open={!!dayResp || dayLoading}
        onClose={() => setDayResp(null)}
        width={520}
        title={
          dayResp
            ? `${dayjs(dayResp.date).format(dateFormat)} ${weekdayLabel((dayjs(dayResp.date).day() + 6) % 7)}`
            : t('加载中', 'Loading')
        }
        styles={{ body: { padding: 20 } }}
      >
        {dayLoading && (
          <div style={{ textAlign: 'center', paddingTop: 60 }}>
            <Spin />
          </div>
        )}
        {dayResp && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            {/* 当日汇总 */}
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(3, 1fr)',
                gap: 8,
                background: T.surfaceContainerLow,
                borderRadius: 16,
                padding: 16,
              }}
            >
              {(
                [
                  [L_INCOME, dayResp.day.income, GREEN],
                  [L_EXPENSE, dayResp.day.expense, RED],
                  [L_NET, dayResp.day.net, netColor(dayResp.day.net)],
                ] as const
              ).map(([label, v, color]) => (
                <div key={label} style={{ textAlign: 'center' }}>
                  <div style={{ fontSize: 12, color: T.secondary }}>{label}</div>
                  <div style={{ fontSize: 18, fontWeight: 800, color }}>
                    <CountUp value={v} format={label === L_NET ? fmtNet : fmtMoney} duration={500} />
                  </div>
                </div>
              ))}
            </div>
            {/* 月/年累计 */}
            <div style={{ fontSize: 12, color: T.secondary, lineHeight: '20px' }}>
              <div>
                {t('本月累计：收 ', 'Month to date: in ')}
                <b style={{ color: GREEN }}>{fmtMoney(dayResp.month.income)}</b>
                {t(' · 支 ', ' · out ')}
                <b style={{ color: RED }}>{fmtMoney(dayResp.month.expense)}</b>
                {t(' · 净 ', ' · net ')}
                <b style={{ color: netColor(dayResp.month.net) }}>{fmtNet(dayResp.month.net)}</b>
              </div>
              <div>
                {t('今年累计：收 ', 'Year to date: in ')}
                <b style={{ color: GREEN }}>{fmtMoney(dayResp.year.income)}</b>
                {t(' · 支 ', ' · out ')}
                <b style={{ color: RED }}>{fmtMoney(dayResp.year.expense)}</b>
                {t(' · 净 ', ' · net ')}
                <b style={{ color: netColor(dayResp.year.net) }}>{fmtNet(dayResp.year.net)}</b>
              </div>
            </div>
            {/* 逐笔清单：一天几百笔靠分页渲染扛住 */}
            {dayResp.events.length === 0 ? (
              <Empty
                description={t('这天没有收支', 'No money in or out on this day')}
                image={Empty.PRESENTED_IMAGE_SIMPLE}
              />
            ) : (
              <List
                size="small"
                dataSource={dayResp.events}
                pagination={
                  dayResp.events.length > 30
                    ? {
                        pageSize: 30,
                        size: 'small',
                        showTotal: (n: number) => t(`共 ${n} 笔`, `${n} entries in total`),
                      }
                    : false
                }
                renderItem={(ev) => {
                  const isIn = ev.direction === 'in'
                  const color = isIn ? GREEN : RED
                  const linkable = !!(ev.orderId || ev.purchaseOrderId)
                  return (
                    <List.Item
                      onClick={linkable ? () => jumpToDoc(ev) : undefined}
                      style={{ cursor: linkable ? 'pointer' : undefined, padding: '10px 4px' }}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', gap: 12, width: '100%', minWidth: 0 }}>
                        <span
                          style={{
                            width: 32,
                            height: 32,
                            borderRadius: 10,
                            flexShrink: 0,
                            display: 'inline-flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            fontSize: 15,
                            color,
                            background: isIn ? 'rgba(16,185,129,0.10)' : 'rgba(186,26,26,0.08)',
                          }}
                        >
                          {KIND[ev.kind]?.icon ?? <PlusCircleOutlined />}
                        </span>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div
                            style={{
                              fontSize: 13,
                              fontWeight: 600,
                              color: T.onSurface,
                              overflow: 'hidden',
                              textOverflow: 'ellipsis',
                              whiteSpace: 'nowrap',
                            }}
                          >
                            {ev.title}
                            {linkable && <span style={{ color: T.primary, fontWeight: 400 }}> ›</span>}
                          </div>
                          <div style={{ fontSize: 11, color: T.secondary }}>
                            {dayjs(ev.at).format('HH:mm')}
                            {ev.account ? ` · ${ev.account}` : ''}
                            {` · ${KIND[ev.kind]?.label ?? ''}`}
                          </div>
                        </div>
                        <span style={{ fontWeight: 700, fontSize: 14, color, flexShrink: 0 }}>
                          {isIn ? '+' : '−'}
                          {fmtMoney(ev.amount)}
                        </span>
                      </div>
                    </List.Item>
                  )
                }}
              />
            )}
          </div>
        )}
      </Drawer>
    </div>
  )
}
