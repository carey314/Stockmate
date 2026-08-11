import dayjs from 'dayjs'
import relativeTime from 'dayjs/plugin/relativeTime'

dayjs.extend(relativeTime)

export const fmtMoney = (n: number) =>
  `¥${Number(n).toLocaleString('zh-CN', { maximumFractionDigits: 2 })}`

// 数量去尾零（散称 0.5 斤），绝不 toFixed
export const fmtQty = (n: number) => String(parseFloat(Number(n).toFixed(3)))

// 24h 内相对时间，更早显示日期（UTC ISO 自动转本地）
export const fmtTime = (iso: string) => {
  const d = dayjs(iso)
  return dayjs().diff(d, 'hour') < 24 ? d.fromNow() : d.format('MM-DD HH:mm')
}
