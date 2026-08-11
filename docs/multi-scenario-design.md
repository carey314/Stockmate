# 多场景进销存 · 产品设计（2026-08）

> 由 office-hours 产出并锁定 | 决策：把现有酒水进销存改造成「可配置多场景」通用进销存
> 定位不变：自用优先、简洁、腾讯云部署；差异点：AI 原生 + 用户可自定义品类

---

## 一、产品灵魂（一句话）

**不是"一个支持很多行业的进销存"，而是"一个你 30 秒就能配成自己行业、AI 帮你配的进销存"。**
- **深的是通用引擎**：进/销/存/扫码/预警/开单/订单——和品类无关，做一次所有品类共享。
- **活的是字段**：不同品类的区别只在"一个商品用哪几个字段描述"。
- **配的是 AI**：AI 的头号作用 = 把"给我的品类定义字段"从用户负担变成一键生成。

**关键洞见**：进销存业务逻辑与品类无关（猫粮出库=白酒出库），所以不需要"照顾每个品类"，只需照顾"字段"这一薄层，而字段恰好最适合交给用户 + AI 秒配。覆盖是按需生成、无限的，不是提前堆料。

## 二、类型系统三件套（用户视角）

1. **预设模板**：内置几套常用品类（酒水[迁移自现有]、玩具、餐饮/食材、服装、母婴…），开箱即用 + 当范例。
2. **AI 按主题生成**：用户输入主题（如"奶茶店物料"）→ DeepSeek 生成一套建议字段 → 落成新品类。
3. **用户增删改**：任何品类的字段用户都能加/删/改/排序。最终用户说了算。

## 三、数据模型（核心改动，其余表不动）

**新增 `ProductType`（品类）**
- id, name（酒水/玩具/餐饮）, icon?, description?, isPreset（是否预设）, sortOrder, isDeleted, createdAt, updatedAt
- 1 : N → FieldDefinition；1 : N → Product

**新增 `FieldDefinition`（字段定义，驱动表单 + 展示）**
- id, productTypeId(FK), key（机器名，如 `alcohol_degree`）, label（显示名，如"度数"）
- type（text | number | select | date | boolean）, options（Json，供 select 用）, unit?（如 %vol、ml）
- required（是否必填）, isCore（是否核心字段）, sortOrder
- @@unique([productTypeId, key])

**改造 `Product`**
- 保留通用核心：id, code(唯一,用于二维码), name, unit, defaultPrice, costPrice, barcode, imageUrl, status, isDeleted, timestamps
- 移除酒水专属：~~brand, category, specification~~
- 新增：`productTypeId`(FK → ProductType), `customFields`(Json，装该品类的字段值)
- @@index([productTypeId])

**保持不动**（进销存逻辑品类无关）：`Inventory`, `InventoryRecord`, `Customer`, `PricingRule`, `Order`, `OrderItem`, `User`

**存储选型：核心列固定 + 品类特有字段存 JSON**（MySQL 原生 JSON，Prisma `Json` 类型）。理由：自用 + 简洁 + 好扩展；EAV 属杀鸡用牛刀。弱点（按自定义字段做复杂统计稍麻烦）对自用场景可接受。

## 四、AI 集成（DeepSeek）

1. **按主题生成字段**（P0，最先做）：`POST /ai/generate-fields { theme }` → DeepSeek → 返回 FieldDefinition[] 草案（label/type/unit/options/required）→ 前端可编辑 → 保存为新品类。
2. **快速录入**（P1）：拍照/一句话 → AI 提取字段值填进录入表单。
3. **经营总结报告**（P1）：AI 读库存/销售数据 → 生成自然语言总结。

## 五、前端改动

- **左上角汉堡 → 侧边栏（品类/模板管理）**：列出所有品类、新建品类（手动 / AI 生成）、进入某品类管字段。
- **商品录入/编辑表单动态化**：根据所选品类的 FieldDefinition 动态渲染字段（这是最大前端改动）。
- **商品列表**：列可按当前品类的字段动态显示 + 筛选。
- 其余（库存/扫码/开单/订单）基本不动，仅"商品"相关处适配动态字段。

## 六、迁移方案（现有数据一条不丢）

1. 建预设品类"酒水"，为其建 FieldDefinition：brand→"品牌"、specification→"规格"、category→"子类"等。
2. 遍历现有 products：设 productTypeId=酒水，把 brand/category/specification 值写进 customFields。
3. 删除 products 表旧列（迁移完成后）。
4. 用 Prisma migration 分步执行，先加新列不删旧列，迁移数据，验证无误再删旧列。

## 七、开发顺序建议

- **P0（先跑通闭环）**：ProductType + FieldDefinition 表 + 迁移 → 侧边栏品类管理 → 商品动态表单 → AI 生成字段。跑通"新建品类→录商品→出入库→开单"全链路。
- **P1**：AI 快速录入、AI 经营总结、预设更多模板。
- **P2**：参考图（用户后续提供）对齐 UI；按参考图细化。

## 八、待用户提供 / 开放问题

- **参考图**：用户说后续给，UI 细节以参考图为准。
- 品类删除时若已有商品，如何处理（禁止删 / 软删 / 迁移商品到其他品类）？建议：有商品则禁止硬删，只能停用。
- AI 生成字段用 DeepSeek API key + 成本：自用低频，忽略不计。

---

## 交付诚实说明

✅ 已完成：产品定位、类型系统设计、数据模型、AI 集成点、前端改动范围、迁移方案、开发顺序，全部锁定并落盘。
⚠️ 未定/依赖：① 参考图未到，UI 细节待对齐；② 品类删除策略需一句话确认；③ 本设计为纸面设计，尚未写代码、未验证迁移脚本。下一步进入实现（建议先 `/plan-eng-review` 锁架构，或直接开 P0）。
