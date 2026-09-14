export interface ImportField { key: string; label: string; scope: 'product' | 'sku'; type: string; required?: boolean; options?: string[] }
export interface ImportType { id: number; name: string; fields: ImportField[] }
export interface ImportRow {
  rowId: string; code: string; name: string; unit: string; skuCode: string; specText: string
  price: string; costPrice: string; initQuantity: string; barcode: string
  customFields: Record<string, string>; specValues: Record<string, string>
}
export interface RowError { field: string; message: string }
export interface ValidatedRow extends Omit<ImportRow, 'price' | 'costPrice' | 'initQuantity' | 'customFields' | 'specValues'> {
  price: number | null; costPrice: number | null; initQuantity: number | null
  customFields: Record<string, unknown>; specValues: Record<string, unknown>; errors: RowError[]
}
export interface ImportPayload { batchId: string; productTypeId: number; rows: ImportRow[]; selectedRowIds?: string[] }
export interface ImportResult { rowId: string; code: string; name: string; status: 'success' | 'failed'; productId?: number; skuId?: number; errors?: RowError[] }
export const MAX_BYTES = 2 * 1024 * 1024
const baseColumns = [ ['商品编码','code'],['名称','name'],['单位','unit'],['规格编码','skuCode'],['规格描述','specText'],['售价','price'],['成本','costPrice'],['期初数量','initQuantity'],['条码','barcode'] ] as const
const quote = (value: unknown) => `"${String(value ?? '').replace(/"/g, '""')}"`
const headers = (fields: ImportField[]) => [...baseColumns.map(([label]) => label), ...fields.map(f => `${f.scope}.${f.key}|${f.label}`)]
export const createTemplate = (fields: ImportField[]) => '\uFEFF' + headers(fields).map(quote).join(',') + '\r\n'
export const rowsToCsv = (rows: ImportRow[], fields: ImportField[]) => createTemplate(fields) + rows.map(row => [
  ...baseColumns.map(([,key]) => row[key]), ...fields.map(f => (f.scope === 'product' ? row.customFields : row.specValues)[f.key] ?? ''),
].map(quote).join(',')).join('\r\n')

/** RFC4180-style quoted fields, also for Excel TSV. Numeric strings stay strings until server validation. */
export function parseTable(input: string, fields: ImportField[]): { rows: ImportRow[]; unknownColumns: string[] } {
  if (new TextEncoder().encode(input).length > MAX_BYTES) throw new Error('每批最多2MB，请拆分导入')
  const text = input.replace(/^\uFEFF/, '')
  let inside = false, separator = ','
  for (let i = 0; i < text.length; i++) {
    if (text[i] === '"') { if (inside && text[i + 1] === '"') i++; else inside = !inside }
    if (!inside && text[i] === '\t') { separator = '\t'; break }
    if (!inside && (text[i] === '\n' || text[i] === '\r')) break
  }
  const table: string[][] = []; let cells: string[] = [], value = '', quoted = false, closed = false
  const cell = () => { cells.push(value); value = ''; closed = false }
  const row = () => { cell(); if (cells.some(c => c.trim())) table.push(cells); cells = [] }
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (quoted) { if (c === '"') { if (text[i + 1] === '"') { value += '"'; i++ } else { quoted = false; closed = true } } else value += c; continue }
    if (c === '"') { if (value || closed) throw new Error('引号格式错误：包含引号的单元格须整体加引号'); quoted = true }
    else if (c === separator) cell()
    else if (c === '\n' || c === '\r') { row(); if (c === '\r' && text[i + 1] === '\n') i++ }
    else { if (closed) throw new Error('闭合引号后存在多余字符'); value += c }
  }
  if (quoted) throw new Error('单元格引号未闭合')
  if (value || cells.length || closed) row()
  if (table.length < 2) throw new Error('请粘贴表头和至少一行商品数据')
  const names = table[0].map(v => v.trim())
  const identifiers = names.map(name => name.split('|')[0])
  if (new Set(identifiers).size !== identifiers.length) throw new Error('表头重复，请检查列名')
  for (const required of ['商品编码','名称','单位','规格编码','售价','期初数量']) if (!names.includes(required)) throw new Error(`缺少必要列：${required}`)
  if (table.length - 1 > 1000) throw new Error('每批最多1000规格行，请分批导入')
  const known = new Set<string>([...baseColumns.map(([label]) => label), ...fields.map(f => `${f.scope}.${f.key}`)])
  const unknownColumns = names.filter((_,i) => !known.has(identifiers[i]))
  const rows = table.slice(1).map((values,index) => {
    if (values.length !== names.length) throw new Error(`第${index + 2}行列数与表头不一致，请修正后重新上传`)
    const result: ImportRow = {rowId:String(index+2),code:'',name:'',unit:'',skuCode:'',specText:'',price:'',costPrice:'',initQuantity:'',barcode:'',customFields:{},specValues:{}}
    for (const [label,key] of baseColumns) { const i = names.indexOf(label); if (i >= 0) result[key] = values[i] }
    for (const f of fields) { const i = identifiers.indexOf(`${f.scope}.${f.key}`); if (i >= 0) (f.scope === 'product' ? result.customFields : result.specValues)[f.key] = values[i] }
    return result
  })
  return {rows,unknownColumns}
}
