# 通知系统设计（2026-08-03）

首页右上角铃铛现在是死的。设计目标：让小老板**不用翻报表就知道"有什么事需要我处理"**，而不是做一个塞满垃圾消息的收件箱。

## 设计原则

1. **通知 = 待办，不是日志。** 每条通知都要能回答"我现在该干什么"，点进去直达处理页。
2. **宁可少，不可吵。** 小老板一天看手机几次，红点必须值钱；能合并的合并（"3个商品缺货"是一条，不是三条）。
3. **分期落地，先零成本后基建。** 不为 P1 就建推送体系。

## 通知类型（按用户价值排序）

| 类型 | 触发 | 点击去向 | 分期 |
|---|---|---|---|
| 库存预警 | SKU ≤ 预警线（合并为一条："N 个商品该补货了"） | 商品页（低库存筛选） | P1 |
| 客户欠款 | 有未结清销售单（合并："M 家客户共欠 ¥X"） | 订单列表·欠款筛选 | P1 |
| 我欠供应商 | 进货单未付清（合并） | 进货单·欠供应商筛选 | P1 |
| 今日小结 | 当天有交易，晚间生成"销售/毛利/单数" | 报表中心 | P1(实时算) |
| 员工动态 | 员工开单/退货/盘点（仅老板可见） | 对应单据详情 | P2 |
| 盘点提醒 | 距上次盘点 > 30 天 | 盘点页 | P2 |
| AI 额度/系统 | 商业化后：额度将用尽、版本更新 | 设置/订阅页 | P3 |
| 推送(离线触达) | 上述事件的 APNs 推送 + 每日收摊提醒 | - | P3 |

## P1：本地聚合通知中心（推荐先做，~半天）

**零 schema 变更。** 通知中心打开时实时聚合现有接口：
- `/inventory/alerts` → 库存预警条
- `/orders`（unpaid>0）→ 欠款条
- `/purchase-orders`（unpaid>0）→ 应付条
- `/stats/overview` → 今日小结条（当天有单才显示）

**已读机制**：本地 shared_preferences 存每条通知的内容指纹（如 `low-stock:8个:2026-08-03`），内容变了自动重新变未读。不追求跨设备同步——P1 是自用工具，够用。

**红点**：首页铃铛 = 有任一未读聚合条时亮红点（不显示数字，避免焦虑）。

**UI**：铃铛 → 通知中心页，SoftCard 列表，每条 = 图标 + 标题 + 一句话 + 时间 + chevron，点击跳转对应页面；空态"没有需要处理的事，去忙生意吧 ☕"。

## P2：Notification 表（事件流）

```prisma
model Notification {
  id        Int      @id @default(autoincrement())
  userId    Int?     // null=广播给全店
  type      String   // low_stock | owed | staff_action | stocktake_due | system
  title     String
  body      String?
  route     String?  // App 内跳转路径，如 /orders/12
  readAt    DateTime?
  createdAt DateTime @default(now())
  @@index([userId, readAt])
}
```
- 写入点：订单/进货/盘点 controller 里事件后置钩子（员工操作时给 admin 写一条）
- 接口：GET /notifications?unread=1、PUT /notifications/:id/read、PUT /notifications/read-all
- 角标数字 = 未读 count；P1 的聚合条保留（动态状态类），表只存"事件"类

## P3：推送（上架后）

- APNs（需真机 + Push capability + 证书）：欠款超期、库存预警、每日日报
- 每日收摊提醒（20:00"今天记账了吗"）可以不走服务器：flutter_local_notifications 本地定时，P2 就能做
- 频控：同类型每天最多 1 推；夜间(22:00-8:00)不推

## 不做的

- 站内聊天/客服消息：不是这个产品的事
- 营销推送：违背"诚实工具"定位，除非用户主动订阅功能上新
