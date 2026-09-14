import { act, fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, expect, test, vi } from 'vitest'
import { App } from 'antd'
import api from '../src/api/client'
import TodoPage from '../src/pages/TodoPage'
import ProductsPage from '../src/pages/ProductsPage'
import { fmtMoney } from '../src/lib/format'
const {auth}=vi.hoisted(()=>({auth:{user:{id:1,role:'admin'},profile:{id:1,storeId:10,shopName:'合成店'}}}))
vi.mock('../src/auth',()=>({useAuth:()=>auth}))
vi.mock('../src/components/InventoryMoveModal',()=>({default:()=>null}))
vi.mock('../src/components/SkuRecordsDrawer',()=>({default:()=>null}))
vi.mock('../src/components/RecipeModal',()=>({default:()=>null}))
beforeEach(()=>{vi.stubGlobal('ResizeObserver',class{observe(){} unobserve(){} disconnect(){}});localStorage.setItem('sm_token','live-A');auth.user.role='admin';const original=window.getComputedStyle.bind(window);vi.spyOn(window,'getComputedStyle').mockImplementation(el=>original(el))})
const mount=(Page:typeof TodoPage)=>render(<MemoryRouter><App><Page/></App></MemoryRouter>)
function mockTodo(patch:object){vi.spyOn(api,'get').mockImplementation((url)=>Promise.resolve(url==='/stats/overview'?{todaySales:300,todayOrderCount:1,todayProfit:143.27,profitUnreliable:false,historyIncomplete:false,...patch}:url==='/inventory/alerts'?[]:{list:[],pagination:{total:0}}) as any)}
test.each([
 {todayProfit:143.27,historyIncomplete:true},
 {todayProfit:143.27,profitUnreliable:true},
 {todayProfit:undefined}, {todayProfit:null}, {todayProfit:'143.27'}, {todayProfit:NaN},
])('待办不把不可信利润呈现为确定数值 %j',async(patch)=>{
 mockTodo(patch);mount(TodoPage);await screen.findByText('今日经营利润')
 expect(screen.getByText('暂无法准确计算')).toBeTruthy();expect(screen.queryByText(fmtMoney(143.27))).toBeNull();expect(screen.queryByText('今日毛利')).toBeNull();expect(screen.queryByText('¥NaN')).toBeNull()
})
test.each([143.27,0,-15])('待办按已扣经营支出口径显示有限真实值 %s',async(todayProfit)=>{mockTodo({todayProfit,todayExpenses:56.73});mount(TodoPage);await screen.findByText('今日经营利润');expect(screen.getByText(fmtMoney(todayProfit))).toBeTruthy();expect(screen.getByText(/已扣除销货成本和经营支出/)).toBeTruthy()})
test('员工不出现利润或利润异常提示',async()=>{auth.user.role='staff';mockTodo({historyIncomplete:true});mount(TodoPage);await screen.findByText('今日小结');await act(async()=>{});expect(screen.queryByText(/经营利润/)).toBeNull();expect(screen.queryByText('暂无法准确计算')).toBeNull()})
const stock=[{id:1,quantity:2,minQuantity:5,sku:{id:1,specText:'小瓶',product:{id:1,name:'合成低库存饮料',unit:'瓶'}}}]
function mockProducts(alerts:()=>Promise<unknown>){return vi.spyOn(api,'get').mockImplementation(url=>(url==='/inventory/alerts'?alerts():Promise.resolve(url==='/product-types'?[]:{list:[],pagination:{total:0}})) as any)}
test('低库存首次失败显示错误和重试，不能显示没有低库存；重试空数组才是真空',async()=>{
 let failed=true;mockProducts(()=>failed?Promise.reject(new Error('模拟断网')):Promise.resolve([]));mount(ProductsPage)
 fireEvent.click(screen.getByText(/^低库存/));await screen.findByText(/低库存加载失败/);expect(screen.queryByText(/没有低于预警线/)).toBeNull()
 failed=false;fireEvent.click(screen.getByRole('button',{name:/重试预警/}));await screen.findByText(/没有低于预警线/);expect(screen.queryByText(/低库存加载失败/)).toBeNull()
})
test('低库存失败保留旧数据及上次成功时间，恢复后移除旧提醒',async()=>{
 let failed=false;mockProducts(()=>failed?Promise.reject(new Error('模拟断网')):Promise.resolve(stock));mount(ProductsPage)
 await screen.findByText('低库存 1');failed=true;fireEvent.click(screen.getByText('低库存 1'))
 await screen.findByText(/低库存加载失败/);expect(screen.getByText(/上次成功更新/)).toBeTruthy();expect(screen.getByText(/旧数据/)).toBeTruthy();expect(screen.getByText(/合成低库存饮料/)).toBeTruthy()
 failed=false;vi.mocked(api.get).mockImplementation(url=>Promise.resolve(url==='/inventory/alerts'||url==='/product-types'?[]:{list:[],pagination:{total:0}}) as any)
 fireEvent.click(screen.getByRole('button',{name:/重试预警/}));await screen.findByText(/没有低于预警线/);expect(screen.queryByText(/合成低库存饮料/)).toBeNull();expect(screen.queryByText(/旧数据/)).toBeNull()
})
test('预警加载期间不宣称没有低库存',async()=>{let resolve!:(v:unknown)=>void;const pending=new Promise(r=>{resolve=r});mockProducts(()=>pending);mount(ProductsPage);fireEvent.click(screen.getByText(/^低库存/));expect(screen.getByText(/正在加载低库存/)).toBeTruthy();expect(screen.queryByText(/没有低于预警线/)).toBeNull();await act(()=>resolve([]));await screen.findByText(/没有低于预警线/)})

test('预警乱序成功或失败不能覆盖较新的请求结果',async()=>{
 const resolvers:((v:unknown)=>void)[]=[]
 mockProducts(()=>new Promise(resolve=>resolvers.push(resolve)))
 mount(ProductsPage);fireEvent.click(screen.getByText(/^低库存/))
 await act(()=>resolvers[resolvers.length-1]([]));await screen.findByText(/没有低于预警线/)
 await act(()=>resolvers[0](stock));expect(screen.queryByText(/合成低库存饮料/)).toBeNull()
})
test('切换会话清除预警旧快照并拒绝旧在途响应',async()=>{
 const {notifySessionChange}=await import('../src/lib/session')
 let next:((v:unknown)=>void)|undefined
 mockProducts(()=>next===undefined?Promise.resolve(stock):new Promise(resolve=>{next=resolve}))
 mount(ProductsPage);await screen.findByText('低库存 1');fireEvent.click(screen.getByText('低库存 1'));await screen.findByText(/合成低库存饮料/)
 next=()=>{};fireEvent.click(screen.getByRole('button',{name:'刷新库存'}))
 await act(()=>{localStorage.setItem('sm_token','live-B');notifySessionChange()})
 await act(()=>next!(stock));expect(screen.queryByText(/合成低库存饮料/)).toBeNull();expect(screen.queryByText(/上次成功更新/)).toBeNull()
})
test('预警响应格式异常显示错误，不作空列表',async()=>{mockProducts(()=>Promise.resolve({list:[]}));mount(ProductsPage);fireEvent.click(screen.getByText(/^低库存/));await screen.findByText(/预警数据格式异常/);expect(screen.queryByText(/没有低于预警线/)).toBeNull()})
test('可见页面聚焦重新请求预警，隐藏时不刷新',async()=>{
 const get=mockProducts(()=>Promise.resolve(stock));mount(ProductsPage);await screen.findByText('低库存 1');const calls=()=>get.mock.calls.filter(([url])=>url==='/inventory/alerts').length
 const before=calls();vi.spyOn(document,'visibilityState','get').mockReturnValue('hidden');await act(()=>window.dispatchEvent(new Event('focus')));expect(calls()).toBe(before)
 vi.spyOn(document,'visibilityState','get').mockReturnValue('visible');await act(()=>window.dispatchEvent(new Event('focus')));expect(calls()).toBe(before+1)
})
