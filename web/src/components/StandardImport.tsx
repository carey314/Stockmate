import { Alert, App, Button, Input, Select, Space, Table, Tag, Typography } from 'antd'
import { useEffect, useRef, useState } from 'react'
import api from '../api/client'
import { useAuth } from '../auth'
import { draftStorage } from '../lib/draftStorage'
import { createTemplate, MAX_BYTES, parseTable, rowsToCsv, type ImportPayload, type ImportResult, type ImportRow, type ImportType, type ValidatedRow } from '../lib/standardImport'
import { cardStyle } from '../theme'

interface Draft {
  text: string; typeId: number | null; batchId: string; rows: ImportRow[]; unknownColumns: string[]
  validated: ValidatedRow[] | null; selected: string[]; frozen: ImportPayload | null; results: ImportResult[] | null; uncertain: boolean
}
const fresh = (typeId: number | null = null): Draft => ({text:'',typeId,batchId:crypto.randomUUID(),rows:[],unknownColumns:[],validated:null,selected:[],frozen:null,results:null,uncertain:false})
const download = (text: string, filename: string) => { const url = URL.createObjectURL(new Blob([text], {type:'text/csv;charset=utf-8'})); const link = document.createElement('a'); link.href=url;link.download=filename;link.click();setTimeout(()=>URL.revokeObjectURL(url),1000) }

export default function StandardImport() {
  const { user, profile } = useAuth()
  if (!user || !profile?.storeId) return <Alert type="info" title="正在确认店铺信息…"/>
  return <StandardImportForm key={`${profile.storeId}:${user.id}`}/>
}

function StandardImportForm() {
  const { user, profile } = useAuth()
  const { message } = App.useApp()
  const [storage] = useState(() => draftStorage<Draft>('standard-import', user?.id, profile?.storeId))
  const [draft, setDraft] = useState<Draft>(() => storage.initial ?? fresh())
  const current = useRef(draft)
  const [types, setTypes] = useState<ImportType[]>([])
  const [busy, setBusy] = useState(false)
  const inFlight = useRef(false)
  const [error, setError] = useState<string | null>(storage.readError)
  const canAct = () => storage.current() && !!profile?.storeId && user?.role === 'admin'
  const save = (next: Draft) => {
    if (!canAct()) { setError('登录身份已变化或店铺尚未加载，请重新打开页面'); return false }
    const failure = storage.write(next)
    if (failure) { setError(failure); return false }
    current.current=next;setDraft(next);setError(null);return true
  }
  useEffect(() => {
    let active=true
    api.get<ImportType[]>('/product-types').then(items => {
      if (!active || !storage.current()) return
      setTypes(items)
      if (items.length===1 && !current.current.typeId) { const next={...current.current,typeId:items[0].id};current.current=next;setDraft(next) }
    }).catch(e=>{if(active&&storage.current())setError(e.message)})
    return ()=>{active=false}
  }, [storage])
  useEffect(()=>{
    if(!draft.text&&!draft.frozen)return
    const guard=(e:BeforeUnloadEvent)=>e.preventDefault()
    window.addEventListener('beforeunload',guard);return()=>window.removeEventListener('beforeunload',guard)
  },[draft.text,draft.frozen])
  const type=types.find(t=>t.id===draft.typeId),fields=type?.fields??[]
  const locked=!!draft.frozen||busy
  const editText=(text:string)=>{
    if(locked)return
    if(new TextEncoder().encode(text).length>MAX_BYTES){setError('每批最多2MB，请拆分后导入');return}
    save({...draft,text,rows:[],validated:null,selected:[],unknownColumns:[]})
  }
  const preview=()=>{
    if(!type)return setError('先选择商品品类')
    try{const parsed=parseTable(draft.text,fields);save({...draft,...parsed,validated:null,selected:[]})}catch(e){setError((e as Error).message)}
  }
  const validate=async()=>{
    if(!canAct()||inFlight.current||!draft.typeId||!draft.rows.length||draft.unknownColumns.length)return
    inFlight.current=true;setBusy(true);setError(null)
    try{
      const result=await api.post<{rows:ValidatedRow[]}>('/products/standard-import/validate',{batchId:draft.batchId,productTypeId:draft.typeId,rows:draft.rows})
      if(canAct())save({...current.current,validated:result.rows,selected:[]})
    }catch(e){if(canAct())setError((e as Error).message)}finally{inFlight.current=false;setBusy(false)}
  }
  const commit=async()=>{
    if(!canAct()||inFlight.current)return
    const state=current.current
    if(!state.frozen&&(!state.typeId||!state.validated||!state.selected.length))return
    const payload=state.frozen??{batchId:state.batchId,productTypeId:state.typeId!,rows:state.rows,selectedRowIds:state.selected}
    if (!state.frozen && new TextEncoder().encode(JSON.stringify(payload)).length > MAX_BYTES) {
      setError('提交数据超过2MB，请减少行数或文字内容后重新校验');return
    }
    // Persist the exact request before any network call. Storage failure must never create an unrecoverable batch.
    if(!save({...state,frozen:payload,uncertain:true}))return
    inFlight.current=true;setBusy(true)
    try{
      const result=await api.post<{results:ImportResult[]}>('/products/standard-import/commit',payload)
      if(canAct()&&save({...current.current,results:result.results,uncertain:false}))message.success(`已确认：${result.results.filter(r=>r.status==='success').length}行成功`)
    }catch(e){
      if(canAct()){
        // Only the very first attempt's explicit 413 proves this new request was never accepted.
        // A previously uncertain batch remains frozen even if a later retry is rejected by a changed proxy limit.
        if(!state.frozen && (e as {status?:number}).status===413)save({...current.current,batchId:crypto.randomUUID(),frozen:null,uncertain:false,validated:null,selected:[]})
        setError((e as Error).message)
      }
    }finally{inFlight.current=false;setBusy(false)}
  }
  const validIds=draft.validated?.filter(r=>!r.errors.length).map(r=>r.rowId)??[]
  const failures=draft.results ? draft.rows.filter(row=>draft.results!.some(r=>r.rowId===row.rowId&&r.status==='failed')) : draft.rows.filter(row=>draft.validated?.some(r=>r.rowId===row.rowId&&r.errors.length))
  const selectedRows=(row:ImportRow,checked:boolean)=>{
    const group=draft.rows.filter(r=>r.code.trim()===row.code.trim()&&validIds.includes(r.rowId)).map(r=>r.rowId)
    save({...draft,selected:checked?[...new Set([...draft.selected,...group])]:draft.selected.filter(id=>!group.includes(id))})
  }
  if(user?.role!=='admin')return <Alert type="warning" title="标准商品导入仅店主可使用"/>
  return <div style={{display:'flex',flexDirection:'column',gap:16,maxWidth:1180}}>
    <Alert type="info" showIcon title="标准表格导入 · 不需要AI" description="只新增商品。每行一个规格；相同商品编码归为同一商品，规格一起选择。编码须自行填写，成本留空即未知；期初数量须非负。每批最多1000规格、2MB。"/>
    {error&&<Alert type="error" showIcon title={error}/>}
    <div style={{...cardStyle,padding:24}}>
      <Space wrap style={{marginBottom:12}}>
        <Select aria-label="导入商品品类" placeholder="选择商品品类" value={draft.typeId} style={{minWidth:180}} disabled={locked} options={types.map(t=>({value:t.id,label:t.name}))} onChange={typeId=>save({...draft,typeId,rows:[],validated:null,selected:[],unknownColumns:[]})}/>
        <Button disabled={!type||busy} onClick={()=>download(createTemplate(fields),`商品导入模板-${type?.name}.csv`)}>下载所选品类模板</Button>
        <label style={{display:'inline-flex',alignItems:'center',gap:8}}>上传CSV / TSV<input aria-label="上传商品CSV或TSV" type="file" accept=".csv,.tsv,text/csv,text/tab-separated-values" disabled={locked} onChange={async e=>{
          const file=e.target.files?.[0];e.target.value='';if(!file)return
          if(file.size>MAX_BYTES){setError('文件超过2MB，请拆分后上传');return}
          try{const text=await file.text();if(canAct()&&!current.current.frozen)editText(text)}catch{setError('读取文件失败，请重新上传UTF-8 CSV或TSV')}
        }}/></label>
      </Space>
      {!!fields.length&&<Typography.Paragraph type="secondary">品类字段：{fields.map(f=>`${f.scope==='product'?'商品':'规格'}·${f.label}${f.required?'（必填）':''} [${f.type}${f.options?.length?`：${f.options.join('/')}`:''}]`).join('；')}。布尔值填true/false，日期填YYYY-MM-DD。</Typography.Paragraph>}
      <Input.TextArea aria-label="商品表格内容" placeholder="先下载模板填写，或粘贴带表头的Excel制表符文本。修改错误行后可重新解析、校验。" value={draft.text} disabled={locked} onChange={e=>editText(e.target.value)} autoSize={{minRows:7,maxRows:14}} style={{fontFamily:'monospace'}}/>
      <Space style={{marginTop:12}}><Button onClick={preview} disabled={locked||!type||!draft.text}>本地解析预览</Button>{!!draft.rows.length&&<Button onClick={validate} disabled={locked||!!draft.unknownColumns.length} loading={busy&&!draft.frozen}>服务器校验</Button>}</Space>
    </div>
    {!!draft.unknownColumns.length&&<Alert type="warning" showIcon title={`未识别列：${draft.unknownColumns.join('、')}`} description="这些列尚未映射。请根据所选品类模板修正表头并重新解析；不能带着未识别列提交。"/>}
    {!!draft.rows.length&&<div style={{...cardStyle,padding:24}}>
      <Space wrap style={{marginBottom:12}}>
        <Typography.Text strong>{draft.rows.length} 个规格行{draft.validated?`，${validIds.length} 行通过校验`:' · 尚未服务器校验'}</Typography.Text>
        {draft.validated&&!draft.frozen&&<Button disabled={busy||!validIds.length} onClick={()=>save({...draft,selected:validIds})}>选择全部有效行</Button>}
        {draft.validated&&!draft.frozen&&<Button type="primary" disabled={busy||!draft.selected.length} onClick={commit}>确认导入 {draft.selected.length} 行</Button>}
        {!!failures.length&&<Button onClick={()=>download(rowsToCsv(failures,fields),'导入失败行.csv')}>导出失败行</Button>}
      </Space>
      <Table<ImportRow> rowKey="rowId" dataSource={draft.rows} size="small" scroll={{x:1000}} pagination={{pageSize:20,showSizeChanger:false}} rowSelection={{selectedRowKeys:draft.selected,getCheckboxProps:r=>({disabled:locked||!validIds.includes(r.rowId)}),onSelect:selectedRows,onSelectAll:checked=>save({...draft,selected:checked?validIds:[]})}} columns={[
        {title:'行',dataIndex:'rowId',width:55},{title:'商品编码',dataIndex:'code'},{title:'名称',dataIndex:'name'}, {title:'单位',dataIndex:'unit',width:55}, {title:'规格编码',dataIndex:'skuCode'}, {title:'规格',dataIndex:'specText'}, {title:'售价',dataIndex:'price'}, {title:'成本',dataIndex:'costPrice',render:v=>v||'未知'}, {title:'期初数量',dataIndex:'initQuantity'}, {title:'条码',dataIndex:'barcode'},
        {title:'自定义字段',render:(_,r)=>Object.entries({...Object.fromEntries(Object.entries(r.customFields).map(([k,v])=>[`商品.${k}`,v])),...Object.fromEntries(Object.entries(r.specValues).map(([k,v])=>[`规格.${k}`,v]))}).map(([k,v])=>`${k}: ${v}`).join('；')},
        {title:'校验 / 结果',width:230,render:(_,r)=>{
          const result=draft.results?.find(x=>x.rowId===r.rowId)
          if(result?.status==='success')return <Tag color="success">已成功 · 商品#{result.productId} / 规格#{result.skuId}</Tag>
          const errors=result?.errors??draft.validated?.find(x=>x.rowId===r.rowId)?.errors
          return errors?.length?<span style={{color:'#b42318'}}>{errors.map(e=>`${e.field}：${e.message}`).join('；')}</span>:<Tag color={errors?'success':'default'}>{errors?'通过':'待校验'}</Tag>
        }},
      ]}/>
      {!draft.frozen&&<Typography.Paragraph type="secondary" style={{marginTop:12}}>有误时可在上方文本中修改，或导出失败行后修正并重新上传。提交前需再次校验和选择。</Typography.Paragraph>}
    </div>}
    {draft.frozen&&<Alert type={draft.uncertain?'warning':'success'} showIcon title={draft.uncertain?'结果尚未确认，请重试原批次':'批次处理完成'} description={draft.uncertain?'原始内容及选择已锁定并保存，刷新后可继续恢复。重复请求不会重复建立商品或初始库存。':`成功 ${draft.results?.filter(r=>r.status==='success').length??0} 行；失败 ${draft.results?.filter(r=>r.status==='failed').length??0} 行。成功行不会在重试时重复导入。`} action={<Space wrap>
      {(draft.uncertain||!!failures.length)&&<Button onClick={commit} loading={busy}>重试原批次</Button>}
      {!draft.uncertain&&!busy&&<Button onClick={()=>{
        const remaining=draft.rows.filter(r=>!draft.results?.some(x=>x.rowId===r.rowId&&x.status==='success'))
        save({...fresh(draft.typeId),text:remaining.length?rowsToCsv(remaining,fields):''})
      }}>{failures.length?'修正未成功行 · 新批次':'再导一批'}</Button>}
    </Space>}/>}
  </div>
}
