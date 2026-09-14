// Local-only W07 fault transport. No auth bypass, no business writes outside UI requests.
const http=require('node:http'),fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const target='http://127.0.0.1:60108';
const dir=path.resolve(__dirname,'../../docs/quality/2026-09-08-web/evidence-batch2');
const marker='W07_UI_20260908';let dropped=false;const events=[];
const server=http.createServer(async(req,res)=>{
 res.setHeader('Access-Control-Allow-Origin','*');res.setHeader('Access-Control-Allow-Headers','Authorization,Content-Type');res.setHeader('Access-Control-Allow-Methods','GET,POST,PUT,DELETE,OPTIONS');
 if(req.method==='OPTIONS'){res.writeHead(204);return res.end();}
 try{
  if(!req.url.startsWith('/api/v1/')){res.writeHead(404);return res.end();}
  const chunks=[];for await(const part of req)chunks.push(part);const body=Buffer.concat(chunks);let data;try{data=JSON.parse(body.toString())}catch{}
  const headers={};for(const key of ['authorization','content-type'])if(req.headers[key])headers[key]=req.headers[key];
  const upstream=await fetch(target+req.url,{method:req.method,headers,...(body.length?{body}:{}),signal:AbortSignal.timeout(35000)});
  const reply=await upstream.text();
  const match=req.method==='POST'&&req.url==='/api/v1/purchase-orders'&&String(data?.notes).startsWith(marker);
  if(match){
   const event={time:new Date().toISOString(),requestId:data.requestId,payload:data,payloadHash:crypto.createHash('sha256').update(body).digest('hex'),upstreamStatus:upstream.status,upstreamData:JSON.parse(reply).data};
   if(!dropped&&upstream.ok){dropped=true;event.transport='503 substituted only after upstream committed';events.push(event);fs.writeFileSync(path.join(dir,'w07-transport.json'),JSON.stringify(events,null,2));res.writeHead(503,{'Content-Type':'application/json'});return res.end(JSON.stringify({code:503,message:'W07本地联验：服务已处理但响应中断，请保留原单重试',data:null}));}
   event.transport='forwarded';events.push(event);fs.writeFileSync(path.join(dir,'w07-transport.json'),JSON.stringify(events,null,2));
  }
  res.writeHead(upstream.status,{'Content-Type':upstream.headers.get('content-type')||'application/json'});res.end(reply);
 }catch{res.writeHead(502,{'Content-Type':'application/json'});res.end(JSON.stringify({code:502,message:'本地联验传输失败',data:null}));}
});
server.listen(0,'127.0.0.1',()=>{const api=`http://127.0.0.1:${server.address().port}/api/v1`;fs.writeFileSync(path.join(dir,'w07-proxy-local.json'),JSON.stringify({api,pid:process.pid,upstream:target,marker}));console.log(JSON.stringify({api,pid:process.pid,marker}));});
