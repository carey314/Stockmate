import { Tag, Tooltip } from 'antd'
import { CrownOutlined } from '@ant-design/icons'
import type { useAppProps } from 'antd/es/app/context'
import dayjs from 'dayjs'
import { APP_STORE_URL } from '../config'
import type { ApiError } from '../api/client'
import { refreshEntitlement, useEntitlement } from '../hooks/useEntitlement'
import { t } from '../lib/i18n'
import { T } from '../theme'

// ===== 额度小标签（用在 4 个 AI 页面；轻量，不做横幅）=====
export function AiQuotaTag({ bucket }: { bucket: 'core' | 'other' }) {
  const { ent } = useEntitlement()
  if (!ent) return null // 拿不到就不显示（铁律：不编数字）
  const used = bucket === 'core' ? ent.today.coreUsed : ent.today.otherUsed
  const limit = bucket === 'core' ? ent.today.coreLimit : ent.today.otherLimit
  // null = 不限次。别当 0 算，会给付费用户误报"额度用完"
  if (ent.plan !== 'free') {
    return (
      <Tag icon={<CrownOutlined />} color="gold" style={{ borderRadius: 999 }}>
        {t('专业版 · 不限次', 'Pro · Unlimited')}
      </Tag>
    )
  }
  // 免费版但服务端没配额度（FREE_AI_DAILY_* 未设=不限量）：无墙可撞，不显示也不冒充专业版
  if (limit === null) return null
  const left = Math.max(0, limit - used)
  return (
    <Tag color={left <= 0 ? 'red' : left <= 2 ? 'orange' : 'default'} style={{ borderRadius: 999 }}>
      {left <= 0 ? t('今天的额度用完了', 'Daily quota used up') : t(`今天还能用 ${left} 次`, `${left} left today`)}
    </Tag>
  )
}

// ===== 专业版说明与免费承诺（文案与 App 一致，别自己发挥）=====
const PRO_DESC = () =>
  t(
    '专业版：AI 口述记账不限次。记账、报表、对账这些功能免费版本来就有，订阅只增加 AI 用量。',
    'Pro: unlimited AI entries. Bookkeeping, reports and statements are free forever — the subscription only adds AI usage.',
  )
const FREE_PROMISE = () =>
  t(
    '开单、进货、库存、欠款、报表、对账、打印、导出——这些记账功能永久免费，不会变成收费项，数据也随时能全量导出。',
    'Orders, purchasing, stock, receivables, reports, statements, printing and export stay free forever, and your data is always fully exportable.',
  )
const PRICE_NOTE = () =>
  t('¥19/月 或 ¥168/年（年付省 26%），以 App Store 实际价格为准。', '¥19/mo or ¥168/yr (save 26% yearly) — App Store pricing applies.')

/**
 * AI 调用失败的统一分流。返回 true = 已处理（页面别再 toast）。
 * 402 = 免费额度用完 → 升级引导 Modal（员工版不带升级按钮）
 * 429 = 专业版防滥用上限 → 不弹升级引导（人家付过钱了），页面照常 toast 原文
 */
export function handleAiQuotaError(e: unknown, modal: useAppProps['modal'], isAdmin: boolean): boolean {
  const err = e as ApiError
  if (err?.status !== 402) return false
  refreshEntitlement() // 撞墙说明额度状态变了，同步刷新各处标签
  modal.info({
    title: t('今天的 AI 额度用完了', 'Daily AI quota reached'),
    width: 460,
    okText: t('知道了', 'Got it'),
    content: (
      <div style={{ fontSize: 13, lineHeight: '22px', display: 'flex', flexDirection: 'column', gap: 10 }}>
        {/* 后端原文，与 App 保持一致 */}
        <div>{err.message}</div>
        {isAdmin ? (
          <>
            <div style={{ background: T.surfaceContainerLow, borderRadius: 12, padding: '10px 12px' }}>
              <b>{PRO_DESC()}</b>
              <div style={{ color: T.secondary, marginTop: 4, fontSize: 12 }}>{PRICE_NOTE()}</div>
            </div>
            {APP_STORE_URL ? (
              <a href={APP_STORE_URL} target="_blank" rel="noreferrer">
                <b>{t('去 App Store 开通专业版', 'Get Pro on the App Store')}</b>
              </a>
            ) : (
              <div style={{ color: T.onSurfaceVariant }}>
                {t('在 iPhone 的 App Store 里搜「智存」下载，登录同一个账号即可开通。', 'Search “StockMate 智存” on the iPhone App Store and sign in with the same account to subscribe.')}
              </div>
            )}
            <div style={{ color: T.secondary, fontSize: 12 }}>{FREE_PROMISE()}</div>
          </>
        ) : (
          // 员工买不了也不该买——不放升级按钮，只告知找老板
          <div style={{ color: T.onSurfaceVariant }}>
            {t('额度是全店共享的，明天 0 点自动恢复；要提额请联系老板开通专业版。', 'The quota is shared store-wide and resets at midnight. Ask the owner about upgrading to Pro.')}
          </div>
        )}
      </div>
    ),
  })
  return true
}

// ===== 顶栏专业版标识（plan !== 'free' 时显示，带到期时间）=====
export function ProBadge() {
  const { ent } = useEntitlement()
  if (!ent || ent.plan === 'free') return null
  const exp = ent.expiresAt
    ? t(`${dayjs(ent.expiresAt).format('YYYY-MM-DD')} 到期`, `Expires ${dayjs(ent.expiresAt).format('MMM D, YYYY')}`)
    : t('永久有效', 'Lifetime')
  return (
    <Tooltip title={exp}>
      <Tag icon={<CrownOutlined />} color="gold" style={{ borderRadius: 999, marginInlineEnd: 0 }}>
        {t('专业版', 'Pro')}
      </Tag>
    </Tooltip>
  )
}
