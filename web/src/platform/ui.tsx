import { Alert, Button } from 'antd'
import { useEffect, useState } from 'react'
import type { CSSProperties } from 'react'
import { platformApi, platformErrorMessage } from './api'
export const panel: CSSProperties = {background:'#fff',border:'1px solid #e5e7eb',borderRadius:12,padding:20,minWidth:0}
export const field: CSSProperties = {padding:'8px 10px',border:'1px solid #d1d5db',borderRadius:6,font:'inherit',width:'100%',minWidth:0,background:'#fff',color:'#182230'}
export const stack: CSSProperties = {display:'grid',gap:18,minWidth:0}
export const time = (value?: string|null) => value ? new Date(value).toLocaleString('zh-CN') : '—'
export const number = (value?: number|null) => value == null ? '未知' : value.toLocaleString('zh-CN')
export function usePlatformQuery<T>(path:string,params:object={},version=0) {
  const [data,setData]=useState<T|null>(null),[error,setError]=useState<string|null>(null),[busy,setBusy]=useState(true),[attempt,setAttempt]=useState(0)
  const encoded=JSON.stringify(params)
  useEffect(()=>{
    let active=true;setBusy(true);setError(null);setData(null)
    platformApi.get<T>(path,JSON.parse(encoded)).then(result=>{if(active)setData(result)}).catch(error=>{if(active)setError(platformErrorMessage(error))}).finally(()=>{if(active)setBusy(false)})
    return ()=>{active=false}
  },[path,encoded,version,attempt])
  return {data,error,busy,retry:()=>setAttempt(n=>n+1)}
}
export function QueryError({error,retry}:{error:string|null;retry:()=>void}) {return error?<Alert type="error" showIcon title={error} action={<Button onClick={retry}>重试</Button>}/>:null}
