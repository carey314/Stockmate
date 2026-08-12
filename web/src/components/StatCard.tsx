import { CaretDownOutlined, CaretUpOutlined } from '@ant-design/icons'
import { T, cardStyle } from '../theme'
import SpotlightCard from './SpotlightCard'

// 原型 _3 指标卡：图标圆片 48px + 标签 + 大数字 + 裸彩色趋势文字（非 chip）
// value 收 ReactNode：调用方可以塞 <CountUp/> 让数字滚动到位
export default function StatCard({
  title,
  value,
  icon,
  trend,
  trendLabel = '较前一日',
  alert,
  note,
}: {
  title: string
  value: React.ReactNode
  icon: React.ReactNode
  trend?: number | null // 比例值，null/undefined = 不显示趋势行
  trendLabel?: string
  alert?: boolean
  note?: string // 卡底红字提示（毛利不可靠等）
}) {
  const up = (trend ?? 0) > 0
  const flat = trend === 0
  return (
    <SpotlightCard style={{ ...cardStyle, padding: '22px 24px', overflow: 'hidden' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
        <div
          style={{
            width: 48,
            height: 48,
            borderRadius: 999,
            background: alert ? T.errorContainer : T.surfaceContainerHigh,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: 21,
            color: alert ? T.error : T.primary,
            flexShrink: 0,
          }}
        >
          {icon}
        </div>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 12, fontWeight: 500, color: T.secondary, marginBottom: 4 }}>{title}</div>
          {/* flexWrap：宽卡时数字+趋势同行（原型形态），窄卡时趋势换到第二行，绝不溢出卡外 */}
          <div style={{ display: 'flex', alignItems: 'flex-end', gap: 8, flexWrap: 'wrap', rowGap: 0 }}>
            <span
              style={{
                fontSize: 24,
                fontWeight: 700,
                lineHeight: '30px',
                letterSpacing: '-0.02em',
                color: alert ? T.error : T.onSurface,
                whiteSpace: 'nowrap',
              }}
            >
              {value}
            </span>
            {trend !== null && trend !== undefined && (
              <span
                style={{
                  fontSize: 12,
                  fontWeight: 600,
                  marginBottom: 3,
                  whiteSpace: 'nowrap',
                  color: flat ? T.secondary : up ? T.emerald : T.error,
                }}
              >
                {flat ? '持平' : (
                  <>
                    {up ? <CaretUpOutlined /> : <CaretDownOutlined />} {up ? '+' : ''}
                    {Math.round(trend * 100)}%
                  </>
                )}{' '}
                {trendLabel}
              </span>
            )}
          </div>
        </div>
      </div>
      {note && (
        <div style={{ fontSize: 12, color: T.error, marginTop: 10, lineHeight: '17px' }}>{note}</div>
      )}
    </SpotlightCard>
  )
}
