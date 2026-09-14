import { Alert, Button, Input, Typography } from 'antd'
import { useEffect, useRef, useState } from 'react'
import api from '../api/client'
import { useAuth } from '../auth'
import { refreshEntitlement } from '../hooks/useEntitlement'
import { isCurrentSession, sessionSnapshot } from '../lib/session'
import { cardStyle } from '../theme'

export default function ExperienceCodePage() {
  const {user,profile,profileError,refreshProfile,logout}=useAuth()
  const [retrying,setRetrying]=useState(false),[retryError,setRetryError]=useState<string|null>(null)
  const flight=useRef(false),alive=useRef(true)
  useEffect(()=>{alive.current=true;return()=>{alive.current=false}},[])
  const retry=async()=>{
    if(flight.current)return
    const owner=sessionSnapshot();flight.current=true;setRetrying(true);setRetryError(null)
    try{await refreshProfile()}
    catch(e){if(alive.current&&isCurrentSession(owner))setRetryError((e as Error).message)}
    finally{flight.current=false;if(alive.current&&isCurrentSession(owner))setRetrying(false)}
  }
  const actions=<><Button loading={retrying} disabled={retrying} onClick={retry}>重新验证身份</Button><Button onClick={logout}>退出并重新登录</Button></>
  if(profileError||retryError)return <Alert type="error" showIcon title="店铺身份验证失败" description={retryError||profileError} action={actions}/>
  if(!user||!profile)return <Alert type="info" title="正在确认当前店铺身份…" description="如果长时间没有结果，可以重新验证身份或退出后重新登录。" action={actions}/>
  if(profile.id!==user.id)return <Alert type="error" showIcon title="店铺身份不一致，请重新验证" description="当前账号与店铺信息不一致，暂时不能兑换。" action={actions}/>
  if(user.role!=='admin')return <Alert type="info" title="请店主登录后兑换体验码" description="体验码为店铺提供平台赠送权益，员工无需单独领取。"/>
  if(!Number.isSafeInteger(profile.storeId)||Number(profile.storeId)<=0)return <Alert type="warning" showIcon title="当前服务暂不支持体验码兑换" description="服务未返回有效的店铺编号，暂时无法确认体验权益归属。可以重新验证身份；若仍提示此信息，需要更新当前连接的后端服务后再兑换。" action={actions}/>
  return <ExperienceForm key={`${profile.storeId}:${user.id}`} storeId={profile.storeId!} shopName={profile.shopName}/>
}
function ExperienceForm({storeId,shopName}:{storeId:number;shopName:string}) {
  const [owner]=useState(sessionSnapshot),alive=useRef(true),flight=useRef(false)
  const [code,setCode]=useState(''),[pending,setPending]=useState<string|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState<string|null>(null),[success,setSuccess]=useState(false)
  useEffect(()=>{alive.current=true;return()=>{alive.current=false}},[])
  const current=()=>alive.current&&isCurrentSession(owner)
  const redeem=async()=>{
    if(!current()||flight.current)return
    const original=pending??code.trim()
    if(!original){setError('请填写体验码');return}
    flight.current=true;setBusy(true);setPending(original);setError(null)
    try{
      await api.post('/me/experience-code',{code:original})
      if(!current())return
      setSuccess(true);setCode('');setPending(null);void refreshEntitlement()
    }catch(e){
      if(!current())return
      const status=(e as Error&{status?:number}).status
      if(status&&[400,403,404,409,410,422].includes(status))setPending(null)
      setError(status===404?'体验码服务尚未升级或该体验码不可用，请核对并联系平台。':status===503?'体验码服务暂未就绪，请稍后重试原码。':(e as Error).message)
    }finally{flight.current=false;if(current())setBusy(false)}
  }
  return <div style={{...cardStyle,padding:24,maxWidth:720}}>
    <Typography.Title level={3}>兑换体验码</Typography.Title>
    <Alert type="info" title={`当前店铺：${shopName || '未命名店铺'} #${storeId}`} description="确认店铺正确后再兑换；同一码只能由一家店铺领取。" style={{marginBottom:16}}/>
    <Typography.Paragraph>体验码可为当前店铺领取 Pro 平台赠送权益，不设自动到期日，可由平台收回。AI 使用仍遵循 Pro 防滥用额度。</Typography.Paragraph>
    <Alert type="info" showIcon title="已有 Apple 订阅保持独立" description="兑换不会取消或替代 Apple 自动续费；如需调整订阅，请自行在 Apple 订阅设置中管理。" style={{marginBottom:20}}/>
    {error&&<Alert type="error" title={error} showIcon style={{marginBottom:12}}/>}
    {success?<Alert type="success" title="兑换成功，平台赠送已记录" description="已请求刷新店铺权益。返回工作台查看最新状态；若尚未更新，请刷新页面。"/>:<form onSubmit={e=>{e.preventDefault();void redeem()}}>
      <label style={{display:'grid',gap:8}}>体验码<Input aria-label="体验码" autoComplete="off" value={code} disabled={!!pending||busy} onChange={e=>setCode(e.target.value)} placeholder="填写平台提供的完整体验码"/></label>
      {pending&&!busy&&<Typography.Paragraph type="secondary" style={{marginTop:12}}>原码结果待确认，重试会恢复同一笔兑换。</Typography.Paragraph>}
      <Button type="primary" htmlType="submit" loading={busy} disabled={busy} style={{marginTop:16}}>{pending?'重试兑换':'确认兑换'}</Button>
    </form>}
  </div>
}
