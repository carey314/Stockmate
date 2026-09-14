import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, expect, test, vi } from 'vitest'
import api from '../src/api/client'
import { AuthProvider, useAuth } from '../src/auth'
import { clearEntitlementCache, useEntitlement } from '../src/hooks/useEntitlement'
const deferred = <T,>() => { let resolve!: (v:T)=>void; const promise = new Promise<T>(r=>resolve=r); return {promise,resolve} }
const person = (id:number) => ({ id, username: `u${id}`, realName:`店${id}`, role:'admin', shopName:`店${id}` })
beforeEach(()=>clearEntitlementCache())
test('切换账号后迟到的旧 profile 不得替换新身份', async()=>{
 localStorage.setItem('sm_token','A'); localStorage.setItem('sm_user',JSON.stringify(person(1)))
 const old=deferred<any>()
 vi.spyOn(api,'get').mockImplementation((_url)=> localStorage.getItem('sm_token')==='A' ? old.promise : Promise.resolve(person(2)) as any)
 vi.spyOn(api,'post').mockResolvedValue({token:'B',user:person(2)})
 const {result}=renderHook(()=>useAuth(),{wrapper:AuthProvider})
 await act(()=>result.current.login('B','pw'))
 await waitFor(()=>expect(result.current.profile?.id).toBe(2))
 await act(()=>old.resolve(person(1)))
 expect(result.current.user?.id).toBe(2)
 expect(JSON.parse(localStorage.getItem('sm_user')!).id).toBe(2)
})
test('权益缓存清空后旧请求不可回填，并且新身份立即发新请求', async()=>{
 localStorage.setItem('sm_token','A')
 const old=deferred<any>(); const fresh=deferred<any>()
 const get=vi.spyOn(api,'get').mockReturnValueOnce(old.promise).mockReturnValueOnce(fresh.promise)
 const {result,unmount}=renderHook(()=>useEntitlement())
 expect(get).toHaveBeenCalledTimes(1)
 act(()=>{localStorage.setItem('sm_token','B');clearEntitlementCache()})
 unmount()
 const second=renderHook(()=>useEntitlement())
 expect(get).toHaveBeenCalledTimes(2)
 await act(()=>fresh.resolve({plan:'B'}))
 await act(()=>old.resolve({plan:'A'}))
 expect(second.result.current.ent?.plan).toBe('B')
 void result
})
test('多标签换号应立即移除旧身份和旧 profile，不能等待新请求',async()=>{
 localStorage.setItem('sm_token','A');localStorage.setItem('sm_user',JSON.stringify(person(1)))
 vi.spyOn(api,'get').mockResolvedValueOnce(person(1)).mockReturnValue(new Promise(()=>{}))
 const {result}=renderHook(()=>useAuth(),{wrapper:AuthProvider})
 await waitFor(()=>expect(result.current.profile?.id).toBe(1))
 act(()=>{localStorage.setItem('sm_token','B');window.dispatchEvent(new StorageEvent('storage',{key:'sm_token',newValue:'B',oldValue:'A'}))})
 expect(result.current.user).toBeNull();expect(result.current.profile).toBeNull()
})
test('无token的遗留user缓存不得作为已登录身份',()=>{
 localStorage.setItem('sm_user',JSON.stringify(person(1)))
 const {result}=renderHook(()=>useAuth(),{wrapper:AuthProvider})
 expect(result.current.user).toBeNull()
})
test('logout后迟到的login不能重新登录',async()=>{
 const pending=deferred<any>();vi.spyOn(api,'post').mockReturnValue(pending.promise)
 vi.spyOn(api,'get').mockResolvedValue(person(1))
 const {result}=renderHook(()=>useAuth(),{wrapper:AuthProvider})
 let login!:Promise<void>
 act(()=>{login=result.current.login('A','pw')})
 act(()=>result.current.logout())
 await act(async()=>{pending.resolve({token:'A',user:person(1)});await login})
 expect(result.current.user).toBeNull();expect(localStorage.getItem('sm_token')).toBeNull()
})
test('身份校验断网必须提供可重试错误状态，不能永久等待',async()=>{
 localStorage.setItem('sm_token','A')
 vi.spyOn(api,'get').mockRejectedValue(new Error('身份验证断网'))
 const {result}=renderHook(()=>useAuth(),{wrapper:AuthProvider})
 await waitFor(()=>expect((result.current as any).profileError).toBe('身份验证断网'))
 expect(result.current.user).toBeNull()
})

test('App一次性码登录复用身份切换与权威profile，并且不持久化登录码',async()=>{
 const code='Ab12_'.repeat(6)+'CD';const old=deferred<any>();localStorage.setItem('sm_token','A')
 vi.spyOn(api,'get').mockImplementation(()=>localStorage.getItem('sm_token')==='A'?old.promise:Promise.resolve({...person(2),storeId:20}) as any)
 const post=vi.spyOn(api,'post').mockResolvedValue({token:'B',user:person(2)})
 const {result}=renderHook(()=>useAuth(),{wrapper:AuthProvider})
 await act(async()=>{expect(await (result.current as any).loginWithCode(code)).toBe(true)})
 expect(post).toHaveBeenCalledWith('/auth/web-bridge/redeem',{code});await waitFor(()=>expect(result.current.profile?.storeId).toBe(20))
 await act(()=>old.resolve(person(1)));expect(result.current.user?.id).toBe(2)
 expect(JSON.stringify({...localStorage})).not.toContain(code)
})
test('App登录码请求在logout或另一次密码登录后迟到不能覆盖身份',async()=>{
 const pending=deferred<any>();vi.spyOn(api,'post').mockReturnValueOnce(pending.promise).mockResolvedValue({token:'C',user:person(3)});vi.spyOn(api,'get').mockResolvedValue(person(3))
 const {result}=renderHook(()=>useAuth(),{wrapper:AuthProvider});let redeem!:Promise<boolean>
 act(()=>{redeem=(result.current as any).loginWithCode('a'.repeat(32))});act(()=>result.current.logout());await act(()=>result.current.login('C','pw'))
 await act(async()=>{pending.resolve({token:'B',user:person(2)});expect(await redeem).toBe(false)})
 expect(result.current.user?.id).toBe(3);expect(localStorage.getItem('sm_token')).toBe('C')
})

test.each(['loginWithQr', 'loginWithAppCode'] as const)('授权组件离开后%s不得写入迟到token',async method=>{
 const pending=deferred<any>();vi.spyOn(api,'post').mockReturnValue(pending.promise);vi.spyOn(api,'get').mockResolvedValue(person(1));
 const {result}=renderHook(()=>useAuth(),{wrapper:AuthProvider});let active=true, promise!:Promise<boolean>;
 act(()=>{promise=method==='loginWithQr'?result.current.loginWithQr({challengeId:'id',browserSecret:'B'.repeat(43)},()=>active):result.current.loginWithAppCode({code:'A'.repeat(32),browserSecret:'B'.repeat(43)},()=>active)});
 active=false;await act(async()=>{pending.resolve({token:'late',user:person(1)});expect(await promise).toBe(false)});
 expect(localStorage.getItem('sm_token')).toBeNull();expect(result.current.user).toBeNull();
})

test.each([null,{}, {id:1,role:'unknown'}])('profile响应不完整要返回可见错误，不静默留下未决身份 %j',async(profile)=>{
 localStorage.setItem('sm_token','A');vi.spyOn(api,'get').mockResolvedValue(profile)
 const {result}=renderHook(()=>useAuth(),{wrapper:AuthProvider})
 await waitFor(()=>expect(result.current.profileError).toBe('账号信息不完整，请重新验证身份'))
 expect(result.current.profile).toBeNull();expect(result.current.user).toBeNull()
})
