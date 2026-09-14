import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, expect, test, vi } from 'vitest'
import { App } from 'antd'
import api from '../src/api/client'
import ExperienceCodePage from '../src/pages/ExperienceCodePage'
import { refreshEntitlement } from '../src/hooks/useEntitlement'
const {auth}=vi.hoisted(()=>({auth:{user:{id:1,role:'admin'},profile:{id:1,storeId:10} as {id:number;storeId?:number}|null,profileError:null as string|null,refreshProfile:vi.fn(),logout:vi.fn()}}))
vi.mock('../src/auth',()=>({useAuth:()=>auth}))
vi.mock('../src/hooks/useEntitlement',()=>({refreshEntitlement:vi.fn().mockResolvedValue(undefined)}))
beforeEach(()=>{auth.user.role='admin';auth.profile={id:1,storeId:10};auth.profileError=null;auth.refreshProfile.mockReset();auth.logout.mockReset();localStorage.setItem('sm_token','merchant-A')})
const mount=()=>render(<App><ExperienceCodePage/></App>)
test('店主主动兑换，成功刷新权益并说明Apple订阅独立与赠送可收回',async()=>{
 const post=vi.spyOn(api,'post').mockResolvedValue({replayed:false,grant:{id:1,state:'active',storeId:10,expiresAt:null}});mount()
 fireEvent.change(screen.getByLabelText('体验码'),{target:{value:'EXAMPLE-SECRET-CODE'}});fireEvent.click(screen.getByRole('button',{name:/确认兑换/}))
 await screen.findByText(/兑换成功/);expect(post).toHaveBeenCalledWith('/me/experience-code',{code:'EXAMPLE-SECRET-CODE'})
 expect(refreshEntitlement).toHaveBeenCalled();expect(screen.getByText(/可由平台收回/)).toBeTruthy();expect(screen.getByText(/Apple.*自动续费/)).toBeTruthy()
 expect(JSON.stringify(localStorage)).not.toContain('EXAMPLE-SECRET-CODE')
})
test('员工仅提示店主兑换；旧身份未决请求不能显示成功',async()=>{
 auth.user.role='staff';const post=vi.spyOn(api,'post');const view=mount();expect(screen.getByText(/请店主/)).toBeTruthy();expect(screen.queryByLabelText('体验码')).toBeNull()
 view.unmount();auth.user.role='admin';let resolve!:(value:unknown)=>void;post.mockImplementation(()=>new Promise(r=>{resolve=r}));mount()
 fireEvent.change(screen.getByLabelText('体验码'),{target:{value:'EXAMPLE-SECRET-CODE'}});fireEvent.click(screen.getByRole('button',{name:/确认兑换/}));localStorage.setItem('sm_token','merchant-B')
 await act(()=>resolve({grant:{id:2},replayed:false}));expect(screen.queryByText(/兑换成功/)).toBeNull()
})
test('未知错误冻结原码，可重试，双击不重复发送',async()=>{
 const post=vi.spyOn(api,'post').mockRejectedValue(new Error('网络断开'));mount()
 fireEvent.change(screen.getByLabelText('体验码'),{target:{value:'EXAMPLE-SECRET-CODE'}});const submit=screen.getByRole('button',{name:/确认兑换/});fireEvent.click(submit);fireEvent.click(submit)
 await screen.findByText(/网络断开/);expect(post).toHaveBeenCalledTimes(1);expect((screen.getByLabelText('体验码') as HTMLInputElement).disabled).toBe(true)
 fireEvent.click(screen.getByRole('button',{name:/重试兑换/}));await waitFor(()=>expect(post).toHaveBeenCalledTimes(2));expect(post.mock.calls[1][1]).toEqual(post.mock.calls[0][1])
})
test('兑换前明确显示当前店铺，成功不提前声称权益刷新完成',async()=>{
 vi.mocked(refreshEntitlement).mockImplementationOnce(()=>new Promise(()=>{}))
 vi.spyOn(api,'post').mockResolvedValue({grant:{id:1,storeId:10,state:'active'},replayed:false});mount()
 expect(screen.getByText(/当前店铺.*#10/)).toBeTruthy()
 fireEvent.change(screen.getByLabelText('体验码'),{target:{value:'EXAMPLE-CODE'}});fireEvent.click(screen.getByRole('button',{name:/确认兑换/}));await screen.findByText(/兑换成功/)
 expect(screen.queryByText(/权益已刷新/)).toBeNull()
})

test.each([undefined,0,-1,NaN,'10'])('已返回profile但缺可信整数店铺ID时结束等待并明确服务不兼容 %s',async(storeId)=>{
 auth.profile={id:1,storeId:storeId as number};const post=vi.spyOn(api,'post');mount()
 expect(screen.queryByText('正在确认当前店铺身份…')).toBeNull()
 expect(screen.getByText('当前服务暂不支持体验码兑换')).toBeTruthy()
 expect(screen.getByRole('button',{name:'重新验证身份'})).toBeTruthy()
 expect(screen.queryByLabelText('体验码')).toBeNull();expect(post).not.toHaveBeenCalled()
})
test('profile请求失败不能继续显示加载；重试成功可进入同店兑换',async()=>{
 auth.profile=null;auth.profileError='网络断开';const view=mount()
 expect(screen.getByText('店铺身份验证失败')).toBeTruthy();expect(screen.queryByText('正在确认当前店铺身份…')).toBeNull()
 let finish!:()=>void;auth.refreshProfile.mockImplementation(()=>new Promise<void>(resolve=>{finish=resolve}))
 const retry=screen.getByRole('button',{name:'重新验证身份'});fireEvent.click(retry);fireEvent.click(retry);expect(auth.refreshProfile).toHaveBeenCalledTimes(1)
 auth.profile={id:1,storeId:10};auth.profileError=null;await act(()=>finish());view.rerender(<App><ExperienceCodePage/></App>)
 expect(screen.getByLabelText('体验码')).toBeTruthy()
})
test('旧profile与当前用户不一致不能兑换，可主动退出重登',()=>{
 auth.profile={id:2,storeId:99};const post=vi.spyOn(api,'post');mount()
 expect(screen.getByText('店铺身份不一致，请重新验证')).toBeTruthy();expect(screen.queryByLabelText('体验码')).toBeNull()
 fireEvent.click(screen.getByRole('button',{name:'退出并重新登录'}));expect(auth.logout).toHaveBeenCalledTimes(1);expect(post).not.toHaveBeenCalled()
})
test('重试失败说明原因，不恢复旧profile兑换表单',async()=>{
 auth.profile=null;auth.profileError='首次失败';auth.refreshProfile.mockRejectedValue(new Error('重新验证仍失败'));mount()
 fireEvent.click(screen.getByRole('button',{name:'重新验证身份'}));await screen.findByText('重新验证仍失败');expect(screen.queryByLabelText('体验码')).toBeNull()
})
