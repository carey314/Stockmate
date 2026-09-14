import { cleanup, act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, expect, test, vi } from 'vitest'
import dayjs from 'dayjs'
import api from '../src/api/client'
import StatementsPage from '../src/pages/StatementsPage'
import TypesPage from '../src/pages/TypesPage'
import PurchasePage from '../src/pages/PurchasePage'
import TodoPage from '../src/pages/TodoPage'
import PartnersPage from '../src/pages/PartnersPage'
import StocktakePage from '../src/pages/StocktakePage'
import { MemoryRouter } from 'react-router-dom'
beforeEach(()=>localStorage.setItem('sm_token','A'))
const { message } = vi.hoisted(()=>({message:{warning:vi.fn(),error:vi.fn(),success:vi.fn()}}))
vi.mock('../src/auth',()=>({useAuth:()=>({user:{id:1,role:'admin'},profile:{id:1,storeId:10,shopName:'测试店'},refreshProfile:vi.fn()})}))
vi.mock('../src/components/AiQuota',()=>({AiQuotaTag:()=>null,handleAiQuotaError:()=>false}))
// Keep page effects / handlers real. Replace only the design-system widgets with native controls.
vi.mock('antd',()=>{
 const Box=({children}:any)=><div>{children}</div>
 const Button=({children,onClick,disabled}:any)=><button onClick={onClick} disabled={disabled}>{children}</button>
 const Input=({value,onChange,placeholder}:any)=><input value={value} onChange={onChange} placeholder={placeholder}/>
 Input.TextArea=Input; Input.Search=Input
 const Form=Object.assign(Box,{useForm:()=>[{setFieldsValue(){},resetFields(){},validateFields:async()=>({})}],Item:Box})
 return {Form,Drawer:()=>null,Table:({dataSource}:any)=><div data-testid="rows">{dataSource.map((r:any)=><span key={r.id??r.skuId}>{r.name??r.productName}</span>)}</div>,InputNumber:({value,onChange,placeholder,disabled}:any)=><input type="number" aria-label="paid" value={value??''} disabled={disabled} placeholder={placeholder} onChange={e=>onChange(e.target.value===''?null:Number(e.target.value))}/>,App:{useApp:()=>({message,modal:{}})},Button,Input,Typography:{Text:Box,Paragraph:Box},Empty:()=>null,Skeleton:()=> <div>加载中</div>,Tag:Box,
 Alert:({message}:any)=><div role="alert">{message}</div>,Checkbox:()=>null,Popconfirm:()=>null,
 Modal:({open,children,onOk}:any)=>open?<div>{children}<button onClick={onOk}>确认保存</button></div>:null,
 Select:({options,value,onChange}:any)=><select aria-label="select" value={value??''} onChange={e=>onChange(options.find((o:any)=>String(o.value)===e.target.value)?.value)}><option value=""/>{options.map((o:any)=><option key={o.value} value={o.value}>{o.label}</option>)}</select>,
 DatePicker:{RangePicker:({onChange}:any)=><button onClick={()=>onChange([dayjs('2026-08-01'),dayjs('2026-08-31')])}>换账期</button>}}
})
const deferred=()=>{let resolve!:(v:any)=>void;let reject!:(e:Error)=>void;return {promise:new Promise<any>((a,b)=>{resolve=a;reject=b}),resolve:(v:any)=>resolve(v),reject:(e:Error)=>reject(e)}}
const statement=(id:number,name:string)=>({customer:{id,name,phone:null},opening:0,periodDebit:100,periodCredit:0,closing:100,rows:[]})
test('查询新账期失败后不可打印旧金额；加载时也不可打印',async()=>{
 const next=deferred()
 vi.spyOn(api,'get').mockImplementation((url)=>url==='/customers'?Promise.resolve({list:[{id:1,name:'甲'}],pagination:{total:1}}): url.includes('statement')?(next.promise):Promise.resolve({}) as any)
 const first=vi.mocked(api.get).mockImplementationOnce(()=>Promise.resolve({list:[{id:1,name:'甲'}],pagination:{total:1}}) as any).mockImplementationOnce(()=>Promise.resolve(statement(1,'甲')) as any)
 render(<StatementsPage/>);await screen.findByText('甲')
 fireEvent.change(screen.getByRole('combobox'),{target:{value:'1'}})
 const print=screen.getByText('打印 / 存 PDF') as HTMLButtonElement
 await waitFor(()=>expect(print.disabled).toBe(false))
 fireEvent.click(screen.getByText('换账期'))
 expect(print.disabled).toBe(true)
 await act(()=>next.reject(new Error('断网')))
 expect(screen.getByRole('alert').textContent).toContain('断网')
 expect(print.disabled).toBe(true)
 expect(document.querySelector('.print-area')).toBeNull()
 void first
})
test('对账下拉框取全 203 个客户并找到最后一页',async()=>{
 vi.spyOn(api,'get').mockImplementation((_url,params:any)=>{const page=params?.page??1;const list=page===1?Array.from({length:200},(_,i)=>({id:i+1,name:`客户${i+1}`})):[{id:201,name:'最早欠款客户'},{id:202,name:'202'},{id:203,name:'203'}];return Promise.resolve({list,pagination:{total:203,page,pageSize:200,totalPages:2}}) as any})
 render(<StatementsPage/>);await screen.findByText('最早欠款客户')
 expect(screen.getAllByRole('option')).toHaveLength(204)
})
test('品类仅改名必须一次保存并保留 App 字段属性与稳定 id',async()=>{
 const field={id:77,key:'brand',label:'品牌',type:'text',scope:'product',options:null,unit:'原单位',required:1,showInList:1,isCore:1,affectsStock:0,sortOrder:12}
 vi.spyOn(api,'get').mockResolvedValue([{id:1,name:'药品',description:null,isPreset:0,fields:[field],productCount:0}])
 const put=vi.spyOn(api,'put').mockResolvedValue({});const del=vi.spyOn(api,'delete').mockResolvedValue({});const post=vi.spyOn(api,'post').mockResolvedValue({})
 render(<TypesPage/>);fireEvent.click(await screen.findByText('编辑'))
 fireEvent.change(screen.getByPlaceholderText('品类名，如：奶茶 / 五金 / 母婴'),{target:{value:'新药品'}})
 fireEvent.click(screen.getByText('确认保存'))
 await waitFor(()=>expect(put).toHaveBeenCalled())
 expect(put.mock.calls[0][1]).toMatchObject({name:'新药品',fields:[{id:77,unit:'原单位',showInList:true,isCore:true,affectsStock:false,sortOrder:12}]})
 expect(del).not.toHaveBeenCalled();expect(post).not.toHaveBeenCalled()
})

for (const withSupplier of [true,false]) test(`挂账必须零付款；欠款必须有供应商（选择=${withSupplier}）`,async()=>{
 vi.spyOn(api,'get').mockImplementation((url)=>Promise.resolve({list:url==='/suppliers'?[{id:1,name:'供应商甲'}]:url==='/products'?[{id:1,name:'商品甲',skus:[{id:9,specText:'',costPrice:100}]}]:[],pagination:{total:url==='/purchase-orders'?0:1}}) as any)
 const post=vi.spyOn(api,'post').mockResolvedValue({})
 render(<MemoryRouter><PurchasePage/></MemoryRouter>)
 fireEvent.click(await screen.findByText('新建进货单'))
 await screen.findByText('商品甲')
 const selects=screen.getAllByRole('combobox')
 if(withSupplier) fireEvent.change(selects[0],{target:{value:'1'}})
 fireEvent.change(selects[1],{target:{value:'9'}})
 fireEvent.change(selects[2],{target:{value:'挂账'}})
 fireEvent.click(screen.getByText('确认保存'))
 if(withSupplier) { await waitFor(()=>expect(post).toHaveBeenCalled());expect(post.mock.calls[0][1]).toMatchObject({paidAmount:0,settlementAccount:'挂账',supplierId:1}) }
 else { await act(async()=>{});expect(post).not.toHaveBeenCalled();expect(message.warning).toHaveBeenCalledWith(expect.stringContaining('供应商')) }
})

test('乱序对账响应只能显示最后选择对象的成功快照',async()=>{
 const old=deferred();const fresh=deferred()
 vi.spyOn(api,'get').mockImplementation((url,params:any)=>url==='/customers'?Promise.resolve({list:[{id:1,name:'甲'},{id:2,name:'乙'}],pagination:{total:2}}):params.customerId===1?old.promise:fresh.promise)
 render(<StatementsPage/>);await screen.findByText('甲')
 fireEvent.change(screen.getByRole('combobox'),{target:{value:'1'}})
 fireEvent.change(screen.getByRole('combobox'),{target:{value:'2'}})
 await act(()=>fresh.resolve(statement(2,'乙成功')))
 await act(()=>old.resolve(statement(1,'甲迟到')))
 expect(screen.queryByText('甲迟到')).toBeNull();expect(screen.getByText('乙成功')).toBeTruthy()
 expect((screen.getByText('打印 / 存 PDF') as HTMLButtonElement).disabled).toBe(false)
})
test.each([TodoPage,PartnersPage])('往来与待办读取失败必须显示错误，不能声称没有欠款',async(Page)=>{
 vi.spyOn(api,'get').mockImplementation((url)=>url==='/product-types'?Promise.resolve([]):Promise.reject(new Error('账目读取失败')))
 render(<MemoryRouter><Page/></MemoryRouter>)
 await waitFor(()=>expect(screen.getByRole('alert').textContent).toContain('账目读取失败'))
 expect(screen.queryByText(/没有.*欠款/)).toBeNull()
})
test('待办包含第203个客户的欠款',async()=>{
 vi.spyOn(api,'get').mockImplementation((url,params:any)=>url==='/stats/overview'?Promise.resolve({todaySales:0,todayOrderCount:0,todayProfit:0}):url==='/inventory/alerts'?Promise.resolve([]):url==='/suppliers'?Promise.resolve({list:[],pagination:{total:0}}):Promise.resolve({list:params.page===1?Array.from({length:200},(_,i)=>({id:i+1,name:`客户${i}`,owed:0})):[{id:201,name:'201',owed:0},{id:202,name:'202',owed:0},{id:203,name:'最早欠款客户',owed:500}],pagination:{total:203}}) as any)
 render(<MemoryRouter><TodoPage/></MemoryRouter>);await screen.findByText(/最早欠款客户/)
 expect(screen.getAllByText(/500/).length).toBeGreaterThan(0)
})
test('盘点范围必须加载第501个商品',async()=>{
 vi.spyOn(api,'get').mockImplementation((url,params:any)=>url==='/product-types'?Promise.resolve([]):url==='/stocktakes'?Promise.resolve({list:[],pagination:{total:0}}):Promise.resolve({list:Array.from({length:Math.min(params.pageSize,501-(params.page-1)*params.pageSize)},(_,i)=>{const id=(params.page-1)*params.pageSize+i+1;return {id,name:`商品${id}`,unit:'件',skus:[{id,specText:'',inventory:{quantity:1}}]}}),pagination:{total:501}}) as any)
 render(<StocktakePage/>);fireEvent.click(await screen.findByText('新建盘点'))
 await screen.findByText('商品501')
})
test.each([
 {paid:150,supplier:true,allowed:false},
 {paid:40,supplier:false,allowed:false},
 {paid:40,supplier:true,allowed:true},
 {paid:null,supplier:false,allowed:true},
])('进货付款边界 $paid / supplier=$supplier',async({paid,supplier,allowed})=>{
 vi.spyOn(api,'get').mockImplementation((url)=>Promise.resolve({list:url==='/suppliers'?[{id:1,name:'供应商甲'}]:url==='/products'?[{id:1,name:'商品甲',skus:[{id:9,specText:'',costPrice:100}]}]:[],pagination:{total:url==='/purchase-orders'?0:1}}) as any)
 const post=vi.spyOn(api,'post').mockResolvedValue({})
 render(<MemoryRouter><PurchasePage/></MemoryRouter>)
 fireEvent.click(await screen.findByText('新建进货单'));await screen.findByText('商品甲')
 const selects=screen.getAllByRole('combobox')
 if(supplier)fireEvent.change(selects[0],{target:{value:'1'}})
 fireEvent.change(selects[1],{target:{value:'9'}})
 if(paid!==null)fireEvent.change(screen.getByLabelText('paid'),{target:{value:String(paid)}})
 fireEvent.click(screen.getByText('确认保存'));await act(async()=>{})
 if(allowed)expect(post.mock.calls[0][1]).toMatchObject({paidAmount:paid??100,settlementAccount:'现金'})
 else expect(post).not.toHaveBeenCalled()
})
test('现付总额按分汇总，不能把浮点误差发送为付款额',async()=>{
 vi.spyOn(api,'get').mockImplementation((url)=>Promise.resolve({list:url==='/products'?[{id:1,name:'一角',skus:[{id:1,specText:'',costPrice:0.1}]},{id:2,name:'两角',skus:[{id:2,specText:'',costPrice:0.2}]}]:[],pagination:{total:url==='/products'?2:0}}) as any)
 const post=vi.spyOn(api,'post').mockResolvedValue({})
 render(<MemoryRouter><PurchasePage/></MemoryRouter>);fireEvent.click(await screen.findByText('新建进货单'));await screen.findByText('一角')
 const products=screen.getAllByRole('combobox')[1]
 fireEvent.change(products,{target:{value:'1'}});fireEvent.change(products,{target:{value:'2'}})
 fireEvent.click(screen.getByText('确认保存'));await act(async()=>{})
 expect(post.mock.calls[0][1]).toMatchObject({paidAmount:0.3})
})

async function purchaseDraft() {
 vi.spyOn(api,'get').mockImplementation((url)=>Promise.resolve({list:url==='/suppliers'?[{id:1,name:'供应商甲'}]:url==='/products'?[{id:1,name:'商品甲',skus:[{id:9,specText:'',costPrice:100}]}]:[],pagination:{total:url==='/purchase-orders'?0:1}}) as any)
 const post=vi.spyOn(api,'post').mockRejectedValue(new Error('网络未知'))
 render(<MemoryRouter><PurchasePage/></MemoryRouter>);fireEvent.click(await screen.findByText('新建进货单'));await screen.findByText('商品甲')
 const selects=screen.getAllByRole('combobox');fireEvent.change(selects[0],{target:{value:'1'}});fireEvent.change(selects[1],{target:{value:'9'}});fireEvent.change(selects[2],{target:{value:'微信'}})
 fireEvent.change(screen.getByLabelText('paid'),{target:{value:'40'}});fireEvent.change(screen.getByPlaceholderText('备注（选填）'),{target:{value:'请送后门'}})
 return post
}
test('采购切页恢复SKU供应商实付账户备注，分页加载失败保留原稿',async()=>{
 const post=await purchaseDraft();cleanup();vi.mocked(api.get).mockRejectedValue(new Error('分页失败'))
 render(<MemoryRouter><PurchasePage/></MemoryRouter>);await screen.findByText('分页失败')
 expect((screen.getByPlaceholderText('备注（选填）') as HTMLInputElement).value).toBe('请送后门');expect((screen.getByLabelText('paid') as HTMLInputElement).value).toBe('40');expect(screen.getByText('商品甲')).toBeTruthy()
 fireEvent.click(screen.getByText('确认保存'));await act(async()=>{});expect(post).not.toHaveBeenCalled()
 cleanup();vi.mocked(api.get).mockImplementation((url)=>Promise.resolve({list:url==='/suppliers'?[{id:1,name:'供应商甲'}]:url==='/products'?[{id:1,name:'商品甲',skus:[{id:9,specText:'',costPrice:999}]}]:[],pagination:{total:url==='/purchase-orders'?0:1}}) as any)
 render(<MemoryRouter><PurchasePage/></MemoryRouter>);await screen.findByText('供应商甲');fireEvent.click(screen.getByText('确认保存'));await waitFor(()=>expect(post).toHaveBeenCalledTimes(1));expect(post.mock.calls[0][1]).toMatchObject({supplierId:1,paidAmount:40,settlementAccount:'微信',notes:'请送后门',items:[{skuId:9,unitPrice:100,quantity:1}]})
})
test('采购未知确认切页重试必须同ID同payload',async()=>{
 const post=await purchaseDraft();fireEvent.click(screen.getByText('确认保存'));await waitFor(()=>expect(post).toHaveBeenCalledTimes(1));const first=post.mock.calls[0][1] as any;expect(first.requestId).toBeTruthy()
 cleanup();render(<MemoryRouter><PurchasePage/></MemoryRouter>);await screen.findByText('确认保存');fireEvent.change(screen.getByLabelText('paid'),{target:{value:'99'}});fireEvent.click(screen.getByText('确认保存'));await waitFor(()=>expect(post).toHaveBeenCalledTimes(2));expect(post.mock.calls[1][1]).toEqual(first)
})
test('采购持久化失败不发送，旧页面换号后不能发送',async()=>{
 const post=await purchaseDraft();const write=vi.spyOn(Storage.prototype,'setItem').mockImplementation(()=>{throw new Error('存储不可用')});fireEvent.click(screen.getByText('确认保存'));await act(async()=>{});expect(post).not.toHaveBeenCalled()
 write.mockRestore();localStorage.setItem('sm_token','B');fireEvent.click(screen.getByText('确认保存'));await act(async()=>{});expect(post).not.toHaveBeenCalled()
})

test('采购成功但清理失败不能再次建账，刷新仍用原ID回放',async()=>{
 const post=await purchaseDraft();let resolve!:(v:any)=>void;post.mockImplementationOnce(()=>new Promise(r=>{resolve=r}))
 fireEvent.click(screen.getByText('确认保存'));const first=post.mock.calls[0][1]
 const write=vi.spyOn(Storage.prototype,'setItem').mockImplementation(()=>{throw new Error('存储满')});await act(()=>resolve({id:77}));fireEvent.click(screen.getByText('确认保存'));await act(async()=>{});expect(post).toHaveBeenCalledTimes(1)
 write.mockRestore();cleanup();render(<MemoryRouter><PurchasePage/></MemoryRouter>);fireEvent.click(await screen.findByText('确认保存'));await waitFor(()=>expect(post).toHaveBeenCalledTimes(2));expect(post.mock.calls[1][1]).toEqual(first)
})
test.each([400,404])('采购确定%s失败可修订并新ID，成功后不恢复旧草稿',async(status)=>{
 const post=await purchaseDraft();post.mockRejectedValueOnce(Object.assign(new Error('未入账'),{status}));fireEvent.click(screen.getByText('确认保存'));await waitFor(()=>expect(post).toHaveBeenCalledTimes(1));const first=post.mock.calls[0][1] as any
 fireEvent.change(screen.getByLabelText('paid'),{target:{value:'80'}});post.mockResolvedValueOnce({id:1});fireEvent.click(screen.getByText('确认保存'));await waitFor(()=>expect(post).toHaveBeenCalledTimes(2));const second=post.mock.calls[1][1] as any;expect(second.requestId).not.toBe(first.requestId);expect(second.paidAmount).toBe(80)
 cleanup();render(<MemoryRouter><PurchasePage/></MemoryRouter>);await act(async()=>{});expect(screen.queryByText('确认保存')).toBeNull()
})
