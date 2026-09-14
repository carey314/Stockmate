import { Alert, App, Button, Modal, Typography } from 'antd'
import { useEffect, useRef, useState, type CSSProperties } from 'react'
import api from '../api/client'
import { fetchAllPages } from '../api/pagination'
import { useAuth } from '../auth'
import { draftStorage } from '../lib/draftStorage'
import { fmtMoney } from '../lib/format'

interface Line { skuId: number; name: string; unit: string; quantity: number; unitPrice: number }
interface SalePayload { requestId: string; customerId: number | null; items: {skuId: number; quantity: number; unitPrice: number}[]; discountAmount: number; paidAmount: number; settlementAccount: string; notes: string }
interface Draft { customerId: number | null; lines: Line[]; discount: number; paid: number | null; account: string; notes: string; pending: SalePayload | null }
interface Product { id: number; name: string; unit: string; skus: {id: number; specText: string; price: number; status: number}[] }
interface Choice { id: number; name: string; unit: string; price: number }
const blank = (): Draft => ({customerId:null,lines:[],discount:0,paid:null,account:'现金',notes:'',pending:null})
const field: CSSProperties = { width:'100%', minHeight:36, border:'1px solid #d9d9d9', borderRadius:6, padding:'6px 10px', font:'inherit', background:'var(--ant-color-bg-container, white)', color:'inherit' }
const label: CSSProperties = { display:'grid', gap:6 }
const money = (n: number) => Math.round(n * 100) / 100

interface ModalProps { open: boolean; onClose: () => void; onCreated: (id: number) => void }

export default function ManualSaleModal(props: ModalProps) {
  const { user, profile, profileError, refreshProfile } = useAuth()
  const storeId = profile?.storeId
  // Login sets user before the verified profile arrives. Never mount draftStorage
  // with an account-only key: an uncertain order must remain in its store's draft.
  if (!user || profile?.id !== user.id || !Number.isSafeInteger(storeId) || Number(storeId) <= 0) {
    return <Modal open={props.open} onCancel={props.onClose} title="手工销售开单" footer={<Button onClick={props.onClose}>关闭</Button>}>
      <Alert type={profileError ? 'error' : 'info'} title={profileError || '正在确认当前账号与店铺信息…'} description="身份确认完成后将恢复当前店铺的销售草稿。" action={profileError ? <Button onClick={() => void refreshProfile().catch(() => {})}>重试身份验证</Button> : undefined}/>
    </Modal>
  }
  return <ManualSaleForm key={`${storeId}:${user.id}`} {...props} userId={user.id} storeId={storeId!}/>
}

function ManualSaleForm({open,onClose,onCreated,userId,storeId}:ModalProps & {userId:number;storeId:number}) {
  const { message } = App.useApp()
  const [storage] = useState(() => draftStorage<Draft>('manual-sale',userId,storeId))
  const [draft,setDraft] = useState<Draft>(() => storage.initial ?? blank())
  const current = useRef(draft)
  const alive = useRef(true), flight = useRef(false), priceVersion = useRef(0)
  const [busy,setBusy] = useState(false), [priceBusy,setPriceBusy] = useState(false)
  const [error,setError] = useState<string | null>(storage.readError)
  const [optionsError,setOptionsError] = useState<string | null>(null)
  const [customers,setCustomers] = useState<{id:number;name:string}[]>([]), [choices,setChoices] = useState<Choice[]>([])
  const [loading,setLoading] = useState(true), [retry,setRetry] = useState(0)
  useEffect(() => { alive.current=true; return () => {alive.current=false;priceVersion.current++} },[])
  useEffect(() => {
    let active=true
    setLoading(true);setOptionsError(null)
    Promise.all([fetchAllPages<{id:number;name:string}>('/customers'),fetchAllPages<Product>('/products')]).then(([people,products]) => {
      if (!active || !storage.current()) return
      setCustomers(people.filter(c=>c.name!=='散客'))
      setChoices(products.flatMap(p=>p.skus.filter(s=>s.status===1).map(s=>({id:s.id,name:`${p.name}${s.specText ? ` ${s.specText}` : ''}`,unit:p.unit,price:s.price}))))
    }).catch(e=>{if(active)setOptionsError((e as Error).message)}).finally(()=>{if(active)setLoading(false)})
    return ()=>{active=false}
  },[retry,storage])
  const save = (next: Draft) => {
    const problem=storage.write(next)
    if(problem){setError(problem);return false}
    current.current=next;setDraft(next);setError(null);return true
  }
  const edit = (patch:Partial<Draft>) => {if(!current.current.pending && !flight.current)save({...current.current,...patch})}
  const priceFor = async (choice:Choice,customerId:number|null) => customerId ? (await api.get<{price:number}>('/pricing/resolve',{skuId:choice.id,customerId})).price : choice.price
  const add = async (id:number) => {
    const choice=choices.find(c=>c.id===id)
    if(!choice || priceBusy || draft.pending || !storage.current())return
    const version=++priceVersion.current;setPriceBusy(true)
    try{
      const unitPrice=await priceFor(choice,current.current.customerId)
      if(alive.current && storage.current() && version===priceVersion.current) edit({lines:[...current.current.lines,{skuId:id,name:choice.name,unit:choice.unit,quantity:1,unitPrice}]})
    }catch(e){if(alive.current)setError((e as Error).message)}finally{if(alive.current && version===priceVersion.current)setPriceBusy(false)}
  }
  const changeCustomer = async (customerId:number|null) => {
    if(priceBusy || current.current.pending || !storage.current())return
    const version=++priceVersion.current;setPriceBusy(true)
    try{
      const lines=await Promise.all(current.current.lines.map(async line=>{
        const choice=choices.find(c=>c.id===line.skuId)
        if(!choice)throw new Error('草稿中的规格已不可用，请先移除该行')
        return {...line,unitPrice:await priceFor(choice,customerId)}
      }))
      if(alive.current && storage.current() && version===priceVersion.current)edit({customerId,lines})
    }catch(e){if(alive.current)setError((e as Error).message)}finally{if(alive.current && version===priceVersion.current)setPriceBusy(false)}
  }
  const total=money(draft.lines.reduce((sum,line)=>sum+money(line.quantity*line.unitPrice),0))
  const actual=money(Math.max(0,total-draft.discount)), paid=draft.paid ?? (draft.account==='挂账'?0:actual)
  const submit = async () => {
    if(flight.current || priceBusy || !storage.current())return
    let payload=current.current.pending
    if(!payload){
      if(loading || optionsError)return
      if(!draft.lines.length){setError('请至少添加一个商品规格');return}
      if(draft.lines.some(l=>!Number.isFinite(l.quantity)||l.quantity<=0||Math.abs(l.quantity*1000-Math.round(l.quantity*1000))>1e-7||!Number.isFinite(l.unitPrice)||l.unitPrice<0)){setError('数量须大于0且最多三位小数，单价不能为负');return}
      if(!Number.isFinite(draft.discount)||draft.discount<0||!Number.isFinite(paid)||paid<0){setError('优惠和实收必须是有效的非负金额');return}
      if(!draft.customerId && (money(paid)!==actual || draft.account==='挂账')){setError('散客订单需当场结清；挂账请先选择实名客户');return}
      if(draft.account==='挂账' && paid>0){setError('已有实收请选择实际收款账户');return}
      payload={requestId:crypto.randomUUID(),customerId:draft.customerId,items:draft.lines.map(({skuId,quantity,unitPrice})=>({skuId,quantity,unitPrice})),discountAmount:draft.discount,paidAmount:paid,settlementAccount:draft.account,notes:draft.notes}
      if(!save({...current.current,pending:payload}))return
    }
    flight.current=true;setBusy(true);setError(null)
    try{
      const result=await api.post<{id:number;negativeStock?:string[]}>('/orders',payload)
      if(!alive.current || !storage.current())return
      if(!save(blank()))return
      if(result.negativeStock?.length)message.warning(`开单成功，库存不足：${result.negativeStock.join('；')}`)
      else message.success('开单成功')
      onCreated(result.id)
    }catch(e){
      if(!alive.current || !storage.current())return
      const status=(e as Error & {status?:number}).status
      if(status && [400,404,422].includes(status)){
        if(save({...current.current,pending:null}))setError((e as Error).message)
      }else setError(`${(e as Error).message}。结果尚未确认，草稿已锁定，请重试原单。`)
    }finally{flight.current=false;if(alive.current)setBusy(false)}
  }
  const locked=!!draft.pending || busy || priceBusy
  return <Modal open={open} onCancel={onClose} title="手工销售开单" width={820} footer={null} mask={{closable:!busy}}>
    <form onSubmit={e=>{e.preventDefault();void submit()}}>
      <Typography.Paragraph type="secondary">选择客户与商品即可开单。草稿自动保存在当前账号和店铺。</Typography.Paragraph>
      {error && <Alert type="error" title={error} showIcon style={{marginBottom:12}}/>}
      {draft.pending && <Alert type="warning" title="原单结果待确认" description="此草稿已锁定。重试将核对同一请求，不会重复开单或扣库存。" style={{marginBottom:12}}/>}
      {optionsError && <Alert type="error" title={`商品或客户加载失败：${optionsError}`} action={<Button onClick={()=>setRetry(v=>v+1)}>重新加载</Button>}/>}
      <fieldset disabled={locked} style={{border:0,padding:0,margin:0,minWidth:0}}>
        <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(220px,1fr))',gap:12}}>
          <label style={label}>客户<select aria-label="客户" style={field} value={draft.customerId??''} disabled={loading||!!optionsError} onChange={e=>void changeCustomer(Number(e.target.value)||null)}><option value="">散客（当场结清）</option>{customers.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
          <label style={label}>商品与规格<select aria-label="商品与规格" style={field} value="" disabled={loading||!!optionsError} onChange={e=>void add(Number(e.target.value))}><option value="">{loading?'加载中…':'选择并添加商品'}</option>{choices.map(c=><option key={c.id} value={c.id}>{c.name} · {c.unit}</option>)}</select></label>
        </div>
        <div style={{margin:'16px 0',display:'grid',gap:12}}>
          {draft.lines.map((line,i)=><div key={i} style={{padding:12,border:'1px solid #e8e8e8',borderRadius:8,display:'flex',gap:12,alignItems:'end',flexWrap:'wrap'}}>
            <div style={{flex:'1 1 160px'}}><b>{line.name}</b><div>{line.unit} · 小计 {fmtMoney(money(line.quantity*line.unitPrice))}</div></div>
            <label style={{...label,width:110}}>数量（{line.unit}）<input aria-label={`数量 ${i+1}`} style={field} type="number" min="0.001" step="0.001" required value={line.quantity} onChange={e=>edit({lines:draft.lines.map((l,j)=>i===j?{...l,quantity:e.target.value===''?0:Number(e.target.value)}:l)})}/></label>
            <label style={{...label,width:110}}>单价<input aria-label={`单价 ${i+1}`} style={field} type="number" min="0" step="0.01" required value={line.unitPrice} onChange={e=>edit({lines:draft.lines.map((l,j)=>i===j?{...l,unitPrice:Number(e.target.value)}:l)})}/></label>
            <Button htmlType="button" disabled={locked} danger onClick={()=>edit({lines:draft.lines.filter((_,j)=>i!==j)})}>移除</Button>
          </div>)}
        </div>
        <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(150px,1fr))',gap:12}}>
          <label style={label}>整单优惠<input aria-label="整单优惠" style={field} type="number" min="0" step="0.01" value={draft.discount} onChange={e=>edit({discount:Number(e.target.value)})}/></label>
          <label style={label}>实收<input aria-label="实收" style={field} type="number" min="0" step="0.01" placeholder={`默认 ${actual.toFixed(2)}`} value={draft.paid??''} onChange={e=>edit({paid:e.target.value===''?null:Number(e.target.value)})}/></label>
          <label style={label}>结算账户<select aria-label="结算账户" style={field} value={draft.account} onChange={e=>edit({account:e.target.value})}>{['现金','微信','支付宝','银行卡','挂账'].map(a=><option key={a}>{a}</option>)}</select></label>
        </div>
        <label style={{...label,marginTop:12}}>备注<textarea aria-label="备注" style={field} rows={2} value={draft.notes} onChange={e=>edit({notes:e.target.value})}/></label>
      </fieldset>
      <div style={{display:'flex',gap:16,flexWrap:'wrap',padding:'16px 0'}}>{[['原价',total],['优惠',draft.discount],['应收',actual],['已收',paid],['欠款',money(actual-paid)]].map(([name,value])=><span key={String(name)}>{name} <b>{fmtMoney(Number(value))}</b></span>)}</div>
      {priceBusy && <Typography.Paragraph>正在读取客户价格…</Typography.Paragraph>}
      <div style={{display:'flex',justifyContent:'flex-end',gap:8}}><Button onClick={onClose}>保存草稿并关闭</Button><Button type="primary" htmlType="submit" loading={busy} disabled={busy||priceBusy||(!draft.pending&&(loading||!!optionsError))}>{draft.pending?'重试原单':'确认开单'}</Button></div>
    </form>
  </Modal>
}
