import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, expect, test, vi } from 'vitest'
import { App } from 'antd'
import api from '../src/api/client'
import ManualSaleModal from '../src/components/ManualSaleModal'
const { auth } = vi.hoisted(() => ({ auth: { user: { id: 1 }, profile: { id: 1, storeId: 10 } } }))
vi.mock('../src/auth', () => ({ useAuth: () => auth }))
beforeEach(() => {
 const computedStyle=window.getComputedStyle.bind(window);vi.spyOn(window,'getComputedStyle').mockImplementation(el=>computedStyle(el))
 auth.user.id = 1; auth.profile.id = 1; auth.profile.storeId = 10; localStorage.setItem('sm_token', 'A')
 vi.spyOn(api, 'get').mockImplementation((url) => Promise.resolve(url === '/pricing/resolve' ? {price: 8,source:'customer'} : {list: url === '/customers' ? [{id:7,name:'老王'}] : [{id:1,name:'苹果',unit:'斤',skus:[{id:9,specText:'红',price:10,status:1}]}],pagination:{total:1}}) as any)
})
const mount = (done=vi.fn()) => render(<App><ManualSaleModal open onClose={vi.fn()} onCreated={done}/></App>)
async function add() {
 await screen.findByText('苹果 红 · 斤')
 fireEvent.change(screen.getByLabelText('商品与规格'), {target:{value:'9'}})
 await screen.findByLabelText('数量 1')
}
test('小数、客户价、优惠和部分收款直接提交orders，成功清稿打开详情', async () => {
 const done=vi.fn(), post=vi.spyOn(api,'post').mockResolvedValue({id:21,negativeStock:[]}); mount(done)
 await screen.findByText('老王')
 fireEvent.change(screen.getByLabelText('客户'),{target:{value:'7'}}); await waitFor(()=>expect((screen.getByLabelText('客户') as HTMLSelectElement).value).toBe('7')); await add()
 await waitFor(()=>expect((screen.getByLabelText('单价 1') as HTMLInputElement).value).toBe('8'))
 fireEvent.change(screen.getByLabelText('数量 1'),{target:{value:'1.25'}})
 fireEvent.change(screen.getByLabelText('整单优惠'),{target:{value:'2'}})
 fireEvent.change(screen.getByLabelText('实收'),{target:{value:'5'}})
 fireEvent.change(screen.getByLabelText('结算账户'),{target:{value:'微信'}})
 fireEvent.click(screen.getByRole('button',{name:/确认开单/})); await waitFor(()=>expect(done).toHaveBeenCalledWith(21))
 expect(post).toHaveBeenCalledWith('/orders',expect.objectContaining({customerId:7,items:[{skuId:9,quantity:1.25,unitPrice:8}],discountAmount:2,paidAmount:5,settlementAccount:'微信',requestId:expect.any(String)}))
 cleanup();mount();expect(screen.queryByLabelText('数量 1')).toBeNull()
 expect(post.mock.calls.every(([url])=>url==='/orders')).toBe(true)
})
test('未知失败锁定原payload，刷新重试相同ID；双击仅一请求',async()=>{
 const post=vi.spyOn(api,'post').mockRejectedValue(new Error('网络中断'));mount();await add()
 fireEvent.click(screen.getByRole('button',{name:/确认开单/}));fireEvent.click(screen.getByRole('button',{name:/重试原单|确认开单/})); await screen.findByText(/网络中断。结果尚未确认/)
 expect(post).toHaveBeenCalledTimes(1);const first=post.mock.calls[0][1]
 expect(screen.getByLabelText('数量 1').closest('fieldset')?.disabled).toBe(true)
 cleanup();mount();fireEvent.click(screen.getByRole('button',{name:/重试原单/}));await waitFor(()=>expect(post).toHaveBeenCalledTimes(2));expect(post.mock.calls[1][1]).toEqual(first)
})
test('草稿按店铺账号隔离，旧页面换号不能发送',async()=>{
 const post=vi.spyOn(api,'post').mockResolvedValue({id:1});mount();await add()
 localStorage.setItem('sm_token','B');fireEvent.click(screen.getByRole('button',{name:/确认开单/}));await act(async()=>{});expect(post).not.toHaveBeenCalled()
 cleanup();auth.user.id=2;mount();expect(screen.queryByLabelText('数量 1')).toBeNull()
 cleanup();auth.user.id=1;auth.profile.storeId=20;mount();expect(screen.queryByLabelText('数量 1')).toBeNull()
})
test('保存失败阻止请求；散客欠款阻止提交',async()=>{
 const post=vi.spyOn(api,'post').mockResolvedValue({id:1});mount();await add()
 fireEvent.change(screen.getByLabelText('实收'),{target:{value:'1'}});fireEvent.click(screen.getByRole('button',{name:/确认开单/}));await act(async()=>{});expect(post).not.toHaveBeenCalled()
 fireEvent.change(screen.getByLabelText('实收'),{target:{value:'10'}})
 vi.spyOn(Storage.prototype,'setItem').mockImplementation(()=>{throw new Error('full')})
 fireEvent.click(screen.getByRole('button',{name:/确认开单/}));await act(async()=>{});expect(post).not.toHaveBeenCalled()
})
test('明确400后可以更正，并生成新的请求编号',async()=>{
 const post=vi.spyOn(api,'post').mockRejectedValueOnce(Object.assign(new Error('校验失败'),{status:400})).mockResolvedValue({id:1});mount();await add()
 fireEvent.click(screen.getByRole('button',{name:/确认开单/}));await screen.findByText('校验失败');const first=post.mock.calls[0][1] as any
 fireEvent.change(screen.getByLabelText('数量 1'),{target:{value:'2'}});fireEvent.click(screen.getByRole('button',{name:/确认开单/}));await waitFor(()=>expect(post).toHaveBeenCalledTimes(2));expect((post.mock.calls[1][1] as any).requestId).not.toBe(first.requestId)
})
test('已收成功但清草稿失败时刷新仍重试原单，不另建单',async()=>{
 let resolve!:(v:unknown)=>void
 const post=vi.spyOn(api,'post').mockImplementationOnce(()=>new Promise(r=>{resolve=r}));const done=vi.fn();mount(done);await add()
 fireEvent.click(screen.getByRole('button',{name:/确认开单/}));const first=post.mock.calls[0][1]
 const write=vi.spyOn(Storage.prototype,'setItem').mockImplementation(()=>{throw new Error('full')})
 await act(()=>resolve({id:32}));expect(done).not.toHaveBeenCalled();expect(screen.getByLabelText('数量 1').closest('fieldset')?.disabled).toBe(true)
 write.mockRestore();cleanup();post.mockResolvedValue({id:32});mount(done)
 fireEvent.click(screen.getByRole('button',{name:/重试原单/}));await waitFor(()=>expect(done).toHaveBeenCalledWith(32));expect(post.mock.calls[1][1]).toEqual(first)
})
test('切换客户重取客户价格，价格查询失败保留原客户和价格',async()=>{
 mount();await add();fireEvent.change(screen.getByLabelText('客户'),{target:{value:'7'}})
 await waitFor(()=>expect((screen.getByLabelText('单价 1') as HTMLInputElement).value).toBe('8'))
 fireEvent.change(screen.getByLabelText('客户'),{target:{value:''}})
 await waitFor(()=>expect((screen.getByLabelText('单价 1') as HTMLInputElement).value).toBe('10'))
 vi.mocked(api.get).mockRejectedValueOnce(new Error('客户价读取失败'))
 fireEvent.change(screen.getByLabelText('客户'),{target:{value:'7'}});await screen.findByText('客户价读取失败')
 expect((screen.getByLabelText('客户') as HTMLSelectElement).value).toBe('');expect((screen.getByLabelText('单价 1') as HTMLInputElement).value).toBe('10')
})
test('旧标签不能覆盖另一个标签的待确认草稿',async()=>{
 const post=vi.spyOn(api,'post');mount();await add()
 const key=Object.keys(localStorage).find(k=>k.endsWith(':manual-sale'))!;const stored=JSON.parse(localStorage.getItem(key)!)
 localStorage.setItem(key,JSON.stringify({...stored,value:{...stored.value,notes:'另一标签保存'}}))
 fireEvent.click(screen.getByRole('button',{name:/确认开单/}));await act(async()=>{});expect(post).not.toHaveBeenCalled()
 expect(JSON.parse(localStorage.getItem(key)!).value.notes).toBe('另一标签保存')
})
test('慢profile不挂载临时草稿，验证店铺后恢复原店待确认请求',async()=>{
 const post=vi.spyOn(api,'post').mockRejectedValue(new Error('网络中断'));mount();await add()
 fireEvent.click(screen.getByRole('button',{name:/确认开单/}));await screen.findByText(/网络中断。结果尚未确认/)
 const original=post.mock.calls[0][1]
 cleanup();auth.profile.storeId=undefined as unknown as number;vi.mocked(api.get).mockClear()
 const view=mount()
 expect(screen.queryByRole('button',{name:/确认开单|重试原单/})).toBeNull()
 expect(screen.queryByLabelText('商品与规格')).toBeNull()
 expect(vi.mocked(api.get)).not.toHaveBeenCalled()
 expect(Object.keys(localStorage).some(key=>key.includes('account:1:manual-sale'))).toBe(false)
 expect(post).toHaveBeenCalledTimes(1)
 auth.profile.storeId=10;view.rerender(<App><ManualSaleModal open onClose={vi.fn()} onCreated={vi.fn()}/></App>)
 fireEvent.click(await screen.findByRole('button',{name:/重试原单/}));await waitFor(()=>expect(post).toHaveBeenCalledTimes(2));expect(post.mock.calls[1][1]).toEqual(original)
})
test.each([{id:2,storeId:10},{id:1,storeId:0},{id:1,storeId:-1},{id:1,storeId:1.5}])('未验证的profile %j不能挂载或读取销售数据',async(profile)=>{
 Object.assign(auth.profile,profile);const post=vi.spyOn(api,'post');mount()
 expect(screen.queryByLabelText('商品与规格')).toBeNull()
 expect(vi.mocked(api.get)).not.toHaveBeenCalled();expect(post).not.toHaveBeenCalled()
 expect(Object.keys(localStorage).some(key=>key.endsWith(':manual-sale'))).toBe(false)
})
