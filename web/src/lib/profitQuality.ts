import { fmtMoney } from './format'
import { t } from './i18n'

export interface ProfitQuality {
  historyIncomplete?: boolean
  profitUnreliable?: boolean
}
export function profitProblem(value: unknown, quality: ProfitQuality): string | null {
  if (quality.historyIncomplete) return t('历史记录不完整，请核对历史单据。', 'Historical records are incomplete. Review past documents.')
  if (quality.profitUnreliable) return t('成本缺失，暂无法准确计算利润。', 'Cost records are missing; profit cannot yet be calculated accurately.')
  if (typeof value !== 'number' || !Number.isFinite(value)) return t('利润数据缺失或无效，请刷新后重试。', 'Profit data is missing or invalid. Refresh and try again.')
  return null
}
export const reliableProfit = (value: unknown, quality: ProfitQuality) => profitProblem(value, quality) === null
export const profitText = (value: unknown, quality: ProfitQuality) => reliableProfit(value, quality)
  ? fmtMoney(value as number)
  : t('暂无法准确计算', 'Cannot calculate accurately yet')
