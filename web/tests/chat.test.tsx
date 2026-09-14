import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { expect, test, vi } from 'vitest'
import AiChatPanel from '../src/features/ai/AiChatPanel'
import api from '../src/api/client'
const auth = vi.hoisted(()=>({user:{id:1},profile:{storeId:1}}))
vi.mock('../src/auth',()=>({useAuth:()=>auth}))
vi.mock('../src/components/AiQuota',()=>({AiQuotaTag:()=>null,handleAiQuotaError:()=>false}))
test('新身份既不显示遗留聊天，也不把其内容发送到 history；旧回复不能回填',async()=>{
 localStorage.setItem('sm_token','A')
 sessionStorage.setItem('sm_ai_chat',JSON.stringify([{role:'assistant',content:'旧店秘密'}]))
 let resolve!:(v:any)=>void
 const post=vi.spyOn(api,'post').mockImplementationOnce(()=>new Promise(r=>{resolve=r})).mockResolvedValue({answer:'新店答案'})
 vi.spyOn(api,'get').mockResolvedValue({plan:'free'})
 const view=render(<AiChatPanel/> )
 expect(screen.queryByText('旧店秘密')).toBeNull()
 fireEvent.change(screen.getByPlaceholderText('问问你的生意…'),{target:{value:'旧店问题'}})
 fireEvent.keyDown(screen.getByPlaceholderText('问问你的生意…'),{key:'Enter'})
 await waitFor(()=>expect(post).toHaveBeenCalledTimes(1))
 auth.user={id:2};auth.profile={storeId:2};localStorage.setItem('sm_token','B')
 view.rerender(<AiChatPanel/> )
 expect(screen.queryByText('旧店问题')).toBeNull()
 fireEvent.change(screen.getByPlaceholderText('问问你的生意…'),{target:{value:'新店问题'}})
 fireEvent.keyDown(screen.getByPlaceholderText('问问你的生意…'),{key:'Enter'})
 await waitFor(()=>expect(post).toHaveBeenCalledTimes(2))
 expect(post.mock.calls[1][1]).toEqual({question:'新店问题',history:[]})
 await act(()=>resolve({answer:'迟到旧店秘密'}))
 expect(screen.queryByText('迟到旧店秘密')).toBeNull()
 expect(sessionStorage.getItem('sm_ai_chat')).toBeNull()
 expect(Object.values(sessionStorage).join()).not.toContain('迟到旧店秘密')
})
