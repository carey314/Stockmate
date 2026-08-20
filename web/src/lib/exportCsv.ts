// 把 /export/all 返回的 JSON 转成逐表 CSV 下载（与 App 端 CSV 导出同源同构）。
// - 只处理值为「对象数组」的键（品类/商品/规格/库存/客户/供应商/销售单/进货单/收入/支出/收付款流水/出入库流水）
// - 带 BOM 头，Excel/WPS 打开中文不乱码
// - 嵌套对象/数组单元格 JSON 化，绝不丢数据
const cell = (v: unknown): string => {
  if (v === null || v === undefined) return ''
  const s = typeof v === 'object' ? JSON.stringify(v) : String(v)
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

export function rowsToCsv(rows: Record<string, unknown>[]): string {
  if (rows.length === 0) return ''
  // 表头 = 所有行键的并集（后端不同行可能字段不全）
  const headers: string[] = []
  for (const r of rows) for (const k of Object.keys(r)) if (!headers.includes(k)) headers.push(k)
  const lines = [headers.join(',')]
  for (const r of rows) lines.push(headers.map((h) => cell(r[h])).join(','))
  return '﻿' + lines.join('\n')
}

const download = (name: string, content: string) => {
  const blob = new Blob([content], { type: 'text/csv;charset=utf-8' })
  const a = document.createElement('a')
  const url = URL.createObjectURL(blob)
  a.href = url
  a.download = name
  a.click()
  // 下载是异步启动的，立即 revoke 会把还没开始的下载静默取消（headless 必现，真实浏览器偶发）
  setTimeout(() => URL.revokeObjectURL(url), 10_000)
}

/** 逐表下载 CSV，返回下载的表数。间隔触发避免浏览器拦多下载。 */
export async function downloadCsvBundle(data: Record<string, unknown>, datePrefix: string): Promise<number> {
  // /export/all 的表都包在「数据」子对象里（顶层只有 exportedAt/version/数据）
  const root = (data['数据'] ?? data) as Record<string, unknown>
  const tables = Object.entries(root).filter(
    ([, v]) => Array.isArray(v) && v.length > 0 && typeof v[0] === 'object',
  ) as [string, Record<string, unknown>[]][]
  let n = 0
  for (const [name, rows] of tables) {
    download(`${datePrefix}_${name}.csv`, rowsToCsv(rows))
    n++
    await new Promise((r) => setTimeout(r, 350))
  }
  return n
}
