import { cleanup, act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, expect, test, vi } from 'vitest'
import api from '../src/api/client'
import QuickEntryPage from '../src/pages/QuickEntryPage'
const { auth } = vi.hoisted(()=>({auth:{user:{id:1,role:'admin'},profile:{id:1,storeId:10,mainTypeId:1}}}))
vi.mock('../src/auth',()=>({useAuth:()=>auth}))
beforeEach(()=>{auth.user.id=1;auth.profile.storeId=10;localStorage.setItem('sm_token','A')})
vi.mock('../src/components/AiQuota',()=>({AiQuotaTag:()=>null,handleAiQuotaError:()=>false}))
vi.mock('../src/hooks/useEntitlement',()=>({refreshEntitlement:vi.fn()}))
vi.mock('antd',()=>{
 const Box=({children}:any)=><div>{children}</div>
 const Input=({value,onChange,placeholder}:any)=><input value={value??''} onChange={onChange} placeholder={placeholder}/>
 Input.TextArea=Input
 return {App:{useApp:()=>({message:{warning:vi.fn(),success:vi.fn(),error:vi.fn()},modal:{}})},Input,Button:({children,onClick,disabled}:any)=><button disabled={disabled} onClick={onClick}>{children}</button>,Checkbox:({children,checked,onChange,disabled}:any)=><label><input type="checkbox" checked={checked} disabled={disabled} onChange={onChange}/>{children}</label>,Table:({dataSource,columns}:any)=><div>{dataSource.map((r:any,i:number)=><div key={i}>{columns.map((c:any,j:number)=><span key={j}>{c.render?.(null,r,i)}</span>)}</div>)}</div>,Select:({value,options,onChange}:any)=><select value={value??''} onChange={e=>onChange(options.find((o:any)=>String(o.value)===e.target.value)?.value)}><option value=""/>{options.map((o:any)=><option key={o.value} value={o.value}>{o.label}</option>)}</select>,Typography:{Text:Box,Paragraph:Box},Tooltip:Box,Tag:Box,Alert:Box,Empty:Box}
})
async function draft(sales:any[]=[],purchases:any[]=[]) {
 vi.spyOn(api,'get').mockImplementation((url)=>Promise.resolve(url==='/product-types'?[{id:1,name:'品类'}]:{list:[{id:7,name:'供应商'}],pagination:{total:1}}) as any)
 const post=vi.spyOn(api,'post').mockImplementation((url)=>url==='/ai/parse-entry'?Promise.resolve({sales,purchases,expenses:[],aggregates:[],warnings:[],todayContext:null}):Promise.reject(new Error('网络断开')))
 render(<QuickEntryPage/>);fireEvent.change(screen.getByPlaceholderText(/把要记的事/),{target:{value:'卖出两件货'}});fireEvent.click(screen.getByText('AI 解析'));await screen.findByText('确认入账勾选的项');return post
}
test('改单价后提交一致总额，网络重试保留同requestId',async()=>{
 const post=await draft([{name:'货',quantity:2,unit:'件',unitPrice:10,totalAmount:20,paid:true,suggestedSkuId:9,customer:null,matchedProduct:{id:1,name:'货',unit:'件'}}]);
 fireEvent.change(screen.getByPlaceholderText('按标价'),{target:{value:'15'}});fireEvent.click(screen.getByText('确认入账勾选的项'));
 await waitFor(()=>expect(post).toHaveBeenCalledTimes(2));const first=post.mock.calls[1][1] as any;expect(first.sales[0]).toMatchObject({unitPrice:15,totalAmount:30});expect(first.requestId).toBeTruthy();
 fireEvent.click(screen.getByText('确认入账勾选的项'));await waitFor(()=>expect(post).toHaveBeenCalledTimes(3));expect((post.mock.calls[2][1] as any).requestId).toBe(first.requestId)
})
test('未建档且未选建档的进货明确expenseOnly并提交编辑后金额',async()=>{
 const post=await draft([],[{name:'临时材料',quantity:2,unit:'件',unitCost:5,totalCost:10,matchedProduct:null,suggestedType:null}]);
 fireEvent.change(screen.getByPlaceholderText('单价'),{target:{value:'8'}});fireEvent.click(screen.getByText('确认入账勾选的项'));
 await waitFor(()=>expect(post).toHaveBeenCalledTimes(2));expect((post.mock.calls[1][1] as any).purchases[0]).toMatchObject({expenseOnly:true,unitCost:8,totalCost:16})
})
test('多规格采购提交所选整箱SKU与挂账供应商',async()=>{
 const post=await draft([],[{name:'货',quantity:2,unit:'箱',unitCost:50,totalCost:100,suggestedSkuId:null,matchedProduct:{id:1,name:'货',unit:'件',skus:[{id:9,specText:'单件'},{id:10,specText:'整箱'}]},suggestedType:null}]);
 const skuOption=screen.getByText('整箱');fireEvent.change(skuOption.closest('select')!,{target:{value:'10'}});
 fireEvent.change(screen.getByText('供应商').closest('select')!,{target:{value:'7'}});
 fireEvent.change(screen.getByText('挂账').closest('select')!,{target:{value:'挂账'}});
 fireEvent.click(screen.getByText('确认入账勾选的项'));await waitFor(()=>expect(post).toHaveBeenCalledTimes(2));expect((post.mock.calls[1][1] as any).purchases[0]).toMatchObject({skuId:10,supplierId:7,paidAmount:0,settlementAccount:'挂账'})
})
test('网络结果不明时冻结确认内容，修改界面也不能换内容或ID重发',async()=>{
 const post=await draft([{name:'货',quantity:2,unit:'件',unitPrice:10,totalAmount:20,paid:true,suggestedSkuId:9,customer:null,matchedProduct:{id:1,name:'货',unit:'件'}}])
 fireEvent.click(screen.getByText('确认入账勾选的项'));await waitFor(()=>expect(post).toHaveBeenCalledTimes(2))
 const first=post.mock.calls[1][1] as any
 fireEvent.change(screen.getByPlaceholderText('按标价'),{target:{value:'99'}})
 fireEvent.click(screen.getByText('确认入账勾选的项'));await waitFor(()=>expect(post).toHaveBeenCalledTimes(3))
 expect(post.mock.calls[2][1]).toEqual(first);expect(first.requestId).toBeTruthy()
})
test.each([400,404])('明确%s后允许改正草案，并为未入账的新草案生成新ID',async(status)=>{
 const post=await draft([{name:'货',quantity:2,unit:'件',unitPrice:10,totalAmount:20,paid:true,suggestedSkuId:9,customer:null,matchedProduct:{id:1,name:'货',unit:'件'}}])
 post.mockRejectedValueOnce(Object.assign(new Error('草案无效'),{status}))
 fireEvent.click(screen.getByText('确认入账勾选的项'));await waitFor(()=>expect(post).toHaveBeenCalledTimes(2));const first=post.mock.calls[1][1] as any
 fireEvent.change(screen.getByPlaceholderText('按标价'),{target:{value:'15'}})
 fireEvent.click(screen.getByText('确认入账勾选的项'));await waitFor(()=>expect(post).toHaveBeenCalledTimes(3));const second=post.mock.calls[2][1] as any
 expect(second.requestId).toBeTruthy();expect(second.requestId).not.toBe(first.requestId);expect(second.sales[0].totalAmount).toBe(30)
})
test('可改选销售规格并发送真实收款账户',async()=>{
 const post=await draft([{name:'货',quantity:2,unit:'件',unitPrice:10,totalAmount:20,paid:true,suggestedSkuId:9,customer:null,matchedProduct:{id:1,name:'货',unit:'件',skus:[{id:9,specText:'单件'},{id:10,specText:'整箱'}]}}])
 fireEvent.change(screen.getByText('整箱').closest('select')!,{target:{value:'10'}})
 fireEvent.change(screen.getByText('微信').closest('select')!,{target:{value:'微信'}})
 fireEvent.click(screen.getByText('确认入账勾选的项'));await waitFor(()=>expect(post).toHaveBeenCalledTimes(2))
 expect((post.mock.calls[1][1] as any).sales[0]).toMatchObject({skuId:10,settlementAccount:'微信'})
})
test('未建档挂账销售不得伪装成已收收入',async()=>{
 const post=await draft([{name:'货',quantity:2,unit:'件',unitPrice:10,totalAmount:20,paid:false,suggestedSkuId:null,customer:{id:7,name:'老王'},matchedProduct:null}])
 fireEvent.click(screen.getByText('确认入账勾选的项'));await act(async()=>{})
 expect(post).toHaveBeenCalledTimes(1)
})
test.each(['missingSku','missingCost','creditExpense'])('采购 %s 必须阻止错误入账',async(kind)=>{
 const post=await draft([],[{name:'货',quantity:2,unit:'件',unitCost:kind==='missingCost'?null:10,totalCost:kind==='missingCost'?null:20,suggestedSkuId:kind==='missingSku'?null:9,matchedProduct:kind==='creditExpense'?null:{id:1,name:'货',unit:'件',skus:[{id:9,specText:'单件'},{id:10,specText:'整箱'}]},suggestedType:null}])
 if(kind==='creditExpense')fireEvent.change(screen.getByText('挂账').closest('select')!,{target:{value:'挂账'}})
 fireEvent.click(screen.getByText('确认入账勾选的项'));await act(async()=>{})
 expect(post).toHaveBeenCalledTimes(1)
})
test('确认中的重复点击只发送一次，换号后迟到成功不显示已入账',async()=>{
 localStorage.setItem('sm_token','A')
 const post=await draft([{name:'货',quantity:2,unit:'件',unitPrice:10,totalAmount:20,paid:true,suggestedSkuId:9,customer:null,matchedProduct:{id:1,name:'货',unit:'件'}}])
 let resolve!:(v:any)=>void;post.mockImplementationOnce(()=>new Promise(r=>{resolve=r}))
 const button=screen.getByText('确认入账勾选的项')
 fireEvent.click(button);fireEvent.click(button);expect(post).toHaveBeenCalledTimes(2)
 localStorage.setItem('sm_token','B');await act(()=>resolve({orders:[{id:1}]}))
 expect(screen.queryByText('✓ 已入账')).toBeNull()
})
test('解析请求换号后的迟到响应不显示旧店草案',async()=>{
 localStorage.setItem('sm_token','A')
 vi.spyOn(api,'get').mockResolvedValue({list:[],pagination:{total:0}})
 let resolve!:(v:any)=>void;vi.spyOn(api,'post').mockImplementationOnce(()=>new Promise(r=>{resolve=r}))
 render(<QuickEntryPage/>);fireEvent.change(screen.getByPlaceholderText(/把要记的事/),{target:{value:'旧店秘密'}});fireEvent.click(screen.getByText('AI 解析'))
 localStorage.setItem('sm_token','B');await act(()=>resolve({sales:[],purchases:[],expenses:[],aggregates:[],warnings:['旧店秘密'],todayContext:null}))
 expect(screen.queryByText('确认入账勾选的项')).toBeNull();expect(screen.queryByText('旧店秘密')).toBeNull()
})
test('混合确认成功展示真实采购单与仅支出记录，下一笔明确生成新ID',async()=>{
 const post=await draft([],[{name:'临时材料',quantity:2,unit:'件',unitCost:5,totalCost:10,matchedProduct:null,suggestedType:null}])
 post.mockResolvedValueOnce({purchaseOrders:[{id:1,orderNo:'JH-已入账',actualAmount:100,paidAmount:40,unpaidAmount:60}],expenses:[{id:2,category:'进货',amount:10,note:'仅记支出·临时材料'}]})
 fireEvent.click(screen.getByText('确认入账勾选的项'));await screen.findByText('✓ 已入账')
 expect(screen.getByText(/JH-已入账/)).toBeTruthy();expect(screen.getByText(/仅记支出·临时材料/)).toBeTruthy()
 const first=(post.mock.calls[1][1] as any).requestId
 fireEvent.click(screen.getByText('再记一笔'));fireEvent.change(screen.getByPlaceholderText(/把要记的事/),{target:{value:'再进货两件'}});fireEvent.click(screen.getByText('AI 解析'));await screen.findByText('确认入账勾选的项')
 fireEvent.click(screen.getByText('确认入账勾选的项'));await waitFor(()=>expect(post).toHaveBeenCalledTimes(4))
 expect((post.mock.calls[3][1] as any).requestId).not.toBe(first)
})

test('无档案销售选择建档后必须明确真实售价，不能发送空金额',async()=>{
 const post=await draft([{name:'货',quantity:2,unit:'件',unitPrice:null,totalAmount:null,paid:true,suggestedSkuId:null,customer:null,matchedProduct:null}])
 fireEvent.click(screen.getByText(/顺便建档到/).closest('label')!.querySelector('input')!)
 fireEvent.click(screen.getByText('确认入账勾选的项'));await act(async()=>{})
 expect(post).toHaveBeenCalledTimes(1)
})

const restoredSale={name:'恢复货',quantity:2,unit:'件',unitPrice:10,totalAmount:20,paid:true,suggestedSkuId:9,customer:{id:7,name:'老王'},matchedProduct:{id:1,name:'恢复货',unit:'件'}}
test('切页后恢复修改金额、客户与账户，未知确认跨刷新仍同ID同payload',async()=>{
 const post=await draft([restoredSale]);fireEvent.change(screen.getByPlaceholderText('按标价'),{target:{value:'17'}})
 fireEvent.change(screen.getByText('微信').closest('select')!,{target:{value:'微信'}})
 cleanup();render(<QuickEntryPage/>);expect((await screen.findByPlaceholderText('按标价') as HTMLInputElement).value).toBe('17')
 fireEvent.click(screen.getByText('确认入账勾选的项'));await waitFor(()=>expect(post).toHaveBeenCalledTimes(2));const first=post.mock.calls[1][1]
 cleanup();render(<QuickEntryPage/>);fireEvent.click(await screen.findByText('确认入账勾选的项'));await waitFor(()=>expect(post).toHaveBeenCalledTimes(3));expect(post.mock.calls[2][1]).toEqual(first)
 expect(first).toMatchObject({sales:[{customerId:7,unitPrice:17,settlementAccount:'微信'}]})
})
test('换账号或店铺不能恢复旧草稿，旧挂载页面也不能随新token发送',async()=>{
 const post=await draft([restoredSale]);localStorage.setItem('sm_token','B');fireEvent.click(screen.getByText('确认入账勾选的项'));await act(async()=>{});expect(post).toHaveBeenCalledTimes(1)
 cleanup();auth.user.id=2;render(<QuickEntryPage/>);expect(screen.queryByPlaceholderText('按标价')).toBeNull()
 cleanup();auth.user.id=1;auth.profile.storeId=20;render(<QuickEntryPage/>);expect(screen.queryByPlaceholderText('按标价')).toBeNull()
})
test('确认持久化失败必须先阻止网络发送，恢复后重试同笔',async()=>{
 const post=await draft([restoredSale]);const write=vi.spyOn(Storage.prototype,'setItem').mockImplementation(()=>{throw new Error('配额满')})
 fireEvent.click(screen.getByText('确认入账勾选的项'));await act(async()=>{});expect(post).toHaveBeenCalledTimes(1)
 write.mockRestore();fireEvent.click(screen.getByText('确认入账勾选的项'));await waitFor(()=>expect(post).toHaveBeenCalledTimes(2))
})
test('成功后的保存失败仍恢复原确认ID，不恢复可重建账的编辑稿',async()=>{
 const post=await draft([restoredSale]);let resolve!:(v:any)=>void;post.mockImplementationOnce(()=>new Promise(r=>{resolve=r}))
 fireEvent.click(screen.getByText('确认入账勾选的项'));const first=post.mock.calls[1][1]
 const write=vi.spyOn(Storage.prototype,'setItem').mockImplementation(()=>{throw new Error('配额满')});await act(()=>resolve({orders:[]}));fireEvent.click(screen.getByText('再记一笔'));expect(screen.queryByText('AI 解析')?.closest('button')?.disabled).toBe(true)
 write.mockRestore();cleanup();render(<QuickEntryPage/>);fireEvent.click(await screen.findByText('确认入账勾选的项'));await waitFor(()=>expect(post).toHaveBeenCalledTimes(3));expect(post.mock.calls[2][1]).toEqual(first)
})

test('重新解析失败保留上一次人工修改的草稿，刷新后仍能找回',async()=>{
 const post=await draft([restoredSale]);fireEvent.change(screen.getByPlaceholderText('按标价'),{target:{value:'17'}})
 post.mockRejectedValueOnce(new Error('解析失败'));fireEvent.click(screen.getByText('AI 解析'));await act(async()=>{})
 expect((screen.getByPlaceholderText('按标价') as HTMLInputElement).value).toBe('17')
 cleanup();render(<QuickEntryPage/>);expect((screen.getByPlaceholderText('按标价') as HTMLInputElement).value).toBe('17')
})

test.each([409,503])('确认%s后跨刷新重试保持原ID，不能自动另建账',async(status)=>{
 const post=await draft([restoredSale]);post.mockRejectedValueOnce(Object.assign(new Error('结果未知'),{status}));fireEvent.click(screen.getByText('确认入账勾选的项'));await waitFor(()=>expect(post).toHaveBeenCalledTimes(2));const first=post.mock.calls[1][1]
 cleanup();render(<QuickEntryPage/>);fireEvent.click(await screen.findByText('确认入账勾选的项'));await waitFor(()=>expect(post).toHaveBeenCalledTimes(3));expect(post.mock.calls[2][1]).toEqual(first)
})
