// 预设品类模板（唯一事实源）：seed 播给默认店；注册建新店时也播一份（30秒配成自己行业的底座）
const PRESET_TYPES = [
  {
    name: '酒水',
    icon: 'wine',
    description: '白酒/红酒/啤酒/洋酒等酒水饮品',
    fields: [
      { key: 'brand', label: '品牌', type: 'text', required: 1, sortOrder: 0 },
      { key: 'sub_category', label: '子类', type: 'select', options: ['白酒', '红酒', '啤酒', '洋酒', '黄酒', '其他'], required: 0, sortOrder: 1 },
      { key: 'spec_ml', label: '规格', type: 'number', unit: 'ml', required: 0, sortOrder: 2 },
      { key: 'alcohol_degree', label: '酒精度', type: 'number', unit: '%vol', required: 0, sortOrder: 3 },
      { key: 'vintage', label: '年份', type: 'text', required: 0, sortOrder: 4 },
      { key: 'origin', label: '产地', type: 'text', required: 0, sortOrder: 5 },
    ],
  },
  {
    name: '玩具',
    icon: 'toy',
    description: '儿童玩具/潮玩/桌游等',
    fields: [
      { key: 'brand', label: '品牌', type: 'text', required: 0, sortOrder: 0 },
      { key: 'age_range', label: '适用年龄', type: 'select', options: ['0-3岁', '3-6岁', '6-12岁', '12岁以上', '成人'], required: 1, sortOrder: 1 },
      { key: 'material', label: '材质', type: 'text', required: 0, sortOrder: 2 },
      { key: 'battery_required', label: '需要电池', type: 'boolean', required: 0, sortOrder: 3 },
      { key: 'safety_cert', label: '安全认证', type: 'text', required: 0, sortOrder: 4 },
    ],
  },
  {
    name: '餐饮食材',
    icon: 'food',
    description: '餐馆/小吃店的食材物料（如馄饨店）',
    fields: [
      { key: 'storage', label: '储存方式', type: 'select', options: ['常温', '冷藏', '冷冻'], required: 1, sortOrder: 0 },
      { key: 'shelf_life_days', label: '保质期', type: 'number', unit: '天', required: 1, sortOrder: 1 },
      { key: 'flavor', label: '口味/品种', type: 'text', required: 0, sortOrder: 2 },
      { key: 'supplier_name', label: '供货商', type: 'text', required: 0, sortOrder: 3 },
      { key: 'production_date', label: '生产日期', type: 'date', required: 0, sortOrder: 4 },
    ],
  },
];

// 给某个 prisma 客户端（种子=raw 客户端 / 注册=租户上下文中的扩展客户端）播预设品类。
// storeId 显式传入：嵌套 create 的 FieldDefinition 不走扩展层注入，必须手动带。
async function seedPresetTypes(client, storeId) {
  for (const [i, t] of PRESET_TYPES.entries()) {
    const exists = await client.productType.findFirst({ where: { name: t.name, isPreset: 1, storeId } });
    if (exists) continue;
    await client.productType.create({
      data: {
        storeId,
        name: t.name,
        icon: t.icon,
        description: t.description,
        isPreset: 1,
        sortOrder: i,
        fields: {
          create: t.fields.map((f) => ({
            storeId, // 嵌套 create 必须显式带 storeId（扩展层只注入顶层）
            key: f.key,
            label: f.label,
            type: f.type,
            options: f.options ? JSON.stringify(f.options) : null,
            unit: f.unit ?? null,
            required: f.required,
            sortOrder: f.sortOrder,
          })),
        },
      },
    });
  }
}

module.exports = { PRESET_TYPES, seedPresetTypes };
