import { CaretDownOutlined, CaretUpOutlined } from '@ant-design/icons'
import { T, cardStyle } from '../theme'

// 原型 _3 指标卡：图标圆片 48px + 标签 + 大数字 + 裸彩色趋势文字（非 chip）
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
  value: string | number
  icon: React.ReactNode
  trend?: number | null // 比例值，null/undefined = 不显示趋势行
  trendLabel?: string
  alert?: boolean
  note?: string // 卡底红字提示（毛利不可靠等）
}) {
  const up = (trend ?? 0) > 0
  const flat = trend === 0
  return (
    <div style={{ ...cardStyle, padding: '22px 24px' }}>
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
          <div style={{ display: 'flex', alignItems: 'flex-end', gap: 8 }}>
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
    </div>
  )
}
