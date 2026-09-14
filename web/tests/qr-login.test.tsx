import { act, fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, afterEach, expect, test, vi } from 'vitest'
import QrWebLogin from '../src/components/QrWebLogin'
const { get, post, loginWithQr } = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn(), loginWithQr: vi.fn() }))
vi.mock('../src/api/client', () => ({ default: { get, post }, API_BASE: 'isolated-api' }))
vi.mock('../src/auth', () => ({ useAuth: () => ({ loginWithQr }) }))
vi.mock('antd', () => ({ QRCode: ({ value }: any) => <div aria-label="登录二维码">{value}</div>, Spin: () => <div>加载中</div>, Alert: ({ message }: any) => <div role="alert">{message}</div>, Button: ({ children, onClick, disabled }: any) => <button disabled={disabled} onClick={onClick}>{children}</button>, Typography: { Paragraph: ({ children }: any) => <p>{children}</p> } }))
const challenge = () => ({ challengeId: 'id', browserSecret: 'B'.repeat(43), qrContent: 'stockmate://web-login?v=1&id=id&scan=secret', expiresAt: new Date(Date.now() + 120000).toISOString() })
beforeEach(() => { get.mockReset(); post.mockReset(); loginWithQr.mockReset(); get.mockResolvedValue({ enabled: true, version: 1, qrEnabled: true }); post.mockImplementation(async (url: string) => url.endsWith('challenges') ? challenge() : { state: 'pending' }) })
afterEach(() => vi.useRealTimers())
test('仅支持能力时建二维码；扫描不自动登录；批准后取票', async () => {
 vi.useFakeTimers(); const done = vi.fn(); render(<QrWebLogin onComplete={done} />); await act(async () => {});
 expect(screen.getByLabelText('登录二维码')).toBeTruthy(); expect(loginWithQr).not.toHaveBeenCalled();
 post.mockResolvedValue({ state: 'scanned' }); await act(() => vi.advanceTimersByTimeAsync(2100)); expect(screen.getByText('已扫描，请在 App 核对店铺并确认登录')).toBeTruthy(); expect(loginWithQr).not.toHaveBeenCalled();
 post.mockResolvedValue({ state: 'approved' }); loginWithQr.mockResolvedValue(true); await act(() => vi.advanceTimersByTimeAsync(2100)); expect(loginWithQr).toHaveBeenCalledTimes(1); expect(done).toHaveBeenCalledTimes(1); expect(sessionStorage.length).toBe(0);
})
test('不支持时不创建二维码；明确提示备用入口', async () => {
 get.mockResolvedValue({ enabled: false }); render(<QrWebLogin onComplete={vi.fn()} />); await act(async () => {}); expect(post).not.toHaveBeenCalled(); expect(screen.getByRole('alert').textContent).toContain('密码');
})
test('同标签刷新恢复票据，离开后迟到取票有效性检查为false', async () => {
 vi.useFakeTimers(); const first = render(<QrWebLogin onComplete={vi.fn()} />); await act(async () => {}); first.unmount(); const done = vi.fn(); const second = render(<QrWebLogin onComplete={done} />); await act(async () => {});
 expect(post.mock.calls.filter(([url]) => url.endsWith('challenges'))).toHaveLength(1);
 post.mockResolvedValue({ state: 'approved' }); let check!: () => boolean; let resolve!: (value: boolean) => void; loginWithQr.mockImplementation((_body, valid) => { check = valid; return new Promise(r => { resolve = r }) }); await act(() => vi.advanceTimersByTimeAsync(2100)); second.unmount(); expect(check()).toBe(false); await act(async () => resolve(false)); expect(done).not.toHaveBeenCalled();
})
test('取消清除票据，停止轮询且不自动重建', async () => {
 vi.useFakeTimers(); render(<QrWebLogin onComplete={vi.fn()} />); await act(async () => {}); fireEvent.click(screen.getByText('取消二维码')); await act(async () => {}); const count = post.mock.calls.length; await act(() => vi.advanceTimersByTimeAsync(8000)); expect(post).toHaveBeenCalledTimes(count); expect(sessionStorage.length).toBe(0);
})
test('取票丢响应后继续查询原授权，redeemed状态可恢复', async () => {
 vi.useFakeTimers(); const done=vi.fn(); render(<QrWebLogin onComplete={done}/>); await act(async()=>{});
 post.mockResolvedValue({state:'approved'});loginWithQr.mockRejectedValueOnce(new Error('network')).mockResolvedValueOnce(true);
 await act(()=>vi.advanceTimersByTimeAsync(2100));expect(done).not.toHaveBeenCalled();
 post.mockResolvedValue({state:'redeemed'});await act(()=>vi.advanceTimersByTimeAsync(2100));expect(done).toHaveBeenCalledOnce();expect(loginWithQr.mock.calls[0][0]).toEqual(loginWithQr.mock.calls[1][0]);
})
test('本地到期停止轮询不自动换新码',async()=>{
 vi.useFakeTimers();render(<QrWebLogin onComplete={vi.fn()}/>);await act(async()=>{});await act(()=>vi.advanceTimersByTimeAsync(121000));
 expect(screen.getByText('二维码已过期，请重新生成')).toBeTruthy();const count=post.mock.calls.length;await act(()=>vi.advanceTimersByTimeAsync(10000));expect(post).toHaveBeenCalledTimes(count);
 expect(post.mock.calls.filter(([url])=>url.endsWith('challenges'))).toHaveLength(1);
})
test('旧取消请求失败不能污染新二维码状态',async()=>{
 vi.useFakeTimers();render(<QrWebLogin onComplete={vi.fn()}/>);await act(async()=>{});let reject!:(e:Error)=>void;
 post.mockImplementation((url:string)=>url.endsWith('cancel')?new Promise((_r,j)=>{reject=j}):Promise.resolve(url.endsWith('challenges')?challenge():{state:'pending'}));
 fireEvent.click(screen.getByText('取消二维码'));fireEvent.click(screen.getByText('重新生成二维码'));await act(async()=>{});await act(async()=>reject(new Error('network')));
 expect(screen.queryByRole('alert')).toBeNull();expect(screen.getByText('取消二维码')).toBeTruthy();
})
