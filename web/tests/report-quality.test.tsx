import { render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { expect, test, vi } from 'vitest'
import api from '../src/api/client'
import ReportsPage from '../src/pages/ReportsPage'
import DashboardPage from '../src/pages/DashboardPage'
import { fmtMoney } from '../src/lib/format'
vi.mock('../src/auth',()=>({useAuth:()=>({user:{role:'admin'},profile:{shopName:'测试店'}})}))
vi.mock('../src/components/EChart',()=>({default:({option}:any)=><pre data-testid="chart">{JSON.stringify(option)}</pre>}))
vi.mock('../src/components/SalesTrendChart',()=>({default:()=>null}))
vi.mock('../src/components/RestockCard',()=>({default:()=>null}))
vi.mock('../src/components/CountUp',()=>({default:({value,format}:any)=><span>{format?format(value):value}</span>}))
vi.mock('../src/components/StatCard',()=>({default:({title,value,note}:any)=><section aria-label={title}>{value}{note&&<p>{note}</p>}</section>}))
vi.mock('antd',()=>{
 const Text=({children}:any)=><span>{children}</span>
 return {Alert:({message,description}:any)=><div role="alert">{message}{description}</div>,DatePicker:{RangePicker:()=>null},Skeleton:()=>null,Typography:{Text,Title:Text,Paragraph:Text},Button:({children,onClick}:any)=><button onClick={onClick}>{children}</button>,Statistic:({title,value}:any)=><section aria-label={title}>{value}</section>,Table:({dataSource,columns}:any)=><table><tbody>{dataSource.map((r:any,i:number)=><tr key={i}>{columns.map((c:any,j:number)=><td key={j}>{c.render?c.render(r[c.dataIndex],r,i):r[c.dataIndex]}</td>)}</tr>)}</tbody></table>}
})
function reports(historyIncomplete=false,profitUnreliable=false,empty=false,profitPatch:object={}){
 vi.spyOn(api,'get').mockImplementation((url)=>Promise.resolve({
 '/reports/profit':{historyIncomplete,profitUnreliable,sales:1000,cogs:123,expenses:9,profit:867.43,lossAmount:0,orderCount:1,byDay:[{date:'2026-08-01',sales:1000,profit:867.43},{date:'2026-08-02',sales:200,profit:51}],...profitPatch},
 '/reports/sales-by-product':{historyIncomplete,totalAmount:1000,list:empty?[]:[{productName:'货品',specText:null,qty:1,amount:1000,profit:731.27,profitUnreliable}]},
 '/reports/staff-performance':{historyIncomplete,list:empty?[]:[{name:'员工甲',orders:1,sales:1000,profit:923.14,profitUnreliable}]},
 '/reports/purchase-stats':{historyIncomplete,total:500,orderCount:empty?0:1,byProduct:[],bySupplier:[]},
 '/reports/inventory':{totalStock:0,totalValue:0,skuCount:0,byType:[],lowStock:[]},
 '/reports/cashflow':{inflow:0,outflow:0,net:0,rows:[]},
 }[url]) as any)
 render(<MemoryRouter><ReportsPage/></MemoryRouter>)
}
test.each([false,true])('四张报表必须显示历史不完整，即使数据为空=%s',async(empty)=>{
 reports(true,false,empty)
 await screen.findAllByText(/历史记录不完整/)
 expect(screen.getAllByText(/历史记录不完整/)).toHaveLength(4)
 expect(screen.queryByText(fmtMoney(867.43))).toBeNull()
 expect(screen.queryByText(fmtMoney(731.27))).toBeNull()
 expect(screen.queryByText(fmtMoney(923.14))).toBeNull()
})
test('缺成本的利润摘要、商品毛利、员工毛利和图表不能呈现精确利润',async()=>{
 reports(false,true)
 await screen.findAllByText(/成本缺失/)
 expect(screen.getAllByText(/成本缺失/)).toHaveLength(3)
 expect(screen.getAllByText('暂无法准确计算')).toHaveLength(3)
 for(const n of [867.43,731.27,923.14])expect(screen.queryByText(fmtMoney(n))).toBeNull()
 for(const chart of screen.getAllByTestId('chart'))expect(JSON.parse(chart.textContent!).series.some((s:any)=>s.name==='利润')).toBe(false)
})
test('可信报表保持显示利润与利润趋势',async()=>{
 reports()
 await screen.findByText(fmtMoney(867.43))
 expect(screen.getByText(fmtMoney(731.27))).toBeTruthy();expect(screen.getByText(fmtMoney(923.14))).toBeTruthy()
 expect(screen.queryByRole('alert')).toBeNull()
 expect(screen.getAllByTestId('chart').some((chart)=>JSON.parse(chart.textContent!).series.some((s:any)=>s.name==='利润'))).toBe(true)
})
test('工作台历史不完整优先于缺成本提示，隐藏不可信毛利',async()=>{
 vi.spyOn(api,'get').mockImplementation((url)=>Promise.resolve(url==='/stats/overview'?{todaySales:1000,todayOrderCount:1,todayProfit:867.43,historyIncomplete:true,profitUnreliable:true,noCostSales:80,noCostProductNames:['旧商品'],lowStockCount:0,productCount:2}:[]) as any)
 render(<MemoryRouter><DashboardPage/></MemoryRouter>)
 const card=await screen.findByRole('region',{name:'今日经营利润'})
 expect(within(card).getByText(/历史记录不完整/)).toBeTruthy()
 expect(within(card).getByText('暂无法准确计算')).toBeTruthy()
 expect(within(card).queryByText(fmtMoney(867.43))).toBeNull()
 expect(within(card).queryByText(/其中.*没填进价/)).toBeNull()
})

test.each([undefined,null,NaN,'867.43'])('报表利润字段无效不能显示确定利润或趋势 %s',async(profit)=>{
 reports(false,false,false,{profit})
 await screen.findByText('暂无法准确计算')
 expect(screen.queryByText('¥NaN')).toBeNull()
 expect(screen.getAllByTestId('chart').some(chart=>JSON.parse(chart.textContent!).series.some((s:any)=>s.name==='利润'))).toBe(false)
})
test.each([undefined,null,0])('首页经营利润处理字段缺失和真实零 %s',async(todayProfit)=>{
 vi.spyOn(api,'get').mockImplementation(url=>Promise.resolve(url==='/stats/overview'?{todaySales:1000,todayOrderCount:1,todayProfit,historyIncomplete:false,profitUnreliable:false,productCount:2}:[]) as any)
 render(<MemoryRouter><DashboardPage/></MemoryRouter>)
 const card=await screen.findByRole('region',{name:'今日经营利润'})
 expect(within(card).getByText(todayProfit===0?fmtMoney(0):'暂无法准确计算')).toBeTruthy()
})
