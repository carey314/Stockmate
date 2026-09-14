import { act, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, expect, test, vi } from 'vitest'
import api from '../src/api/client'
import { clearEntitlementCache } from '../src/hooks/useEntitlement'
import { AiQuotaTag } from '../src/components/AiQuota'
vi.mock('antd',()=>({Tag:({children}:any)=><span>{children}</span>,Tooltip:({title,children}:any)=><div>{title}{children}</div>}))
beforeEach(()=>{localStorage.setItem('sm_token','A');clearEntitlementCache()})
const entitlement=(plan='pro')=>({plan,source:'apple',expiresAt:null,aiUsedThisMonth:0,daysHitLimitThisMonth:0,today:{coreUsed:3,coreLimit:plan==='free'?5:null,otherUsed:4,otherLimit:plan==='free'?8:null,coreAntiAbuseLimit:17,otherAntiAbuseLimit:50,resetAt:'2026-09-09T00:00:00+08:00',timeZone:'Asia/Shanghai'}})
test('专业版逐bucket显示后端实际cap及重置时区，不硬编码100',async()=>{
 vi.spyOn(api,'get').mockResolvedValue(entitlement());render(<><AiQuotaTag bucket="core"/><AiQuotaTag bucket="other"/></>)
 await screen.findByText(/17.*天/);expect(screen.getByText(/50.*天/)).toBeTruthy();expect(screen.queryByText(/100/)).toBeNull();expect(screen.getAllByText(/Asia\/Shanghai/).length).toBeGreaterThan(0)
})
test('聚焦主动刷新，从手机开通后两个bucket一起更新并提示权益变化',async()=>{
 const get=vi.spyOn(api,'get').mockResolvedValue(entitlement('free'));render(<><AiQuotaTag bucket="core"/><AiQuotaTag bucket="other"/></>)
 await screen.findByText('今天还能用 2 次');get.mockResolvedValue(entitlement())
 await act(async()=>window.dispatchEvent(new Event('focus')))
 await waitFor(()=>expect(get).toHaveBeenCalledTimes(2));await screen.findAllByText(/权益已更新/)
 expect(screen.queryByText('今天还能用 2 次')).toBeNull();expect(screen.getAllByText(/专业版/).length).toBeGreaterThan(0)
})
test('旧权益响应没有防滥用字段时不编造cap',async()=>{
 const data=entitlement();delete (data.today as any).coreAntiAbuseLimit;vi.spyOn(api,'get').mockResolvedValue(data)
 render(<AiQuotaTag bucket="core"/>);await screen.findByText(/专业版/);expect(screen.queryByText(/100/)).toBeNull();expect(screen.queryByText(/17/)).toBeNull()
})
