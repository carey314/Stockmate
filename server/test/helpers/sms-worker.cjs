// Synthetic boundary only: no PNVS SDK calls or real recipient.
const { PrismaClient }=require('@prisma/client');const db=new PrismaClient();
const express=require('express');const {wrap}=require('../../src/utils/response');
const provider={enabled:()=>true,async send(){process.send({event:'send'});},async check(){process.send({event:'check'});await new Promise(r=>setTimeout(r,30));return false;}};
const ctl=require('../../src/controllers/sms').createController({db,provider});
const app=express();require('../../src/config/proxy').configureProxy(app);app.use(express.json());app.post('/send',wrap(ctl.send));app.post('/login',wrap(ctl.login));app.use(require('../../src/middlewares/errorHandler'));
const server=app.listen(0,'127.0.0.1',()=>process.send({event:'ready',port:server.address().port}));
process.on('message',async message=>{if(message==='stop'){await new Promise(r=>server.close(r));await db.$disconnect();process.exit(0);}});
