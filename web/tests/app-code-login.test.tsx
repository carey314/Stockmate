import { act, fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, expect, test, vi } from 'vitest'
import AppCodeLogin from '../src/components/AppCodeLogin'
const { loginWithAppCode, logout } = vi.hoisted(() => ({ loginWithAppCode: vi.fn(), logout: vi.fn() }))
vi.mock('../src/auth', () => ({ useAuth: () => ({ loginWithAppCode, logout }) }))
vi.mock('antd', () => ({ Form: Object.assign(({ children, onFinish }: any) => <form onSubmit={e => { e.preventDefault(); onFinish() }}>{children}</form>, { Item: ({ children }: any) => <div>{children}</div> }), Input: { Password: ({ value, onChange, disabled, ...props }: any) => <input aria-label={props['aria-label']} value={value} onChange={onChange} disabled={disabled} /> }, Alert: ({ message, action }: any) => <div role="alert">{message}{action}</div>, Button: ({ children, onClick, disabled, htmlType }: any) => <button type={htmlType || 'button'} onClick={onClick} disabled={disabled}>{children}</button>, Typography: { Paragraph: ({ children }: any) => <p>{children}</p> } }))
beforeEach(() => { loginWithAppCode.mockReset(); logout.mockReset() })
function start(done = vi.fn()) { const view = render(<AppCodeLogin onComplete={done} />); fireEvent.change(screen.getByLabelText('App 登录码'), { target: { value: 'A'.repeat(32) } }); fireEvent.click(screen.getByText('验证登录码并登录')); return view }
test('丢响应重试保持原码和同一browserSecret，不落本地存储', async () => {
 loginWithAppCode.mockRejectedValueOnce(new Error('network')).mockResolvedValue(true); const done = vi.fn(); start(done); await act(async () => {});
 const first = loginWithAppCode.mock.calls[0][0]; expect(first.browserSecret).toMatch(/^[A-Za-z0-9_-]{43}$/); expect((screen.getByLabelText('App 登录码') as HTMLInputElement).value).toBe('');
 fireEvent.click(screen.getByText('重试本次登录')); await act(async () => {}); expect(loginWithAppCode.mock.calls[1][0]).toEqual(first); expect(done).toHaveBeenCalledOnce(); expect(sessionStorage.length).toBe(0);
})
test('离页失效检查阻止迟到登录', async () => {
 let valid!: () => boolean, resolve!: (value: boolean) => void; loginWithAppCode.mockImplementation((_body, check) => { valid = check; return new Promise(r => { resolve = r }) }); const done = vi.fn(); const view = start(done); view.unmount(); expect(valid()).toBe(false); await act(async () => resolve(false)); expect(done).not.toHaveBeenCalled();
})
test('跨账号拒绝不自动退出或回退旧Apple接口', async () => {
 loginWithAppCode.mockRejectedValue(Object.assign(new Error('拒绝'), { status: 403 })); start(); await act(async () => {}); expect(screen.getByRole('alert').textContent).toContain('正确店铺'); expect(logout).not.toHaveBeenCalled(); expect(loginWithAppCode).toHaveBeenCalledOnce();
})
