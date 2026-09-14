import { expect, test, vi } from 'vitest'
import api from '../src/api/client'
import { fetchAllPages } from '../src/api/pagination'
test.each([203,501])('%s 条数据取全，包含最早对象与欠款合计',async(total)=>{
 const rows=Array.from({length:total},(_,i)=>({id:i+1,owed:i===total-1?500:0}))
 const get=vi.spyOn(api,'get').mockImplementation((_url,params:any)=>Promise.resolve({list:rows.slice((params.page-1)*200,params.page*200),pagination:{total}}) as any)
 const result=await fetchAllPages<{id:number;owed:number}>('/products')
 expect(result).toHaveLength(total);expect(result.at(-1)?.id).toBe(total)
 expect(result.reduce((s,r)=>s+r.owed,0)).toBe(500);expect(get).toHaveBeenCalledTimes(Math.ceil(total/200))
})
test.each(['network','empty','duplicate','changed','missing'])('分页 %s 拒绝返回部分数据',async(mode)=>{
 const get=vi.spyOn(api,'get').mockResolvedValueOnce({list:[{id:1}],pagination:{total:2}})
 if(mode==='network')get.mockRejectedValueOnce(new Error('断网'))
 else get.mockResolvedValueOnce(mode==='empty'?{list:[],pagination:{total:2}}:mode==='duplicate'?{list:[{id:1}],pagination:{total:2}}:mode==='changed'?{list:[{id:2}],pagination:{total:3}}:{list:[{id:2}]})
 await expect(fetchAllPages('/customers')).rejects.toThrow()
})
