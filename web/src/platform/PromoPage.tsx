import { Alert, Button, Modal, Table, Tag, Typography } from 'antd'
import { useEffect, useRef, useState } from 'react'
import { platformApi, platformErrorMessage } from './api'
import { isPlatformSession, platformSnapshot } from './session'
import { field, panel, QueryError, stack, time, usePlatformQuery } from './ui'
interface Payload {requestId:string;label:string;count:number;redeemExpiresAt:string|null}
interface Batch {id:string;label:string;count:number;createdAt?:string;redeemExpiresAt?:string|null}
interface Generated {batch:Batch;codes:{id:string;code:string;hint:string}[];replayed?:boolean}
interface CodeRow {id:string;batchId:string;codeHint:string;state:string;storeId:number|null;userId:number|null;entitlementId?:number|null;redeemedAt?:string|null;revokedAt?:string|null;createdAt:string;redeemExpiresAt?:string|null;batchLabel:string}
interface AuditRow {id?:string;action:string;targetId:string|null;storeId:number|null;adminId:number;reason:string|null;createdAt:string}
interface Page<T> {list:T[];total:number;page:number;pageSize:number}
interface Recovery {adminId:number;payload:Payload;complete:boolean}
const states:Record<string,string>={unused:'未领取',redeemed:'已领取',disabled:'已停用',revoked:'已收回',expired:'领取已截止'}
const recoveryKey=(id:number)=>`sm_platform_promo_request:${id}`
function readRecovery(id:number):{value:Recovery|null;error:string|null} {
  try {
    const raw=sessionStorage.getItem(recoveryKey(id));if(!raw)return {value:null,error:null}
    const value=JSON.parse(raw) as Recovery
    if(value.adminId!==id||typeof value.payload?.requestId!=='string'||typeof value.payload.label!=='string'||!Number.isInteger(value.payload.count))throw new Error('invalid')
    return {value,error:null}
  } catch {return {value:null,error:'本标签的批次恢复信息无法读取，请恢复浏览器存储后重开页面。'}}
}
function downloadCodes(result:Generated) {
  const quote=(value:unknown)=>`"${String(value??'').replace(/"/g,'""')}"`
  const text='\uFEFF批次编号,体验码,提示\r\n'+result.codes.map(code=>[result.batch.id,code.code,code.hint].map(quote).join(',')).join('\r\n')
  const url=URL.createObjectURL(new Blob([text],{type:'text/csv;charset=utf-8'}))
  const link=document.createElement('a');link.href=url;link.download=`体验码批次-${result.batch.id}.csv`;link.click();setTimeout(()=>URL.revokeObjectURL(url),1000)
}
export default function PromoPage({adminId}:{adminId:number}) {
  const [owner]=useState(platformSnapshot),[initial]=useState(()=>readRecovery(adminId)),alive=useRef(true),flight=useRef(false)
  const [recovery,setRecovery]=useState(initial.value),[generated,setGenerated]=useState<Generated|null>(null),[revealed,setRevealed]=useState(false)
  const [label,setLabel]=useState(initial.value?.payload.label??''),[count,setCount]=useState(initial.value?.payload.count??1),[deadline,setDeadline]=useState('')
  const [busy,setBusy]=useState(false),[error,setError]=useState<string|null>(initial.error),[refresh,setRefresh]=useState(0)
  const [page,setPage]=useState(1),[state,setState]=useState(''),[batchId,setBatchId]=useState(''),[batchInput,setBatchInput]=useState(''),[auditPage,setAuditPage]=useState(1)
  const [target,setTarget]=useState<CodeRow|null>(null),[reason,setReason]=useState(''),[actionBusy,setActionBusy]=useState(false),[actionError,setActionError]=useState<string|null>(null)
  const actionFlight=useRef(false)
  useEffect(()=>{alive.current=true;return()=>{alive.current=false}},[])
  const current=()=>alive.current&&isPlatformSession(owner)
  const codes=usePlatformQuery<Page<CodeRow>>('/platform/promo-codes',{page,pageSize:20,state,batchId},refresh)
  const audit=usePlatformQuery<Page<AuditRow>>('/platform/audit',{page:auditPage,pageSize:20},refresh)
  const persist=(next:Recovery|null)=>{
    if(!current()||initial.error)return false
    try{if(next)sessionStorage.setItem(recoveryKey(adminId),JSON.stringify(next));else sessionStorage.removeItem(recoveryKey(adminId));setRecovery(next);return true}
    catch{setError('批次恢复信息保存失败，请恢复浏览器存储后重试原批次；如已显示生成结果，请先妥善保存。');return false}
  }
  const generate=async()=>{
    if(!current()||flight.current||initial.error)return
    if(!recovery&&(!label.trim()||label.trim().length>80||!Number.isInteger(count)||count<1||count>100)){setError('批次备注须为1至80字，生成数量须为1至100的整数');return}
    let expiresAt:string|null=null
    if(!recovery&&deadline){const date=new Date(deadline);if(!Number.isFinite(date.getTime())||date.getTime()<=Date.now()){setError('领取截止时间须晚于当前时间');return}expiresAt=date.toISOString()}
    const payload=recovery?.payload??{requestId:crypto.randomUUID(),label:label.trim(),count,redeemExpiresAt:expiresAt}
    if(!persist({adminId,payload,complete:false}))return
    flight.current=true;setBusy(true);setError(null)
    try{
      const result=await platformApi.post<Generated>('/platform/promo-batches',payload)
      if(!current())return
      if(!Array.isArray(result.codes)||!result.batch?.id)throw new Error('批次响应不完整，请重试原批次')
      setGenerated(result);setRevealed(false);persist({adminId,payload,complete:true});setRefresh(v=>v+1)
    }catch(e){if(current()){const status=(e as Error&{status?:number}).status;if(status===400||status===413){if(persist(null))setError(platformErrorMessage(e))}else setError(platformErrorMessage(e))}}finally{flight.current=false;if(current())setBusy(false)}
  }
  const changeCode=async()=>{
    if(!target||!current()||actionFlight.current)return
    if(reason.trim().length<2||reason.trim().length>240){setActionError('请填写2至240字的操作原因');return}
    actionFlight.current=true;setActionBusy(true);setActionError(null)
    try{await platformApi.post(`/platform/promo-codes/${target.id}/${target.state==='unused'?'disable':'revoke'}`,{reason:reason.trim()});if(current()){setTarget(null);setRefresh(v=>v+1)}}
    catch(e){if(current())setActionError(platformErrorMessage(e))}finally{actionFlight.current=false;if(current())setActionBusy(false)}
  }
  return <div style={stack}>
    <section style={panel}>
      <Typography.Title level={3}>生成体验码</Typography.Title>
      <Typography.Paragraph type="secondary">每码仅供一家店铺领取 Pro 平台赠送。默认不限期，可由平台收回；与 Apple 订阅独立。完整码不写入普通列表或本机持久存储。</Typography.Paragraph>
      {error&&<Alert type="error" showIcon title={error} style={{marginBottom:12}}/>}
      <form onSubmit={e=>{e.preventDefault();void generate()}}>
        <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(180px,1fr))',gap:12}}>
          <label style={stack}>批次备注<input aria-label="批次备注" style={field} value={label} disabled={!!recovery||busy} maxLength={80} onChange={e=>setLabel(e.target.value)}/></label>
          <label style={stack}>生成数量<input aria-label="生成数量" type="number" style={field} value={count} min={1} max={100} step={1} disabled={!!recovery||busy} onChange={e=>setCount(Number(e.target.value))}/></label>
          <label style={stack}>领取截止（可留空）<input aria-label="领取截止" type="datetime-local" style={field} value={deadline} disabled={!!recovery||busy} onChange={e=>setDeadline(e.target.value)}/></label>
        </div>
        {recovery&&!generated&&<Alert style={{marginTop:12}} type="warning" title="原批次内容已锁定" description="本标签仅保存原请求编号和生成条件。点击恢复或重试，将取回同一批体验码。"/>}
        {recovery?.payload.redeemExpiresAt&&<Typography.Paragraph>原批次领取截止：{time(recovery.payload.redeemExpiresAt)}</Typography.Paragraph>}
        {!generated&&<Button style={{marginTop:16}} type="primary" htmlType="submit" disabled={busy||!!initial.error} loading={busy}>{recovery?'重试原批次 / 恢复结果':'生成体验码'}</Button>}
      </form>
      {generated&&<div style={{marginTop:18,...stack}}>
        <Alert type="success" title={`本批已生成 ${generated.batch.count} 个体验码 · 批次 #${generated.batch.id}`} description="完整码仅在本页内存中保留。请主动查看或下载后妥善保管；刷新后可用原请求恢复。"/>
        <div style={{display:'flex',gap:8,flexWrap:'wrap'}}><Button onClick={()=>setRevealed(v=>!v)}>{revealed?'隐藏完整体验码':'查看完整体验码'}</Button><Button onClick={()=>downloadCodes(generated)}>下载本批完整码 CSV</Button><Button onClick={()=>{if(persist(null)){setGenerated(null);setRevealed(false);setLabel('');setCount(1);setDeadline('');setError(null)}}}>开始新批次</Button></div>
        {revealed&&<div style={{overflowX:'auto'}}><Table rowKey="id" dataSource={generated.codes} pagination={false} columns={[{title:'完整体验码',dataIndex:'code',render:code=><code>{code}</code>},{title:'提示',dataIndex:'hint'}]}/></div>}
      </div>}
    </section>
    <section style={panel}>
      <Typography.Title level={4}>体验码监管</Typography.Title>
      <form onSubmit={e=>{e.preventDefault();setBatchId(batchInput.trim());setPage(1)}} style={{display:'flex',gap:12,flexWrap:'wrap',marginBottom:16,alignItems:'end'}}><label>状态<select aria-label="体验码状态" style={field} value={state} onChange={e=>{setState(e.target.value);setPage(1)}}><option value="">全部</option>{Object.entries(states).map(([value,label])=><option key={value} value={value}>{label}</option>)}</select></label><label>批次编号<input aria-label="筛选批次编号" placeholder="填写完整批次UUID" style={field} value={batchInput} onChange={e=>setBatchInput(e.target.value)} pattern="[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}"/></label><Button htmlType="submit">应用码筛选</Button></form>
      <QueryError error={codes.error} retry={codes.retry}/>
      <div style={{overflowX:'auto'}}><Table<CodeRow> rowKey="id" dataSource={codes.data?.list??[]} loading={codes.busy} scroll={{x:1100}} pagination={{current:page,pageSize:20,total:codes.data?.total??0,onChange:setPage,showSizeChanger:false}} columns={[
        {title:'码提示',dataIndex:'codeHint'}, {title:'批次',render:(_,r)=>`${r.batchLabel} #${r.batchId}`},{title:'状态',dataIndex:'state',render:value=><Tag>{states[value]??value}</Tag>},{title:'店铺 / 用户',render:(_,r)=>`${r.storeId??'—'} / ${r.userId??'—'}`},{title:'创建',dataIndex:'createdAt',render:time},{title:'领取',dataIndex:'redeemedAt',render:time},{title:'领取截止',dataIndex:'redeemExpiresAt',render:value=>value?time(value):'不限期'},{title:'操作',render:(_,r)=>['unused','redeemed'].includes(r.state)?<Button danger onClick={()=>{setTarget(r);setReason('');setActionError(null)}}>{r.state==='unused'?'停用未领码':'收回赠送'}</Button>:'—'},
      ]}/></div>
    </section>
    <section style={panel}><Typography.Title level={4}>平台操作记录</Typography.Title><QueryError error={audit.error} retry={audit.retry}/><div style={{overflowX:'auto'}}><Table<AuditRow> rowKey={r=>r.id??`${r.createdAt}:${r.adminId}:${r.action}:${r.targetId}`} dataSource={audit.data?.list??[]} loading={audit.busy} scroll={{x:900}} pagination={{current:auditPage,pageSize:20,total:audit.data?.total??0,onChange:setAuditPage,showSizeChanger:false}} columns={[{title:'时间',dataIndex:'createdAt',render:time},{title:'动作',dataIndex:'action'},{title:'对象',dataIndex:'targetId'},{title:'店铺',dataIndex:'storeId'},{title:'平台操作人',dataIndex:'adminId'},{title:'原因',dataIndex:'reason'}]}/></div></section>
    <Modal open={!!target} onCancel={()=>setTarget(null)} title={target?.state==='unused'?'停用未领取体验码':'收回已领取的赠送'} onOk={changeCode} confirmLoading={actionBusy} okText={target?.state==='unused'?'确认停用':'确认收回'}>
      <Typography.Paragraph>{target?.state==='unused'?'此码停用后无法再领取。':'只收回此码对应的平台赠送，不会撤销独立的 Apple 权益或取消 Apple 自动续费。'}</Typography.Paragraph>
      {actionError&&<Alert type="error" title={actionError}/>}
      <label style={stack}>操作原因<textarea aria-label="操作原因" style={field} rows={3} value={reason} onChange={e=>setReason(e.target.value)} maxLength={240}/></label>
    </Modal>
  </div>
}
