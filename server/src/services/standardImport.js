const { createHash } = require('node:crypto');
const { z } = require('zod');
const prisma = require('../config/prisma');
const { transaction } = require('../utils/transaction');
const { httpError, buildSpecText } = require('../utils/biz');
const MAX_BYTES = 2 * 1024 * 1024;
const scalar = z.union([z.string(), z.number(), z.boolean(), z.null()]);
const rowSchema = z.object({
  rowId: z.string().min(1).max(100), code: z.string(), name: z.string(), unit: z.string(), skuCode: z.string(),
  specText: z.string().default(''), price: scalar, costPrice: scalar.optional(), initQuantity: scalar,
  barcode: z.string().default(''), customFields: z.record(scalar).default({}), specValues: z.record(scalar).default({}),
}).strict();
const schema = z.object({batchId:z.string().min(8).max(120).regex(/^[a-zA-Z0-9_-]+$/),productTypeId:z.number().int().positive(),rows:z.array(rowSchema).min(1).max(1000),selectedRowIds:z.array(z.string()).min(1).max(1000).optional()}).strict();
const canonical = value => JSON.stringify(value, function (key, val) { return val && typeof val === 'object' && !Array.isArray(val) ? Object.fromEntries(Object.keys(val).sort().map(k=>[k,val[k]])) : val; });
const hash = value => createHash('sha256').update(canonical(value)).digest('hex');
const keyFor = (batchId, group) => `standard-import:${hash(batchId)}:${group === undefined ? 'batch' : hash(group)}`;
const blank = value => value === '' || value === null || value === undefined;
function parseInput(input) {
  if (Buffer.byteLength(JSON.stringify(input), 'utf8') > MAX_BYTES) throw httpError(413, '每批最多2MB，请拆分后导入');
  const data = schema.parse(input);
  if(new Set(data.rows.map(r=>r.rowId)).size!==data.rows.length) throw httpError(400,'行ID不能重复');
  if(data.selectedRowIds && (new Set(data.selectedRowIds).size!==data.selectedRowIds.length || data.selectedRowIds.some(id=>!data.rows.some(r=>r.rowId===id)))) throw httpError(400,'选择行无效');
  return data;
}
function numberValue(value, field, errors, {optional=false,nonnegative=false}={}) {
  if(optional && blank(value)) return null;
  const text = typeof value === 'string' ? value.trim() : value;
  const result = typeof text === 'number' ? text : typeof text === 'string' && /^-?(?:\d+(?:\.\d*)?|\.\d+)$/.test(text) ? Number(text) : NaN;
  if(!Number.isFinite(result) || Math.abs(result)>Number.MAX_SAFE_INTEGER || (nonnegative && result<0)) {errors.push({field,message:nonnegative?'须为有限的非负数字':'须为有效数字'});return null;}
  return result;
}
function fieldValues(values, definitions, scope, errors) {
  const out={};
  for(const key of Object.keys(values)) if(!definitions.some(f=>f.key===key)) errors.push({field:`${scope}.${key}`,message:'未识别字段，请使用所选品类的模板'});
  for(const f of definitions) {
    let value=values[f.key]; const field=`${scope}.${f.key}`;
    if(typeof value==='string')value=value.trim();
    if(blank(value)){if(f.required)errors.push({field,message:`${f.label}为必填`});continue;}
    if(f.type==='number')value=numberValue(value,field,errors);
    else if(f.type==='boolean') {if(value==='true')value=true;else if(value==='false')value=false;else if(typeof value!=='boolean')errors.push({field,message:`${f.label}请填写true或false`});}
    else if(typeof value!=='string') errors.push({field,message:`${f.label}须为文本`});
    else if(f.type==='select'){const opts=JSON.parse(f.options||'[]');if(opts.length&&!opts.includes(value))errors.push({field,message:`${f.label}须为：${opts.join('/')}`});}
    else if(f.type==='date' && (!/^\d{4}-\d{2}-\d{2}$/.test(value)||!Number.isFinite(Date.parse(value))||new Date(value).toISOString().slice(0,10)!==value))errors.push({field,message:`${f.label}须为有效日期YYYY-MM-DD`});
    out[f.key]=value;
  }
  return out;
}
async function validateRows(db, data, storeId, ignoredProductIds=[]) {
  const type=await db.productType.findFirst({where:{id:data.productTypeId,storeId,isDeleted:0}});
  if(!type)throw httpError(404,'品类不存在');
  const fields=await db.fieldDefinition.findMany({where:{productTypeId:type.id,storeId},orderBy:{sortOrder:'asc'}});
  const rows=data.rows.map(raw=>{
    const errors=[];const row={...raw};
    for(const field of ['code','name','unit','skuCode','specText','barcode'])row[field]=raw[field].trim();
    for(const field of ['code','name','unit','skuCode'])if(!row[field])errors.push({field,message:'必填，编码须手工填写'});
    row.price=numberValue(raw.price,'price',errors,{nonnegative:true});
    row.costPrice=numberValue(raw.costPrice,'costPrice',errors,{optional:true,nonnegative:true});
    // Match the existing product creation rule: opening inventory is nonnegative even where later sales may oversell.
    row.initQuantity=numberValue(raw.initQuantity,'initQuantity',errors,{nonnegative:true});
    row.customFields=fieldValues(raw.customFields,fields.filter(f=>f.scope==='product'),'product',errors);
    row.specValues=fieldValues(raw.specValues,fields.filter(f=>f.scope==='sku'),'sku',errors);
    return {...row,errors};
  });
  const codes=[...new Set(rows.flatMap(r=>[r.code,r.skuCode,r.barcode]).filter(Boolean))];
  const existing=new Set();
  // SQLite has a finite bind-parameter limit. Chunk lookup codes and filter our own completed rows in memory.
  const ignored=new Set(ignoredProductIds);
  for(let offset=0;offset<codes.length;offset+=200){
    const chunk=codes.slice(offset,offset+200);
    const [products,skus]=await Promise.all([
      db.product.findMany({where:{storeId,OR:[{code:{in:chunk}},{barcode:{in:chunk}}]},select:{id:true,code:true,barcode:true}}),
      db.sku.findMany({where:{storeId,OR:[{code:{in:chunk}},{barcode:{in:chunk}}]},select:{productId:true,code:true,barcode:true}}),
    ]);
    for(const item of [...products,...skus])if(!ignored.has(item.productId??item.id))for(const code of [item.code,item.barcode])if(code)existing.add(code);
  }
  const groups=new Map();
  const basics=new Map(),specs=new Map();
  for(const row of rows){
    if(!groups.has(row.code))groups.set(row.code,[]);
    groups.get(row.code).push(row);
    basics.set(row,canonical([row.name,row.unit,row.customFields]));
    specs.set(row,canonical(Object.keys(row.specValues).length?row.specValues:{description:row.specText}));
  }
  for(const row of rows) {
    for(const field of ['code','skuCode','barcode']) if(row[field] && existing.has(row[field]))row.errors.push({field,message:'编码或条码已存在，仅支持新增'});
    for(const field of ['skuCode','barcode']) if(row[field] && rows.some(other=>other!==row && (other.skuCode===row[field]||other.barcode===row[field]||(other.code===row[field]&&other.code!==row.code))))row.errors.push({field,message:'同批编码或条码重复'});
    if(rows.some(other=>other.code!==row.code&&(other.skuCode===row.code||other.barcode===row.code)))row.errors.push({field:'code',message:'商品编码与同批其他商品规格码/条码冲突'});
    const group=groups.get(row.code);
    if(group.some(other=>basics.get(other)!==basics.get(row)))row.errors.push({field:'code',message:'同商品编码的名称、单位、商品字段须一致'});
    if(group.some(other=>other!==row&&specs.get(other)===specs.get(row)))row.errors.push({field:'specText',message:'同商品规格重复'});
  }
  const badGroups=new Set(rows.filter(r=>r.errors.length).map(r=>r.code));
  for(const row of rows)if(!row.errors.length&&badGroups.has(row.code))row.errors.push({field:'code',message:'同商品其他规格有误，请整组修正后提交'});
  return {rows,fields};
}
function identity(actor) {if(actor.role!=='admin')throw httpError(403,'仅店主可导入商品');const storeId=prisma.getTenantId();if(!storeId||!actor.userId)throw httpError(401,'登录已失效');return storeId;}
function verifyRecord(record,actor,contentHash) {if(record&&(record.actorId!==actor.userId||record.contentHash!==contentHash))throw httpError(409,'批次已提交且内容或操作者不同，请保留原批次重试，修改内容须新建批次');}
async function validate(input,actor) {
  const storeId=identity(actor),data=parseInput(input);
  const {rows}=await validateRows(prisma,data,storeId);
  return {batchId:data.batchId,rows};
}
async function commit(input,actor) {
  const storeId=identity(actor),data=parseInput(input);
  if(!data.selectedRowIds?.length)throw httpError(400,'请明确选择要导入的有效行');
  const contentHash=hash(data),batchKey=keyFor(data.batchId);
  // Freeze the complete source and selection before the first product. A lost HTTP response is retried verbatim.
  await transaction(async tx=>{
    const record=await tx.entryConfirmation.findFirst({where:{storeId,requestKey:batchKey}});verifyRecord(record,actor,contentHash);
    if(!record)await tx.entryConfirmation.create({data:{storeId,requestKey:batchKey,actorId:actor.userId,contentHash,response:JSON.stringify({kind:'standard-import-batch',batchId:data.batchId})}});
  });
  const prior=await prisma.entryConfirmation.findMany({where:{storeId,actorId:actor.userId,requestKey:{startsWith:`standard-import:${hash(data.batchId)}:`}}});
  const ignored=prior.flatMap(record=>{const value=JSON.parse(record.response);return value.results?.filter(r=>r.status==='success').map(r=>r.productId)||[];});
  const initial=await validateRows(prisma,data,storeId,[...new Set(ignored)]);
  const selected=data.rows.filter(r=>data.selectedRowIds.includes(r.rowId));
  const groups=[...new Set(selected.map(r=>r.code.trim()))];const results=[];
  for(const code of groups) {
    const rawGroup=selected.filter(r=>r.code.trim()===code),requestKey=keyFor(data.batchId,code);
    let result;
    try { result=await transaction(async tx=>{
      const previous=await tx.entryConfirmation.findFirst({where:{storeId,requestKey}});verifyRecord(previous,actor,contentHash);
      if(previous){const saved=JSON.parse(previous.response);if(saved.results.every(r=>r.status==='success'))return saved.results;}
      // Recheck the selected product inside its write transaction; full-batch duplicate checks came from initial.
      const checked=await validateRows(tx,{...data,rows:rawGroup},storeId);
      const group=checked.rows.map(row=>({...row,errors:[...row.errors,...(initial.rows.find(r=>r.rowId===row.rowId)?.errors||[])]}));
      let rowsResult;
      if(group.some(r=>r.errors.length))rowsResult=group.map(r=>({rowId:r.rowId,code:r.code,name:r.name,status:'failed',errors:r.errors.length?r.errors:[{field:'code',message:'同商品其他规格有误，整组未导入'}]}));
      else {
        const first=group[0];
        // Template costs are per SKU. A product fallback would invent a cost for another blank-cost SKU.
        const product=await tx.product.create({data:{storeId,code,name:first.name,unit:first.unit,productTypeId:data.productTypeId,defaultPrice:first.price,costPrice:null,customFields:JSON.stringify(first.customFields)}});
        rowsResult=[];
        for(const [index,row] of group.entries()) {
          const sku=await tx.sku.create({data:{storeId,productId:product.id,code:row.skuCode,specText:row.specText||buildSpecText(row.specValues,checked.fields.filter(f=>f.scope==='sku')),specValues:JSON.stringify(row.specValues),price:row.price,costPrice:row.costPrice,barcode:row.barcode||null,isDefault:index===0?1:0}});
          await tx.inventory.create({data:{storeId,productId:product.id,skuId:sku.id,quantity:row.initQuantity}});
          if(row.initQuantity>0)await tx.inventoryRecord.create({data:{storeId,productId:product.id,skuId:sku.id,type:'inbound',quantity:row.initQuantity,beforeQuantity:0,afterQuantity:row.initQuantity,reason:'标准导入初始库存',operatorId:actor.userId}});
          rowsResult.push({rowId:row.rowId,code,name:row.name,status:'success',productId:product.id,skuId:sku.id});
        }
      }
      const response=JSON.stringify({results:rowsResult});
      if(previous)await tx.entryConfirmation.update({where:{id:previous.id},data:{response}});
      else await tx.entryConfirmation.create({data:{storeId,requestKey,actorId:actor.userId,contentHash,response}});
      return rowsResult;
    });
    } catch(error) {
      if(error.status===409)throw error;
      // The product transaction rolled back. Persist a per-row failure separately so later products can proceed.
      result=await transaction(async tx=>{
        const previous=await tx.entryConfirmation.findFirst({where:{storeId,requestKey}});verifyRecord(previous,actor,contentHash);
        if(previous){const saved=JSON.parse(previous.response);if(saved.results.every(r=>r.status==='success'))return saved.results;}
        const message=error.code==='P2002'?'编码已被占用，请更正后新建批次':error.status?error.message:'该商品未导入，事务已回滚，请重试原批次';
        const failed=rawGroup.map(row=>({rowId:row.rowId,code,name:row.name,status:'failed',errors:[{field:'code',message}]}));
        const response=JSON.stringify({results:failed});
        if(previous)await tx.entryConfirmation.update({where:{id:previous.id},data:{response}});
        else await tx.entryConfirmation.create({data:{storeId,requestKey,actorId:actor.userId,contentHash,response}});
        return failed;
      });
    }
    results.push(...result);
  }
  return {batchId:data.batchId,results};
}
module.exports={validate,commit};
