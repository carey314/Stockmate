import { Alert, App, Button, ConfigProvider, Input, Spin, Typography } from 'antd'
import { useEffect, useRef, useState } from 'react'
import { platformApi, platformErrorMessage } from './api'
import { isPlatformSession, PLATFORM_SESSION_EVENT, platformSnapshot, platformStorageChanged, setPlatformToken } from './session'
import type { PlatformAdmin } from './types'
import { AiPage, OverviewPage, UsersPage } from './MetricsPages'
import PromoPage from './PromoPage'
import { panel, stack } from './ui'

export default function PlatformApp() {
  return <ConfigProvider theme={{token:{colorPrimary:'#2456a6',borderRadius:8,fontFamily:'Manrope, system-ui, sans-serif'}}}><App><PlatformSession/></App></ConfigProvider>
}
function PlatformSession() {
  const [snapshot,setSnapshot]=useState(platformSnapshot),[admin,setAdmin]=useState<PlatformAdmin|null>(null),[error,setError]=useState<string|null>(null),[attempt,setAttempt]=useState(0)
  useEffect(()=>{
    const update=()=>{setAdmin(null);setError(null);setSnapshot(platformSnapshot())}
    window.addEventListener(PLATFORM_SESSION_EVENT,update);window.addEventListener('storage',platformStorageChanged)
    return()=>{window.removeEventListener(PLATFORM_SESSION_EVENT,update);window.removeEventListener('storage',platformStorageChanged)}
  },[])
  useEffect(()=>{
    if(!snapshot.token)return
    let alive=true;setError(null)
    platformApi.get<{admin:PlatformAdmin}>('/platform/auth/profile').then(({admin:profile})=>{
      if(!alive||!isPlatformSession(snapshot))return
      if(!profile?.id||!profile.username)throw new Error('平台身份响应不完整，请重试')
      setAdmin(profile)
    }).catch(e=>{if(alive&&isPlatformSession(snapshot))setError(platformErrorMessage(e))})
    return()=>{alive=false}
  },[snapshot,attempt])
  if(!snapshot.token)return <PlatformLogin/>
  if(!admin)return <main style={{maxWidth:600,margin:'15vh auto',padding:24}}>{error?<Alert type="error" title={error} action={<Button onClick={()=>setAttempt(v=>v+1)}>重试验证</Button>}/>:<><Spin/><Typography.Paragraph>正在验证平台身份…</Typography.Paragraph></>}<Button onClick={()=>setPlatformToken(null)} style={{marginTop:16}}>退出平台</Button></main>
  return <PlatformWorkspace key={`${snapshot.revision}:${admin.id}`} admin={admin}/>
}
function PlatformLogin() {
  const [username,setUsername]=useState(''),[password,setPassword]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState<string|null>(null),flight=useRef(false),alive=useRef(true)
  useEffect(()=>{alive.current=true;return()=>{alive.current=false}},[])
  const login=async()=>{
    if(flight.current)return
    if(!username.trim()||!password){setError('请填写平台账号与密码');return}
    const owner=platformSnapshot();flight.current=true;setBusy(true);setError(null)
    try{
      const result=await platformApi.post<{token:string;admin:PlatformAdmin}>('/platform/auth/login',{username:username.trim(),password})
      if(!alive.current||!isPlatformSession(owner))return
      if(!result.token||!result.admin?.id)throw new Error('平台登录响应不完整')
      setPassword('');setPlatformToken(result.token)
    }catch(e){if(alive.current&&isPlatformSession(owner))setError(platformErrorMessage(e))}finally{flight.current=false;if(alive.current)setBusy(false)}
  }
  return <main style={{minHeight:'100vh',background:'#f4f6fa',display:'grid',placeItems:'center',padding:24}}><section style={{...panel,width:'100%',maxWidth:420,padding:32}}>
    <Typography.Text type="secondary">STOCKMATE · OPERATIONS</Typography.Text><Typography.Title level={2}>平台运营登录</Typography.Title><Typography.Paragraph type="secondary">使用独立的平台管理账号。商家账号不能访问跨店运营数据；平台账号由维护人员配置。</Typography.Paragraph>
    {error&&<Alert type="error" showIcon title={error} style={{marginBottom:16}}/>}
    <form style={stack} onSubmit={e=>{e.preventDefault();void login()}}><label style={{display:'grid',gap:6}}>平台账号<Input aria-label="平台账号" autoComplete="username" value={username} onChange={e=>setUsername(e.target.value)} disabled={busy}/></label><label style={{display:'grid',gap:6}}>平台密码<Input.Password aria-label="平台密码" autoComplete="current-password" value={password} onChange={e=>setPassword(e.target.value)} disabled={busy}/></label><Button htmlType="submit" type="primary" loading={busy} disabled={busy}>登录平台</Button></form>
    <a href={import.meta.env.BASE_URL} style={{display:'inline-block',marginTop:20}}>返回商家工作台</a>
  </section></main>
}
function PlatformWorkspace({admin}:{admin:PlatformAdmin}) {
  const [page,setPage]=useState('overview')
  const menus=[['overview','总览'],['users','用户与店铺'],['ai','AI 明细'],['promo','体验码与审计']]
  return <div style={{minHeight:'100vh',background:'#f4f6fa',color:'#182230'}}>
    <header style={{background:'#fff',borderBottom:'1px solid #e5e7eb',padding:'18px 24px',display:'flex',gap:16,alignItems:'center',flexWrap:'wrap'}}><Typography.Title level={4} style={{margin:0}}>智存 · 平台运营</Typography.Title><Typography.Text type="secondary">独立平台权限</Typography.Text><div style={{marginLeft:'auto',display:'flex',alignItems:'center',gap:12}}><span>{admin.displayName||admin.username}</span><Button onClick={()=>setPlatformToken(null)}>退出平台</Button></div></header>
    <main style={{maxWidth:1480,margin:'0 auto',padding:'20px clamp(12px, 3vw, 32px)',...stack}}><nav aria-label="平台菜单" style={{display:'flex',gap:8,flexWrap:'wrap'}}>{menus.map(([key,label])=><Button key={key} type={page===key?'primary':'default'} aria-current={page===key?'page':undefined} onClick={()=>setPage(key)}>{label}</Button>)}</nav>
      {page==='overview'?<OverviewPage/>:page==='users'?<UsersPage/>:page==='ai'?<AiPage/>:<PromoPage adminId={admin.id}/>}
    </main>
  </div>
}
