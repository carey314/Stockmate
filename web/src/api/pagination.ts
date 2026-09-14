import api from './client'

/** Read a complete snapshot or reject: a partial list must never masquerade as all debts/choices. */
export async function fetchAllPages<T>(url: string, params: object = {}): Promise<T[]> {
  const result: T[] = []
  const seen = new Set<unknown>()
  let total: number | undefined
  for (let page = 1; ; page++) {
    const data = await api.get<{ list: T[]; pagination: { total: number } }>(url, { ...params, page, pageSize: 200 })
    if (!Array.isArray(data.list) || !Number.isSafeInteger(data.pagination?.total) || data.pagination.total < 0) {
      throw new Error('列表分页信息不完整，请重试')
    }
    if (total !== undefined && total !== data.pagination.total) throw new Error('列表在读取期间发生变化，请重试')
    total = data.pagination.total
    for (const row of data.list) {
      const id = (row as { id?: unknown }).id
      if (id !== undefined) {
        if (seen.has(id)) throw new Error('列表分页有重复，未能完整读取，请重试')
        seen.add(id)
      }
      result.push(row)
    }
    if (result.length === total) return result
    if (!data.list.length || result.length > total) throw new Error('列表未能完整读取，请重试')
  }
}
