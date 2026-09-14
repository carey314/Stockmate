import { beforeEach, expect, test, vi } from 'vitest'
import { platformApi } from '../src/platform/api'
import { isPlatformSession, platformSnapshot, platformStorageChanged, setPlatformToken } from '../src/platform/session'
beforeEach(()=>{localStorage.setItem('sm_token','merchant-secret');setPlatformToken('platform-secret')})
const reply=(body:unknown,status=200)=>({ok:status<400,status,json:async()=>({code:status,data:body,message:'response'})}) as Response
test('独立fetch只带platform token，不发送商家cookie或token',async()=>{
 const fetcher=vi.spyOn(globalThis,'fetch').mockResolvedValue(reply({id:1}))
 expect(await platformApi.get('/platform/auth/profile')).toEqual({id:1})
 expect(fetcher.mock.calls[0][1]).toMatchObject({credentials:'omit',headers:expect.objectContaining({Authorization:'Bearer platform-secret'})})
 expect(JSON.stringify(fetcher.mock.calls)).not.toContain('merchant-secret')
})
test('platform 401只清平台登录，保留商家身份',async()=>{
 vi.spyOn(globalThis,'fetch').mockResolvedValue(reply(null,401))
 await expect(platformApi.get('/platform/auth/profile')).rejects.toMatchObject({status:401})
 expect(platformSnapshot().token).toBeNull();expect(localStorage.getItem('sm_token')).toBe('merchant-secret')
})
test('平台换号后旧401不得清新身份，旧成功不得回显',async()=>{
 let resolve!:(response:Response)=>void
 vi.spyOn(globalThis,'fetch').mockImplementation(()=>new Promise(r=>{resolve=r}))
 const first=platformApi.get('/platform/users');setPlatformToken('new-platform');resolve(reply(null,401))
 await expect(first).rejects.toMatchObject({staleSession:true});expect(platformSnapshot().token).toBe('new-platform')
 const second=platformApi.get('/platform/users');setPlatformToken('third-platform');resolve(reply({secret:'old'}))
 await expect(second).rejects.toMatchObject({staleSession:true})
})
test('缺平台后端明确提示尚未升级，登录不发送现有平台令牌',async()=>{
 const fetcher=vi.spyOn(globalThis,'fetch').mockResolvedValue(reply(null,404))
 await expect(platformApi.post('/platform/auth/login',{username:'ops',password:'secret'})).rejects.toThrow(/尚未升级/)
 expect(fetcher.mock.calls[0][1]?.headers).not.toHaveProperty('Authorization')
})
test('跨标签会话切换事件使旧响应失效，即使token已切回',()=>{
 const original=platformSnapshot();platformStorageChanged(new StorageEvent('storage',{key:'sm_platform_token',oldValue:'platform-secret',newValue:'other-platform'}));expect(isPlatformSession(original)).toBe(false)
})
