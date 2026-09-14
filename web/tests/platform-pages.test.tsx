import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { App } from 'antd'
import PlatformApp from '../src/platform/PlatformApp'
import { OverviewPage, UsersPage, AiPage } from '../src/platform/MetricsPages'
import { platformApi } from '../src/platform/api'
import { setPlatformToken } from '../src/platform/session'
const summary={attempts:2,logicalRequests:1,success:0,failed:1,parseFailed:1,promptTokens:null,completionTokens:null,totalTokens:null,cacheHitTokens:null,cacheMissTokens:null,usageKnownAttempts:0,usageUnknownAttempts:2,estimatedCosts:[],costKnownAttempts:0,costUnknownAttempts:2}
const overview={range:{from:'2026-01-01',to:'2026-01-31'},registrations:{users:3,stores:2,admins:2,staff:1,disabledUsers:0,firstRegistrationSource:'unknown'},bindings:{appleUsers:2,phoneUsers:1,overlapUsers:1},entitlements:{currentProStores:2,verifiedProductionStores:1,verifiedSandboxStores:1,manualStores:0,promotionStores:1,unknownAppleStores:0,verifiedProductionTransactions:1,verifiedSandboxTransactions:1,revenue:null},ai:summary,notes:['历史用户token未知']}
afterEach(()=>vi.unstubAllGlobals())
beforeEach(()=>{const computed=window.getComputedStyle.bind(window);vi.spyOn(window,'getComputedStyle').mockImplementation(el=>computed(el));vi.stubGlobal('ResizeObserver',class{observe(){}unobserve(){}disconnect(){}})})
test('商家token不能自动登录平台；独立登录验证profile后展示平台',async()=>{
 localStorage.setItem('sm_token','merchant-only');const get=vi.spyOn(platformApi,'get').mockImplementation(url=>Promise.resolve(url.endsWith('/profile')?{admin:{id:1,username:'ops',displayName:'运营员'}}:overview) as any)
 const post=vi.spyOn(platformApi,'post').mockResolvedValue({token:'platform-only',admin:{id:1,username:'ops',displayName:'运营员'}});render(<PlatformApp/>)
 expect(screen.getByText('平台运营登录')).toBeTruthy();expect(get).not.toHaveBeenCalled()
 fireEvent.change(screen.getByLabelText('平台账号'),{target:{value:'ops'}});fireEvent.change(screen.getByLabelText('平台密码'),{target:{value:'pass'}});fireEvent.click(screen.getByRole('button',{name:/登录平台/}))
 await screen.findByText('运营员');expect(post).toHaveBeenCalledWith('/platform/auth/login',{username:'ops',password:'pass'});expect(get).toHaveBeenCalledWith('/platform/auth/profile')
 expect(localStorage.getItem('sm_token')).toBe('merchant-only');expect(localStorage.getItem('sm_platform_token')).toBe('platform-only')
 fireEvent.click(screen.getByRole('button',{name:/退出平台/}));await screen.findByText('平台运营登录');expect(localStorage.getItem('sm_token')).toBe('merchant-only')
})
test('迟到平台profile不得重新显示旧平台身份',async()=>{
 setPlatformToken('old-platform');let resolve!:(v:unknown)=>void;vi.spyOn(platformApi,'get').mockImplementation(()=>new Promise(r=>{resolve=r}));render(<PlatformApp/>)
 setPlatformToken(null);await act(()=>resolve({admin:{id:1,username:'old',displayName:'旧平台身份'}}));expect(screen.queryByText('旧平台身份')).toBeNull();expect(screen.getByText('平台运营登录')).toBeTruthy()
})
test('总览分别展示Pro与已验证Production，未知usage/实收不补0',async()=>{
 vi.spyOn(platformApi,'get').mockResolvedValue(overview);render(<App><OverviewPage/></App>)
 await screen.findByText('当前 Pro 店铺');expect(screen.getByText('已验证生产购买店铺')).toBeTruthy();expect(screen.getByText(/Apple.*实收.*未知/)).toBeTruthy()
 expect(screen.getAllByText('未知').length).toBeGreaterThan(0);expect(screen.getByText(/成功解析不等于落单/)).toBeTruthy();expect(screen.getByText('历史用户token未知')).toBeTruthy()
})
test('用户详情按店铺统计，不暴露虚构首次注册来源',async()=>{
 const user={id:8,storeId:4,username:'owner',realName:'老板',role:'admin',status:1,createdAt:'2026-01-01',store:{id:4,name:'测试店'},bindings:{apple:true,phone:false},registrationSource:'unknown'}
 const get=vi.spyOn(platformApi,'get').mockImplementation(url=>Promise.resolve(url==='/platform/users'?{list:[user],pagination:{total:1}}:{user,counts:{products:5,skus:6,orders:7,purchaseOrders:2,aiAttempts:3},ai:summary,entitlements:[],purchaseStage:{phase:'unknown',entry:'unknown',attribution:'store'}}) as any)
 render(<App><UsersPage/></App>);fireEvent.click(await screen.findByRole('button',{name:/查看详情/}));await screen.findByText('店铺销售单数');expect(get).toHaveBeenCalledWith('/platform/users/8',{})
 expect(screen.getByText(/首次注册来源.*未知/)).toBeTruthy()
})
test('AI明细按逻辑请求与尝试分开展示并支持用户筛选',async()=>{
 const get=vi.spyOn(platformApi,'get').mockResolvedValue({list:[{id:'a1',requestId:'logical-id',userId:8,storeId:4,endpoint:'parse-entry',model:'synthetic-model',attempt:2,status:'parse_failed',durationMs:50,promptTokens:null,completionTokens:null,totalTokens:null,estimatedCost:null,createdAt:'2026-01-01'}],pagination:{total:1},summary,range:{}})
 render(<App><AiPage/></App>);await screen.findByText('synthetic-model');expect(screen.getAllByText('解析失败').length).toBeGreaterThan(0)
 fireEvent.change(screen.getByLabelText('筛选用户ID'),{target:{value:'8'}});fireEvent.click(screen.getByRole('button',{name:/应用身份筛选/}));await waitFor(()=>expect(get).toHaveBeenLastCalledWith('/platform/ai-requests',expect.objectContaining({userId:'8'})))
})
test('有真实注册事件时展示来源，当前生产Pro和历史购买分开',async()=>{
 vi.spyOn(platformApi,'get').mockResolvedValue({...overview,registrationSources:{password:1,apple:2,sms:3,staff:4,unknown:5},entitlements:{...overview.entitlements,currentVerifiedProductionProStores:1}})
 render(<App><OverviewPage/></App>);await screen.findByText('短信验证注册');expect(screen.getByText('当前已验证生产 Pro 店铺')).toBeTruthy();expect(screen.getByText('已验证生产购买店铺')).toBeTruthy()
})
