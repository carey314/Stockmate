# 平台运营 API v1

状态：implemented / local HTTP、SQLite与浏览器 verified，未上线。平台身份与商家User完全分开，无线上平台注册。生产账号开通流程见DEPLOYMENT。

所有平台接口前缀`/api/v1/platform`，Cache-Control:no-store；独立JWT仅用于平台。登录`POST /auth/login {username,password}`返回`data:{token,admin:{id,username,displayName}}`；`GET /auth/profile`返回`data:{admin}`。JWT有效2小时，逐请求检查status/sessionVersion；离线重置使旧会话失效。普通商家admin JWT被拒绝，平台JWT无法访问商家业务API。平台secret缺失/弱/复用商家secret为503。

- GET `/overview?from=&to=`：`{range,registrations,registrationSources,bindings,entitlements,ai,telemetry,notes}`。
- GET `/users?page=1&pageSize=20&query=`：`{list,pagination:{page,pageSize,total,totalPages}}`。query支持用户名/姓名、纯数字用户ID或店铺ID。列表为隐私白名单，含当前绑定布尔值、注册来源、所属店铺，不含手机号/邮箱/Apple身份凭证/密码。
- GET `/users/:id?from=&to=`：`{user,range,counts,countsScope,ai,entitlements,purchaseStage}`。经营数量为店铺数量，AI次数为该用户；不展示经营正文。
- GET `/ai-requests?page=&pageSize=&userId=&storeId=&from=&to=`：`{list,range,pagination,summary}`。明细包括逻辑requestId/attempt/userId/storeId/endpoint/model/status/durationMs、各token、估价/价格快照/安全错误码，不采集提示词、用户原文或模型回复。
- 体验码生成/监管/兑换见EXPERIENCE-CODE-CONTRACT。

pageSize最大50；AI时段默认近30天，最大366天，from含、to不含，日期支持YYYY-MM-DD或UTC ISO（Web按本地自然日起止转换UTC）。当前留存用户/店铺累计数量、当前绑定及权益不随AI日期筛选变化，不得当作所选期新注册数。历史硬删除账号不能从现存User重建总注册。

## 指标含义

registrationSources.password/apple/sms/staff/unknown来自同注册事务PlatformEvent事件。当前Apple与已验证手机号绑定可重叠，不反推原始来源；历史缺事件显示unknown。新注册关闭/并发/重试沿用原认证契约，不为统计另建用户/店。

AI逻辑请求与供应商每次尝试分开；成功是provider JSON解析成功，不等于已确认记账。失败、解析失败、重试均有明细；未调用provider不产生虚假token。usage缺项保留null，summary同时返回已知/未知覆盖数；token已知部分的合计不是完整历史总消耗。AI_MODEL_PRICING只取维护人员明确核验价格；缓存拆分/价格不足则成本未知，不能当零成本。telemetry的writeFailures/missingContext为本进程启动后计数，应结合日志监测采集缺口；采集故障不阻断AI业务。

currentProStores为当前有效Pro（任意来源）。currentVerifiedProductionProStores仅当前有效已验证Production Apple权益；verifiedProductionStores为历史已知Production购买店铺数。Sandbox/manual/promotion/环境未知分列，来源可重叠。已验证通知中初订/续期交易幂等观测，退款通知不增购买；退款不抹除已知历史购买。历史链只保留最新交易的部分无法补齐，交易数为已知下界。Apple实收/净收入为null，不以目录价推算。

purchaseStage按店铺已知购买时间与注册/首张店铺销售单/首次已知AI时间比较；显示daysFromRegistration、phase、aiPhase，historyComplete=false。提交收据的用户不是已证实付款人，attribution=store。entry为unknown；App付费页曝光/发起购买埋点尚未实现，不能据此计算完整转化漏斗、DAU或留存。若后续接入，客户端事件只能证明入口行为，不能授予权益或证明付款。

## App交接

本轮不改app。已登录App继续从GET `/me/entitlement`读取`plan=pro,source=promotion,expiresAt=null`；分享同店权益，不改员工角色。App原生兑换入口/赠送展示另接体验码合同：建议“平台赠送 · 不限期”，说明可收回与Apple自动续费独立。现Web可先兑换，同店App刷新后使用既有权益逻辑。没有声称App新版入口/真实Apple/真实短信已验证。
