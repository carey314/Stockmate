import { describe, expect, it } from 'vitest'
import { parseTable, createTemplate, rowsToCsv } from '../src/lib/standardImport'
const fields = [
  {key:'brand',label:'品牌',scope:'product' as const,type:'text',required:true},
  {key:'size',label:'尺寸',scope:'sku' as const,type:'select',options:['大','小']},
]
describe('标准表格纯解析，不调用AI', () => {
  it('模板包含scope字段；BOM/CRLF/引号、逗号和换行均保留', () => {
    const header=createTemplate(fields).trim().replace(/^\uFEFF/,'')
    expect(header).toContain('product.brand|品牌');expect(header).toContain('sku.size|尺寸')
    const text=`\uFEFF${header}\r\nP1,"苹果,梨",斤,P1-A,"大\r\n红",12.50,,1.5,0001,农场,大\r\n`
    const result=parseTable(text,fields);expect(result.unknownColumns).toEqual([]);expect(result.rows).toHaveLength(1)
    expect(result.rows[0]).toMatchObject({name:'苹果,梨',specText:'大\r\n红',barcode:'0001',costPrice:'',customFields:{brand:'农场'},specValues:{size:'大'}})
    expect(parseTable(rowsToCsv(result.rows,fields),fields).rows[0]).toEqual(result.rows[0])
  })
  it('Excel制表符粘贴和escaped quotes，保留空白成本',()=>{
    const text='商品编码\t名称\t单位\t规格编码\t规格描述\t售价\t成本\t期初数量\t条码\r\nP1\t"苹果""精品"\t斤\tP1\t红\t10\t\t0.5\t001'
    expect(parseTable(text,[]).rows[0]).toMatchObject({name:'苹果"精品',costPrice:'',initQuantity:'0.5'})
  })
  it('不静默丢弃未知列，重复表头/缺必要列/不齐行/未闭合引号明确拒绝',()=>{
    expect(parseTable('商品编码,名称,单位,规格编码,售价,期初数量,额外\nP,A,斤,S,1,0,秘密',[]).unknownColumns).toEqual(['额外'])
    expect(()=>parseTable('名称,名称\nA,B',[])).toThrow(/重复/)
    expect(()=>parseTable('名称,售价\nA,1',[])).toThrow(/缺少/)
    expect(()=>parseTable('商品编码,名称,单位,规格编码,售价,期初数量\nP,A,斤,S,1',[])).toThrow(/列数/)
    expect(()=>parseTable('商品编码,名称,单位,规格编码,售价,期初数量\nP,"A,斤,S,1,0',[])).toThrow(/引号/)
  })
  it('2MB和1000规格限制不截断',()=>{
    expect(()=>parseTable('a'.repeat(2*1024*1024+1),[])).toThrow(/2MB/)
    const header='商品编码,名称,单位,规格编码,售价,期初数量\n'
    expect(parseTable(header+Array.from({length:1000},(_,i)=>`P${i},A,斤,S${i},1,0`).join('\n'),[]).rows).toHaveLength(1000)
    expect(()=>parseTable(header+Array.from({length:1001},(_,i)=>`P${i},A,斤,S${i},1,0`).join('\n'),[])).toThrow(/1000/)
  })
})
