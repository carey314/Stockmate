import { CaretDownOutlined, CaretUpOutlined } from '@ant-design/icons'
import { T, cardStyle } from '../theme'
import { t } from '../lib/i18n'
import SpotlightCard from './SpotlightCard'
import Sparkline from './Sparkline'

// 原型 _3 指标卡：图标圆片 48px + 标签 + 大数字 + 彩色趋势
// 数字独占一行、趋势固定在数字下方一行——曾试过"同行 + flexWrap"，
// 窄卡换行宽卡不换，四张卡高矮不齐还被用户截图两次，布局稳定 > 省一行高度。
// value 收 ReactNode：调用方可以塞 <CountUp/> 让数字滚动到位
export default function StatCard({
  title,
  value,
  icon,
  trend,
  trendLabel = t('较前一日', 'vs. previous day'),
  alert,
  note,
  spark,
}: {
  title: string
  value: React.ReactNode
  icon: React.ReactNode
  trend?: number | null // 比例值，null/undefined = 不显示趋势行
  trendLabel?: string
  alert?: boolean
  note?: string // 卡底红字提示（毛利不可靠等）
  spark?: number[] // 迷你趋势线（近 N 日走势）；窄卡自动隐藏（container query）
}) {
  const up = (trend ?? 0) > 0
  const flat = trend === 0
  return (
    <SpotlightCard style={{ ...cardStyle, padding: '20px 24px', overflow: 'hidden', position: 'relative' }}>
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
        <div style={{ minWidth: 0, flex: 1 }}>
          {/* nowrap 防线：容器再窄标题也不许一字一行竖排（zoom 特大 + 窄屏被截过图） */}
          <div
            style={{
              fontSize: 12,
              fontWeight: 500,
              color: T.secondary,
              marginBottom: 2,
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
            }}
          >
            {title}
          </div>
          <div
            style={{
              fontSize: 24,
              fontWeight: 700,
              lineHeight: '30px',
              letterSpacing: '-0.02em',
              color: alert ? T.error : T.onSurface,
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
            }}
          >
            {value}
          </div>
          {/* 趋势行常驻占位（没有趋势也占高）：四张卡永远等高 */}
          <div
            style={{
              fontSize: 12,
              fontWeight: 600,
              lineHeight: '18px',
              minHeight: 18,
              whiteSpace: 'nowrap',
              color: flat ? T.secondary : up ? T.emerald : T.error,
            }}
          >
            {trend !== null && trend !== undefined && (
              <>
                {flat ? (
                  t('持平', 'Flat')
                ) : (
                  <>
                    {up ? <CaretUpOutlined /> : <CaretDownOutlined />} {up ? '+' : ''}
                    {Math.round(trend * 100)}%
                  </>
                )}{' '}
                {trendLabel}
              </>
            )}
          </div>
        </div>
        {/* 迷你趋势线做成右下角低透明度水印：不占布局，窄卡也能放（曾用容器查询挤在行尾，
            常态宽度下直接被藏没了） */}
        {spark && spark.length >= 2 && (
          <div className="stat-spark" style={{ position: 'absolute', right: 14, bottom: 10, opacity: 0.55, pointerEvents: 'none' }}>
            <Sparkline data={spark} color={alert ? T.error : T.primary} />
          </div>
        )}
      </div>
      {note && (
        <div style={{ fontSize: 12, color: T.error, marginTop: 8, lineHeight: '17px' }}>{note}</div>
      )}
    </SpotlightCard>
  )
}
