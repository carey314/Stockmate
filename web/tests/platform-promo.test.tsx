import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { App } from 'antd'
import PromoPage from '../src/platform/PromoPage'
import { platformApi } from '../src/platform/api'
import { setPlatformToken } from '../src/platform/session'
afterEach(()=>vi.unstubAllGlobals())
beforeEach(()=>{
 vi.stubGlobal('ResizeObserver',class{observe(){} unobserve(){} disconnect(){}})
 setPlatformToken('platform-A');const computed=window.getComputedStyle.bind(window);vi.spyOn(window,'getComputedStyle').mockImplementation(el=>computed(el))
 vi.spyOn(platformApi,'get').mockResolvedValue({list:[],total:0,page:1,pageSize:20})
})
const mount=()=>render(<App><PromoPage adminId={1}/></App>)
async function generate(){fireEvent.change(screen.getByLabelText('批次备注'),{target:{value:'本地体验'}});fireEvent.click(screen.getByRole('button',{name:/生成体验码/}))}
test('完整码仅主动查看后展示，存储不包含完整码',async()=>{
 const post=vi.spyOn(platformApi,'post').mockResolvedValue({batch:{id:3,label:'本地体验',count:1},codes:[{id:9,code:'PRIVATE-CODE-SECRET',hint:'尾码RET'}]});mount();await generate()
 await screen.findByText(/本批已生成/);expect(screen.queryByText('PRIVATE-CODE-SECRET')).toBeNull()
 expect(JSON.stringify(localStorage)+JSON.stringify(sessionStorage)).not.toContain('PRIVATE-CODE-SECRET')
 fireEvent.click(screen.getByRole('button',{name:/查看完整体验码/}));expect(screen.getByText('PRIVATE-CODE-SECRET')).toBeTruthy()
 expect(post).toHaveBeenCalledWith('/platform/promo-batches',expect.objectContaining({requestId:expect.any(String),count:1,label:'本地体验',redeemExpiresAt:null}))
})
test('网络不确定锁原payload，重载恢复同ID；重复点击不多发',async()=>{
 const post=vi.spyOn(platformApi,'post').mockRejectedValue(new Error('网络断开'));mount();await generate();await screen.findByText(/网络断开/)
 const first=post.mock.calls[0][1];expect((screen.getByLabelText('批次备注') as HTMLInputElement).disabled).toBe(true)
 cleanup();mount();fireEvent.click(screen.getByRole('button',{name:/重试原批次/}));await waitFor(()=>expect(post).toHaveBeenCalledTimes(2));expect(post.mock.calls[1][1]).toEqual(first)
})
test('生成结果换号后不显示完整码，保存失败不发送',async()=>{
 let resolve!:(v:unknown)=>void;const post=vi.spyOn(platformApi,'post').mockImplementation(()=>new Promise(r=>{resolve=r}));mount();await generate();setPlatformToken('platform-B')
 await act(()=>resolve({batch:{id:3,count:1},codes:[{id:9,code:'OLD-SECRET',hint:'RET'}]}));expect(screen.queryByText(/本批已生成/)).toBeNull()
 cleanup();sessionStorage.clear();mount();vi.spyOn(Storage.prototype,'setItem').mockImplementation(()=>{throw new Error('full')});await generate();await act(async()=>{});expect(post).toHaveBeenCalledTimes(1)
})
test('收回仅已领码可用，要求原因并提示Apple权益独立',async()=>{
 vi.mocked(platformApi.get).mockImplementation(url=>Promise.resolve({list:url.includes('promo-codes')?[{id:9,codeHint:'尾码ABC',state:'redeemed',batchId:1,batchLabel:'体验',storeId:3,userId:5,createdAt:'2026-01-01'}]:[],total:1,page:1,pageSize:20}) as any)
 const post=vi.spyOn(platformApi,'post').mockResolvedValue({});mount();fireEvent.click(await screen.findByRole('button',{name:/收回赠送/}))
 expect(screen.getByText(/不会撤销.*Apple/)).toBeTruthy()
 fireEvent.click(screen.getByRole('button',{name:/确认收回/}));expect(post).not.toHaveBeenCalled()
 fireEvent.change(screen.getByLabelText('操作原因'),{target:{value:'发错店铺'}});fireEvent.click(screen.getByRole('button',{name:/确认收回/}));await waitFor(()=>expect(post).toHaveBeenCalledWith('/platform/promo-codes/9/revoke',{reason:'发错店铺'}))
})
test('明确400拒绝后可改正生成条件，未受理批次不永久锁住',async()=>{
 const post=vi.spyOn(platformApi,'post').mockRejectedValueOnce(Object.assign(new Error('批次备注无效'),{status:400}));mount();await generate();await screen.findByText('批次备注无效')
 expect((screen.getByLabelText('批次备注') as HTMLInputElement).disabled).toBe(false)
 expect(screen.getByRole('button',{name:/生成体验码/})).toBeTruthy()
})
test('UUID批次筛选完整填写后才查询，不逐字符发送无效ID',async()=>{
 mount();await waitFor(()=>expect(platformApi.get).toHaveBeenCalledTimes(2));const id='c9946358-fd1a-4e65-8b27-c41a0f92f2bc'
 fireEvent.change(screen.getByLabelText('筛选批次编号'),{target:{value:id}});await act(async()=>{});expect(platformApi.get).toHaveBeenCalledTimes(2)
 fireEvent.click(screen.getByRole('button',{name:/应用码筛选/}));await waitFor(()=>expect(platformApi.get).toHaveBeenCalledWith('/platform/promo-codes',expect.objectContaining({batchId:id})))
})
