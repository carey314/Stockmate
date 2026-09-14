import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { App } from 'antd'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import SettingsPage from '../src/pages/SettingsPage'
import api from '../src/api/client'
const { auth } = vi.hoisted(()=>({auth:{user:{id:1,role:'admin'},profile:{shopName:'测试店',mainTypeId:null},refreshProfile:vi.fn(),logout:vi.fn()}}))
vi.mock('../src/auth',()=>({useAuth:()=>auth}))
afterEach(()=>vi.unstubAllGlobals())
beforeEach(()=>{
 vi.stubGlobal('ResizeObserver',class {observe(){} unobserve(){} disconnect(){}})
 auth.user.role='admin'
 const computed=window.getComputedStyle.bind(window);vi.spyOn(window,'getComputedStyle').mockImplementation(el=>computed(el))
 vi.spyOn(api,'get').mockImplementation(url=>Promise.resolve(url==='/system/users'?[{id:1,username:'owner',realName:'老板',role:'admin',status:1,createdAt:'2026-01-01'},{id:2,username:'staff',realName:'小张',role:'staff',status:1,createdAt:'2026-01-01'}]:[]) as any)
})
const mount=()=>render(<App><SettingsPage/></App>)
test('老板在Web查看员工和店铺；新增及重置账号转到App，无密码输入或提交入口',async()=>{
 const post=vi.spyOn(api,'post'),put=vi.spyOn(api,'put');const {container}=mount()
 await screen.findByText('小张')
 expect(screen.getByText(/我的 → 员工管理/)).toBeTruthy()
 expect(screen.getByText(/我的 → 账号与安全/)).toBeTruthy()
 expect(screen.queryByRole('button',{name:'新建员工账号'})).toBeNull()
 expect(screen.queryByRole('button',{name:/重置密码|修改密码/})).toBeNull()
 expect(container.querySelector('input[type="password"]')).toBeNull()
 expect(screen.getByText(/旧登录会话失效/)).toBeTruthy()
 expect(screen.queryByText(/当前登录不受影响/)).toBeNull()
 expect(post).not.toHaveBeenCalled();expect(put).not.toHaveBeenCalled()
})
test('员工看到自己的App账号指引，无员工管理；无密码用户不被要求提供原密码',()=>{
 auth.user.role='staff';const {container}=mount()
 expect(screen.queryByText('员工管理')).toBeNull()
 expect(screen.getByText(/请联系店主在 App/)).toBeTruthy()
 expect(screen.getByText(/Apple 或短信登录/)).toBeTruthy()
 expect(container.querySelector('input[type="password"]')).toBeNull()
})
test('保留店名保存与员工停用接口',async()=>{
 const put=vi.spyOn(api,'put').mockResolvedValue({});mount();await screen.findByText('小张')
 fireEvent.change(screen.getByDisplayValue('测试店'),{target:{value:'新店名'}})
 fireEvent.click(screen.getByRole('button',{name:/保\s*存/}));await waitFor(()=>expect(put).toHaveBeenCalledWith('/settings/shop-name',{shopName:'新店名'}))
 fireEvent.click(screen.getAllByRole('switch').find(button=>!button.hasAttribute('disabled'))!)
 fireEvent.click(await screen.findByRole('button',{name:/OK|确\s*定/}));await waitFor(()=>expect(put).toHaveBeenCalledWith('/system/users/2/toggle'))
 expect(put.mock.calls.some(([url])=>url.includes('password'))).toBe(false)
})
