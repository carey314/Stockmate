import { act, fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, expect, test, vi } from 'vitest'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import LoginPage from '../src/pages/LoginPage'
const { loginWithCode, logout }=vi.hoisted(()=>({loginWithCode:vi.fn(),logout:vi.fn()}))
vi.mock('../src/auth',()=>({useAuth:()=>({login:vi.fn(),loginWithCode,logout})}))
vi.mock('../src/components/QrWebLogin',()=>({default:()=>null}))
vi.mock('../src/components/AppCodeLogin',()=>({default:()=>null}))
vi.mock('../src/components/UserCursor',()=>({default:()=>null}))
vi.mock('antd',()=>{
 const Box=({children}:any)=><div>{children}</div>
 const Form=Object.assign(({children,onFinish}:any)=><form onSubmit={e=>{e.preventDefault();onFinish({})}}>{children}</form>,{Item:Box})
 const Input=Object.assign(({value,onChange,placeholder,...props}:any)=><input value={value??''} onChange={onChange} placeholder={placeholder} aria-label={props['aria-label']}/>,{Password:({value,onChange,placeholder,...props}:any)=><input type="password" value={value??''} onChange={onChange} placeholder={placeholder} aria-label={props['aria-label']}/>})
 return {App:{useApp:()=>({message:{error:vi.fn()},modal:{info:vi.fn()}})},Form,Input,Button:({children,onClick,htmlType,disabled}:any)=><button type={htmlType??'button'} onClick={onClick} disabled={disabled}>{children}</button>,Typography:{Text:Box,Title:Box},Alert:({message,description,action}:any)=><div role="alert">{message}{description}{action}</div>}
})
beforeEach(()=>{loginWithCode.mockReset();logout.mockReset()})
const open=()=>{render(<MemoryRouter initialEntries={['/login']}><Routes><Route path="/login" element={<LoginPage/>}/><Route path="/" element={<div>已进入后台</div>}/></Routes></MemoryRouter>);fireEvent.click(screen.getByText('旧版 App Apple 登录码'))}
test('App码仅发送一次并立即清空，成功后进入后台不在URL或本机存储残留',async()=>{
 let resolve!:(v:boolean)=>void;loginWithCode.mockImplementation(()=>new Promise(r=>{resolve=r}));open();expect(screen.getByText(/请只使用自己.*不要转发/)).toBeTruthy()
 const code='A'.repeat(32);fireEvent.change(screen.getByLabelText('App 登录码'),{target:{value:code}});fireEvent.click(screen.getByText('验证登录码并登录'));fireEvent.click(screen.getByText('验证登录码并登录'))
 expect(loginWithCode).toHaveBeenCalledTimes(1);expect(loginWithCode).toHaveBeenCalledWith(code);expect((screen.getByLabelText('App 登录码') as HTMLInputElement).value).toBe('')
 await act(()=>resolve(true));expect(screen.getByText('已进入后台')).toBeTruthy();expect(window.location.href).not.toContain(code);expect(JSON.stringify({...localStorage,...sessionStorage})).not.toContain(code)
})
test.each([401,403])('App码%s提示重新发码且不残留旧码，不自动退出当前账号',async(status)=>{
 loginWithCode.mockRejectedValue(Object.assign(new Error('服务端错误'),{status}));open();fireEvent.change(screen.getByLabelText('App 登录码'),{target:{value:'A'.repeat(32)}});fireEvent.click(screen.getByText('验证登录码并登录'));await act(async()=>{})
 expect(screen.getByRole('alert').textContent).toContain(status===401?'已失效':'正确店铺');expect((screen.getByLabelText('App 登录码') as HTMLInputElement).value).toBe('');expect(logout).not.toHaveBeenCalled()
})
test('短码不发送；切回密码登录清空内存码；迟到失效登录不跳转',async()=>{
 open();fireEvent.change(screen.getByLabelText('App 登录码'),{target:{value:'short'}});fireEvent.click(screen.getByText('验证登录码并登录'));expect(loginWithCode).not.toHaveBeenCalled()
 fireEvent.click(screen.getByText('用密码登录'));fireEvent.click(screen.getByText('旧版 App Apple 登录码'));expect((screen.getByLabelText('App 登录码') as HTMLInputElement).value).toBe('')
 loginWithCode.mockResolvedValue(false);fireEvent.change(screen.getByLabelText('App 登录码'),{target:{value:'A'.repeat(32)}});fireEvent.click(screen.getByText('验证登录码并登录'));await act(async()=>{});expect(screen.queryByText('已进入后台')).toBeNull()
})
