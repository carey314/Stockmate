import { Alert, Button, Descriptions, Drawer, Spin, Table, Tag, Typography } from 'antd'
import { useState } from 'react'
import type { AiRecord, AiSummary, Overview, Paged, PlatformUser, Range, UserDetail as UserDetailData } from './types'
import { field, number, panel, QueryError, stack, time, usePlatformQuery } from './ui'

const registrationLabel = (source:string) => ({password:'账号密码注册',apple:'Apple 注册',sms:'短信验证注册',staff:'店主创建员工',unknown:'未知'}[source] ?? '未知')

function RangeFilter({onApply}:{onApply:(range:Range)=>void}) {
  const [from,setFrom]=useState(''),[to,setTo]=useState(''),[error,setError]=useState<string|null>(null)
  return <form onSubmit={event=>{
    event.preventDefault();setError(null)
    if(!from&&!to){onApply({});return}
    if(!from||!to){setError('请选择完整起止日期');return}
    const start=new Date(`${from}T00:00:00`),end=new Date(`${to}T23:59:59.999`)
    if(end<start||end.getTime()-start.getTime()>366*86400000){setError('日期须按先后顺序，跨度不超过366天');return}
    onApply({from:start.toISOString(),to:end.toISOString()})
  }} style={{...panel,display:'flex',gap:12,alignItems:'end',flexWrap:'wrap'}}>
    <label>开始日期<input aria-label="开始日期" type="date" style={field} value={from} onChange={e=>setFrom(e.target.value)}/></label>
    <label>结束日期<input aria-label="结束日期" type="date" style={field} value={to} onChange={e=>setTo(e.target.value)}/></label>
    <Button htmlType="submit">应用日期范围</Button><Button onClick={()=>{setFrom('');setTo('');setError(null);onApply({})}}>近30天</Button>
    {error&&<Alert type="error" title={error}/>}
  </form>
}
function Cards({items}:{items:[string,number|null|undefined][]}) {return <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(160px,1fr))',gap:12}}>{items.map(([label,value])=><div key={label} style={{...panel,padding:16}}><div style={{fontSize:13,color:'#667085'}}>{label}</div><div style={{fontSize:27,fontWeight:650,marginTop:8}}>{number(value)}</div></div>)}</div>}
function RangeNote({range}:{range?:Range}) {return range?.from&&range?.to?<Typography.Paragraph type="secondary">统计范围：{time(range.from)} — {time(range.to)}</Typography.Paragraph>:null}
export function AiSummaryPanel({data}:{data:AiSummary}) {
  return <section style={{...panel,...stack}}>
    <Typography.Title level={4} style={{margin:0}}>AI 调用与计费完整性</Typography.Title>
    <Typography.Paragraph type="secondary" style={{margin:0}}>每次供应商尝试单独计数；成功解析不等于落单。缺少 usage 的调用保留未知，不能作为零消耗。</Typography.Paragraph>
    <Cards items={[["供应商尝试",data.attempts],["逻辑请求",data.logicalRequests],["成功解析",data.success],["调用失败",data.failed],["解析失败",data.parseFailed]]}/>
    <Cards items={[["输入 token",data.promptTokens],["输出 token",data.completionTokens],["缓存命中 token",data.cacheHitTokens],["缓存未命中 token",data.cacheMissTokens],["总 token",data.totalTokens]]}/>
    <Typography.Text>usage 已知 {number(data.usageKnownAttempts)} 次 / 未知 {number(data.usageUnknownAttempts)} 次；可估算成本 {number(data.costKnownAttempts)} 次 / 成本未知 {number(data.costUnknownAttempts)} 次。</Typography.Text>
    {!!data.tokenCoverage&&<Typography.Text type="secondary">字段覆盖：{Object.entries(data.tokenCoverage).map(([key,value])=>`${key} 已知${value.known}/未知${value.unknown}`).join('；')}</Typography.Text>}
    <Typography.Text>按配置价格估算：{data.estimatedCosts?.length?data.estimatedCosts.map(cost=>`${cost.currency} ${cost.amount.toFixed(6)}`).join('；'):'未知'}。未配置模型价格或缺少计费项时不补造金额。</Typography.Text>
  </section>
}
export function OverviewPage() {
  const [range,setRange]=useState<Range>({}),query=usePlatformQuery<Overview>('/platform/overview',range),data=query.data
  return <div style={stack}><RangeFilter onApply={setRange}/><QueryError error={query.error} retry={query.retry}/>{query.busy&&<Spin/>}{data&&<>
    <section style={{...panel,...stack}}><Typography.Title level={3} style={{margin:0}}>平台总览</Typography.Title><RangeNote range={data.range}/><Typography.Text type="secondary">用户与店铺数量为当前留存累计，绑定和权益为当前状态；AI 数据按所选日期统计。当前绑定不能反推首次注册渠道，权益不能替代真实付款。</Typography.Text>
      <Cards items={[["注册用户",data.registrations.users],["注册店铺",data.registrations.stores],["老板账号",data.registrations.admins],["员工账号",data.registrations.staff],["停用账号",data.registrations.disabledUsers]]}/>
      <Typography.Text>注册渠道仅来自真实注册事件；未记录的历史显示未知。当前 Apple 绑定 {number(data.bindings.appleUsers)}，手机号绑定 {number(data.bindings.phoneUsers)}，同时绑定 {number(data.bindings.overlapUsers)}。</Typography.Text>
      {data.registrationSources&&<Cards items={Object.entries(data.registrationSources).map(([key,value])=>[registrationLabel(key),value])}/>}
    </section>
    <section style={{...panel,...stack}}><Typography.Title level={4} style={{margin:0}}>权益与验证交易分开统计</Typography.Title>
      <Cards items={[["当前 Pro 店铺",data.entitlements.currentProStores],["当前已验证生产 Pro 店铺",data.entitlements.currentVerifiedProductionProStores],["已验证生产购买店铺",data.entitlements.verifiedProductionStores],["已验证 Sandbox 店铺",data.entitlements.verifiedSandboxStores],["人工赠送店铺",data.entitlements.manualStores],["体验码赠送店铺",data.entitlements.promotionStores],["Apple 环境未知店铺",data.entitlements.unknownAppleStores]]}/>
      <Typography.Text>已验证 Production 交易 {number(data.entitlements.verifiedProductionTransactions)} 笔；Sandbox 交易 {number(data.entitlements.verifiedSandboxTransactions)} 笔。</Typography.Text>
      <Alert type="info" title="Apple 实收收入：未知" description="权益、商品目录价和Sandbox交易不能作为真实收款证明；本页不据此计算营收。"/>
    </section><AiSummaryPanel data={data.ai}/>{data.notes?.map((note,i)=><Alert key={i} type="info" title={note}/>)}</>}</div>
}
export function UsersPage() {
  const [page,setPage]=useState(1),[input,setInput]=useState(''),[search,setSearch]=useState(''),[selected,setSelected]=useState<number|null>(null)
  const query=usePlatformQuery<Paged<PlatformUser>>('/platform/users',{page,pageSize:20,query:search})
  return <div style={stack}><section style={panel}>
    <Typography.Title level={3}>用户与店铺</Typography.Title><form onSubmit={e=>{e.preventDefault();setSearch(input.trim());setPage(1)}} style={{display:'flex',gap:12,marginBottom:16}}><input aria-label="搜索用户店铺" style={{...field,maxWidth:360}} placeholder="用户名、姓名或数字店铺ID" value={input} onChange={e=>setInput(e.target.value)}/><Button htmlType="submit">搜索</Button></form>
    <QueryError error={query.error} retry={query.retry}/><div style={{overflowX:'auto'}}><Table<PlatformUser> rowKey="id" loading={query.busy} dataSource={query.data?.list??[]} scroll={{x:1050}} pagination={{current:page,pageSize:20,total:query.data?.pagination.total??0,onChange:setPage,showSizeChanger:false}} columns={[
      {title:'用户',render:(_,u)=><span>{u.realName} <code>#{u.id} {u.username}</code></span>},{title:'店铺',render:(_,u)=>`${u.store?.name??'已注销'} #${u.storeId}`},{title:'角色',dataIndex:'role',render:r=>r==='admin'?'老板':'员工'},{title:'状态',dataIndex:'status',render:value=>value===1?'启用':'停用'},{title:'当前绑定',render:(_,u)=>[u.bindings.apple?'Apple':null,u.bindings.phone?'手机号':null].filter(Boolean).join(' / ')||'未绑定'},{title:'首次注册来源',dataIndex:'registrationSource',render:registrationLabel},{title:'注册时间',dataIndex:'createdAt',render:time},{title:'操作',render:(_,u)=><Button onClick={()=>setSelected(u.id)}>查看详情</Button>},
    ]}/></div>
    </section><Drawer open={selected!==null} onClose={()=>setSelected(null)} title="用户运营详情" size="large">{selected!==null&&<UserDetail key={selected} id={selected}/>}</Drawer></div>
}
function UserDetail({id}:{id:number}) {
  const query=usePlatformQuery<UserDetailData>(`/platform/users/${id}`),data=query.data
  const phase:Record<string,string>={before_first_order:'首张店铺销售单之前',after_first_order:'首张店铺销售单之后',unknown:'未知'}
  return <div style={stack}><QueryError error={query.error} retry={query.retry}/>{query.busy&&<Spin/>}{data&&<>
    <Typography.Title level={4}>{data.user.realName} · {data.user.store?.name??'已注销店铺'}</Typography.Title><Typography.Text type="secondary">首次注册来源：{registrationLabel(data.user.registrationSource)}。下列经营数量归属店铺，不能解释为该用户个人贡献；不展示商品或订单正文。</Typography.Text>
    <Cards items={[["店铺商品数",data.counts.products],["店铺规格数",data.counts.skus],["店铺销售单数",data.counts.orders],["店铺采购单数",data.counts.purchaseOrders],["AI 尝试数",data.counts.aiAttempts]]}/>
    <Descriptions column={1} title="首次已知购买阶段" items={[{key:'purchase',label:'最早已知购买',children:time(data.purchaseStage.earliestKnownPurchaseAt)},{key:'registered',label:'注册至购买天数',children:number(data.purchaseStage.daysFromRegistration)},{key:'order',label:'首张店铺销售单',children:time(data.purchaseStage.firstOrderAt)},{key:'ai',label:'首次已知 AI',children:time(data.purchaseStage.firstAiAt)},{key:'phase',label:'店铺阶段',children:phase[data.purchaseStage.phase]??'未知'},{key:'entry',label:'历史付费入口',children:'未知'}]}/>
    <Typography.Text>权益来源独立保留；平台赠送不是已验证购买。</Typography.Text>
    {data.entitlements.map((ent,index)=><Alert key={index} type="info" title={`${ent.source} · ${ent.plan} · ${ent.status}`} description={`${ent.environment??'环境未知'} · ${ent.verified?'已验证':'未验证'} · ${ent.expiresAt?`到期 ${time(ent.expiresAt)}`:'无自动到期日'}`}/>)}
    <RangeNote range={data.range}/><AiSummaryPanel data={data.ai}/>
  </>}</div>
}
export function AiPage() {
  const [range,setRange]=useState<Range>({}),[page,setPage]=useState(1),[userInput,setUserInput]=useState(''),[storeInput,setStoreInput]=useState(''),[identity,setIdentity]=useState({userId:'',storeId:''}),[selected,setSelected]=useState<AiRecord|null>(null)
  const query=usePlatformQuery<Paged<AiRecord>&{summary:AiSummary;range:Range}>('/platform/ai-requests',{...range,...identity,page,pageSize:20})
  const statuses:Record<string,string>={success:'解析成功',failed:'调用失败',parse_failed:'解析失败'}
  return <div style={stack}><RangeFilter onApply={value=>{setRange(value);setPage(1)}}/>
    <form style={{...panel,display:'flex',gap:12,alignItems:'end',flexWrap:'wrap'}} onSubmit={e=>{e.preventDefault();setIdentity({userId:userInput,storeId:storeInput});setPage(1)}}><label>用户 ID<input aria-label="筛选用户ID" type="number" min={1} value={userInput} style={field} onChange={e=>setUserInput(e.target.value)}/></label><label>店铺 ID<input aria-label="筛选店铺ID" type="number" min={1} value={storeInput} style={field} onChange={e=>setStoreInput(e.target.value)}/></label><Button htmlType="submit">应用身份筛选</Button></form>
    <QueryError error={query.error} retry={query.retry}/>{query.data&&<><RangeNote range={query.data.range}/><AiSummaryPanel data={query.data.summary}/></>}
    <section style={panel}><Typography.Title level={3}>AI 供应商尝试明细</Typography.Title><Typography.Paragraph type="secondary">仅展示调用元数据，不显示用户提问、经营正文或模型回复。</Typography.Paragraph><div style={{overflowX:'auto'}}><Table<AiRecord> rowKey="id" dataSource={query.data?.list??[]} loading={query.busy} scroll={{x:1500}} pagination={{current:page,pageSize:20,total:query.data?.pagination.total??0,onChange:setPage,showSizeChanger:false}} columns={[
      {title:'时间',dataIndex:'createdAt',render:time},{title:'用户 / 店铺',render:(_,r)=>`${r.userId} / ${r.storeId}`},{title:'逻辑请求',dataIndex:'requestId',ellipsis:true},{title:'尝试',dataIndex:'attempt',width:65},{title:'接口',dataIndex:'endpoint'},{title:'模型',dataIndex:'model'},{title:'结果',dataIndex:'status',render:s=><Tag>{statuses[s]??s}</Tag>},{title:'耗时ms',dataIndex:'durationMs',render:number},{title:'输入 / 输出',render:(_,r)=>`${number(r.promptTokens)} / ${number(r.completionTokens)}`},{title:'缓存命中 / 未命中',render:(_,r)=>`${number(r.cacheHitTokens)} / ${number(r.cacheMissTokens)}`},{title:'估算成本',render:(_,r)=>r.estimatedCost==null?'未知':`${r.currency??'币种未知'} ${r.estimatedCost.toFixed(6)}`},{title:'计费依据',render:(_,r)=><Button onClick={()=>setSelected(r)}>查看快照</Button>},
    ]}/></div></section>
    <Drawer open={!!selected} title="调用计费快照" onClose={()=>setSelected(null)} size="large">{selected&&<div style={stack}><Typography.Text>模型：{selected.model}；供应商错误码：{selected.errorCode??'—'}</Typography.Text><Typography.Text>输入 {number(selected.promptTokens)} / 输出 {number(selected.completionTokens)} / 总计 {number(selected.totalTokens)} token</Typography.Text><Typography.Text type="secondary">价格仅为本次已配置的估算依据；usage 或价格缺失保持未知。</Typography.Text><pre style={{whiteSpace:'pre-wrap',wordBreak:'break-word'}}>{selected.pricingSnapshot?JSON.stringify(selected.pricingSnapshot,null,2):'无可用价格快照'}</pre></div>}</Drawer>
  </div>
}
