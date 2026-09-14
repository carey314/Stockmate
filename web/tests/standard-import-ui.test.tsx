import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, expect, test, vi } from 'vitest'
import { App } from 'antd'
import api from '../src/api/client'
import StandardImport from '../src/components/StandardImport'
const { auth }=vi.hoisted(()=>({auth:{user:{id:1,role:'admin'},profile:{id:1,storeId:10}}}))
vi.mock('../src/auth',()=>({useAuth:()=>auth}))
const csv='商品编码,名称,单位,规格编码,售价,成本,期初数量\nP1,苹果,斤,P1,12,,1.5'
beforeEach(()=>{const computed=window.getComputedStyle.bind(window);vi.spyOn(window,'getComputedStyle').mockImplementation(element=>computed(element));vi.stubGlobal('ResizeObserver',class { observe(){} unobserve(){} disconnect(){} });auth.user.id=1;auth.user.role='admin';auth.profile.storeId=10;localStorage.setItem('sm_token','A')})
const mount=()=>render(<App><StandardImport/></App>)
async function prepare(){
 vi.spyOn(api,'get').mockResolvedValue([{id:1,name:'水果',fields:[]}])
 const post=vi.spyOn(api,'post').mockImplementation(async(url,body:any)=>{
   if(url.endsWith('/validate'))return {batchId:body.batchId,rows:body.rows.map((r:any)=>({...r,price:12,costPrice:null,initQuantity:1.5,errors:[]}))}
   throw new Error('网络断开')
 })
 mount();await screen.findByText('水果');
 fireEvent.change(screen.getByLabelText('商品表格内容'),{target:{value:csv}})
 fireEvent.click(screen.getByText('本地解析预览'));await screen.findByText('服务器校验')
 fireEvent.click(screen.getByText('服务器校验'));await screen.findByText('选择全部有效行')
 fireEvent.click(screen.getByText('选择全部有效行'))
 return post
}
test('标准导入无AI请求；丢响应冻结完整请求，刷新后同批重试',async()=>{
 const post=await prepare();fireEvent.click(screen.getByText('确认导入 1 行'))
 await screen.findByText(/结果尚未确认/);const payload=post.mock.calls[1][1]
 expect(post.mock.calls.map(c=>c[0])).toEqual(['/products/standard-import/validate','/products/standard-import/commit'])
 expect((screen.getByLabelText('商品表格内容') as HTMLTextAreaElement).disabled).toBe(true)
 cleanup();mount();fireEvent.click(await screen.findByText('重试原批次'))
 await waitFor(()=>expect(post).toHaveBeenCalledTimes(3));expect(post.mock.calls[2][1]).toEqual(payload)
})
test('换号/换店不能恢复旧草稿，保存失败不能发送提交',async()=>{
 const post=await prepare();const save=vi.spyOn(Storage.prototype,'setItem').mockImplementation(()=>{throw new Error('quota')})
 fireEvent.click(screen.getByText('确认导入 1 行'));await act(async()=>{});expect(post).toHaveBeenCalledTimes(1)
 save.mockRestore();cleanup();auth.user.id=2;mount();expect((screen.getByLabelText('商品表格内容') as HTMLTextAreaElement).value).toBe('')
 cleanup();auth.user.id=1;auth.profile.storeId=20;mount();expect((screen.getByLabelText('商品表格内容') as HTMLTextAreaElement).value).toBe('')
})
test('校验错误行不可选择，未知列明确提示并阻止服务端提交',async()=>{
 vi.spyOn(api,'get').mockResolvedValue([{id:1,name:'水果',fields:[]}]);const post=vi.spyOn(api,'post');mount();await screen.findByText('水果')
 fireEvent.change(screen.getByLabelText('商品表格内容'),{target:{value:csv.replace('期初数量','期初数量,未知列').replace('1.5','1.5,不丢')}})
 fireEvent.click(screen.getByText('本地解析预览'));await screen.findByText(/未识别列：未知列/)
 fireEvent.click(screen.getByText('服务器校验'));expect(post).not.toHaveBeenCalled()
})
test('服务器错误行不能选入提交，显示具体字段原因',async()=>{
 vi.spyOn(api,'get').mockResolvedValue([{id:1,name:'水果',fields:[]}]);const post=vi.spyOn(api,'post').mockImplementation(async(_url,body:any)=>({rows:body.rows.map((r:any)=>({...r,errors:[{field:'price',message:'须为有效数字'}]}))}))
 mount();await screen.findByText('水果');fireEvent.change(screen.getByLabelText('商品表格内容'),{target:{value:csv.replace('12','12元')}})
 fireEvent.click(screen.getByText('本地解析预览'));fireEvent.click(await screen.findByText('服务器校验'))
 await screen.findByText('price：须为有效数字');fireEvent.click(screen.getByText('选择全部有效行'));fireEvent.click(screen.getByText('确认导入 0 行'))
 expect(post).toHaveBeenCalledTimes(1)
})
test('旧页面换token后不能提交旧店内容',async()=>{
 const post=await prepare();localStorage.setItem('sm_token','B');fireEvent.click(screen.getByText('确认导入 1 行'));await act(async()=>{});expect(post).toHaveBeenCalledTimes(1)
})
test('首次提交413明确未受理时解锁可拆分，重新校验生成新批次',async()=>{
 const post=await prepare();post.mockRejectedValueOnce(Object.assign(new Error('请求超过2MB，请拆分'),{status:413}))
 fireEvent.click(screen.getByText('确认导入 1 行'));await screen.findByText('请求超过2MB，请拆分')
 expect((screen.getByLabelText('商品表格内容') as HTMLTextAreaElement).disabled).toBe(false)
 expect(screen.queryByText('重试原批次')).toBeNull()
 const first=post.mock.calls[1][1] as any
 fireEvent.click(screen.getByText('服务器校验'));await waitFor(()=>expect(post).toHaveBeenCalledTimes(3));expect((post.mock.calls[2][1] as any).batchId).not.toBe(first.batchId)
})
test('丢响应后重试才收到413，仍保留原批次锁定避免重复建立',async()=>{
 const post=await prepare();fireEvent.click(screen.getByText('确认导入 1 行'));await screen.findByText(/结果尚未确认/)
 const first=post.mock.calls[1][1];post.mockRejectedValueOnce(Object.assign(new Error('上游限制413'),{status:413}))
 fireEvent.click(screen.getByText('重试原批次'));await screen.findByText('上游限制413')
 expect((screen.getByLabelText('商品表格内容') as HTMLTextAreaElement).disabled).toBe(true)
 expect(post.mock.calls[2][1]).toEqual(first);expect(screen.getByText('重试原批次')).toBeTruthy()
})
