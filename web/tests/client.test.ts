import { expect, test, vi } from 'vitest'
import axios from 'axios'
const harness = vi.hoisted(()=>({adapter:null as any}))
vi.mock('axios',async()=>{
 const actual=await vi.importActual<typeof import('axios')>('axios')
 return {...actual,default:{...actual.default,create:(config:any)=>actual.default.create({...config,adapter:(c:any)=>harness.adapter(c)})}}
})
import api from '../src/api/client'
import { clearSession, notifySessionChange } from '../src/lib/session'

test.each([200,401])('A 的迟到 HTTP %s 不可清掉 B 或返回旧业务数据',async(status)=>{
 localStorage.setItem('sm_token','A');notifySessionChange()
 let finish!:(v?:unknown)=>void
 harness.adapter=(config:any)=>new Promise((resolve,reject)=>{finish=()=>status===200?resolve({data:{data:{secret:'A'}},status,config}):reject(new axios.AxiosError('expired','401',config,{}, {status,data:{message:'expired'},config} as any))})
 const request=api.get('/auth/profile').catch(e=>e)
 await vi.waitFor(()=>expect(finish).toBeTypeOf('function'))
 localStorage.setItem('sm_token','B');notifySessionChange()
 finish(); const result=await request
 expect(result).toBeInstanceOf(Error);expect(result.staleSession).toBe(true)
 expect(localStorage.getItem('sm_token')).toBe('B')
})
test('当前身份401清token/user/chat并发事件，而密码错误401不清当前身份',async()=>{
 localStorage.setItem('sm_token','B');localStorage.setItem('sm_user','B');sessionStorage.setItem('sm_ai_chat:1:2','秘密')
 harness.adapter=async(config:any)=>{throw new axios.AxiosError('expired','401',config,{}, {status:401,data:{message:'expired'},config} as any)}
 await expect(api.post('/auth/login',{})).rejects.toMatchObject({status:401})
 expect(localStorage.getItem('sm_token')).toBe('B')
 const event=vi.fn();window.addEventListener('sm-session-change',event)
 await expect(api.get('/auth/profile')).rejects.toMatchObject({status:401})
 expect(localStorage.getItem('sm_token')).toBeNull();expect(localStorage.getItem('sm_user')).toBeNull()
 expect(sessionStorage.length).toBe(0);expect(event).toHaveBeenCalled()
 window.removeEventListener('sm-session-change',event)
 clearSession()
})
test('调用时的身份不能被同一轮换号替换，旧payload不可随新token发出',async()=>{
 localStorage.setItem('sm_token','A');notifySessionChange()
 let authorization:unknown
 harness.adapter=async(config:any)=>{authorization=config.headers.Authorization;return {data:{data:{}},status:200,config}}
 const request=api.post('/ai/ask',{question:'旧店问题',history:[{role:'user',content:'旧店秘密'}]}).catch(e=>e)
 localStorage.setItem('sm_token','B');notifySessionChange()
 await request
 expect(authorization).not.toBe('Bearer B')
})

test.each(['http','envelope'])('App码失效401(%s)不清除当前身份',async(kind)=>{
 localStorage.setItem('sm_token','B');notifySessionChange()
 harness.adapter=async(config:any)=>{if(kind==='http')throw new axios.AxiosError('code expired','401',config,{}, {status:401,data:{message:'code expired'},config} as any);return {data:{code:401,message:'code expired'},status:200,config}}
 await expect(api.post('/auth/web-bridge/redeem',{code:'a'.repeat(32)})).rejects.toMatchObject({status:401})
 expect(localStorage.getItem('sm_token')).toBe('B')
})
