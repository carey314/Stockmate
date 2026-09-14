import { beforeEach, expect, test, vi } from 'vitest'
import { draftStorage } from '../src/lib/draftStorage'
beforeEach(()=>localStorage.setItem('sm_token','A'))
test('旧标签页不能覆盖另一标签页已保存的未知确认',()=>{
 const first=draftStorage<any>('quick-entry',1,10), stale=draftStorage<any>('quick-entry',1,10)
 const pending={pending:{requestId:'original-id',sales:[{amount:70}]}}
 expect(first.write(pending)).toBeNull()
 expect(stale.write({pending:null,text:'新的草稿'})).toContain('其他页面')
 expect(draftStorage<any>('quick-entry',1,10).initial).toEqual(pending)
})
test('损坏的草稿禁止覆盖，存储读取失败也不能写空草稿',()=>{
 localStorage.setItem('sm_draft:10:1:quick-entry','{broken')
 const corrupt=draftStorage<any>('quick-entry',1,10);expect(corrupt.readError).toBeTruthy();expect(corrupt.write({text:''})).toBeTruthy()
 expect(localStorage.getItem('sm_draft:10:1:quick-entry')).toBe('{broken')
 const get=Storage.prototype.getItem;vi.spyOn(Storage.prototype,'getItem').mockImplementation(function(this:Storage,key:string){if(key.startsWith('sm_draft:'))throw new Error('blocked');return get.call(this,key)})
 const unreadable=draftStorage<any>('quick-entry',1,10);expect(unreadable.write({text:''})).toBeTruthy()
})
