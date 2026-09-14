process.env.RATE_AUTH_MAX='1';
const {test}=require('node:test');const assert=require('node:assert/strict');const express=require('express');
test('trusted loopback proxy uses rightmost client; spoofed prefix cannot reset auth bucket',async t=>{
 const app=express();
 require('../src/config/proxy').configureProxy(app);
 const {authLimiter}=require('../src/middlewares/rateLimit');app.get('/',authLimiter,(req,res)=>res.json({ip:req.ip}));
 const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));t.after(()=>new Promise(r=>server.close(r)));
 const call=xff=>fetch(`http://127.0.0.1:${server.address().port}/`,{headers:{'X-Forwarded-For':xff}});
 const a=await call('198.51.100.10');assert.equal(a.status,200);assert.equal((await a.json()).ip,'198.51.100.10');
 const b=await call('198.51.100.11');assert.equal(b.status,200);assert.equal((await b.json()).ip,'198.51.100.11');
 assert.equal((await call('203.0.113.9, 198.51.100.10')).status,429);
 const trust=app.get('trust proxy fn');assert.equal(trust('198.51.100.10'),false);assert.equal(trust('127.0.0.1'),true);
});
