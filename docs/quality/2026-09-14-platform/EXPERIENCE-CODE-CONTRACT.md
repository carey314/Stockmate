# 平台体验码契约 v1

状态：server/Web implemented；local HTTP、跨进程SQLite、真实浏览器闭环 verified；未上线，App原生兑换入口/赠送展示尚待App窗口接入，本轮App未改。Carey授权“不限时免费体验”。基于现有店铺Entitlement，plan=pro/source=promotion/expiresAt=null。只赠送店铺权益，不修改Apple交易或自动续费，不改账号role。

## 用户兑换

POST /api/v1/me/experience-code，商家Bearer JWT，请求 `{code:"ZC-XXXX-XXXX-XXXX-XXXX"}`。仅当前有效店主可领，员工403但分享同店Pro。大小写、分隔横线/空格可归一。必须在确认当前店铺后主动提交，App或Web不能代新用户创建账号/店铺。

200 data `{replayed:boolean,grant:{id:number,state:"active",storeId:number,expiresAt:null},entitlement:{plan:"pro"|"free",source:string|null,expiresAt:ISO|null}}`。前端成功后重新GET /me/entitlement，以有效状态刷新功能与Pro额度。返回grant是此次赠送，entitlement为当前有效权益，二者不能拿来证明Apple购买。

400格式/不存在；401账号或会话失效；403员工不允许领；409已绑定另一店；410码停用/领取到期/体验收回；429限流。网络不确定时重试同一码，不能跨账号继承待兑代码。同店重复恢复原权益，领取截止只限制首次领取；已领体验不自动到期。

source=promotion建议展示“平台赠送 · 不限期”，附“体验权益可由平台收回；已有Apple订阅仍独立，请在Apple订阅管理中自行管理自动续费”。App负责增加可见赠送标签/兑换入口（若使用App原生输入），本窗口只改server/web；即使App尚无新入口，也可登录配套Web的/experience-code领取，App随后从现有权益接口读取生效。

## 平台管理

平台JWT独立iss=stockmate-platform/aud=platform，商家admin无权访问；所有/platform接口no-store。

- POST /platform/promo-batches `{requestId:UUID,label:string,count:1..100,redeemExpiresAt:null|ISO}` → `{batch:{id,label,count,createdAt,redeemExpiresAt},codes:[{id,code,hint}],replayed}`。有效同requestId/内容恢复相同码，改payload409；生成/恢复均审计。码仅本次结果展示或主动下载，不写URL/日志/localStorage。
- GET /platform/promo-codes?page=1&pageSize=20&state=&batchId= → `{list,total,page,pageSize}`。list只含id/batchId/batchLabel/codeHint/state/storeId/userId/entitlementId/redeemedAt/revokedAt/createdAt/redeemExpiresAt，不含完整码/哈希/密文。state为unused/redeemed/disabled/revoked/expired，max pageSize50。
- POST /platform/promo-codes/:id/disable `{reason:2..240字}` 停用未领码；已领409引导收回权益。
- POST /platform/promo-codes/:id/revoke `{reason:2..240字}` 收回已领体验。仅将此码对应promotion权益置canceled；Apple或其他赠送不变，当前有效权益重新计算。同动作重试幂等，不支持复活旧码。
- GET /platform/audit?page&pageSize → `{list,total,page,pageSize}`，最小审计信息；完整码、商家手机号/密码/经营正文不入审计。

私有发放材料用AES-256-GCM加密、batchId作AAD；`PROMO_CODE_ENCRYPTION_KEY`须独立32bytes标准base64，与`PLATFORM_JWT_SECRET`分开保管。换密钥前须制定旧批次解密迁移方案，不能直接丢旧key导致原批次恢复失败。平台登录缺secret503，发码缺key503，不默认生产弱口令或密钥。
