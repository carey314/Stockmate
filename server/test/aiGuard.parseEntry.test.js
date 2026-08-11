// 环节5：口述记账（sanitizeParseEntry）
// 老板对着手机说一句话就要生成单据，这层是"话"和"账"之间唯一的过滤器。
// 数量/金额一律 coerce 成合法数字，转不了的条目整条丢弃并写进 dropped 让老板看见。
const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const { sanitizeParseEntry } = require('../src/utils/aiGuard');

describe('sanitizeParseEntry · 数量清洗', () => {
  const qtyOf = (quantity) => sanitizeParseEntry({ purchases: [{ name: '面粉', quantity }] }).purchases[0]?.quantity;

  test('字符串数量能转成数字（AI 偶尔把数字包成字符串）', () => {
    assert.equal(qtyOf('10'), 10);
    assert.equal(qtyOf(' 2.5 '), 2.5);
  });

  test('数量支持小数（散称半斤 0.5、1.5kg 都是真实场景）', () => {
    assert.equal(qtyOf(0.5), 0.5);
    assert.equal(qtyOf(1.5), 1.5);
  });

  test('数量最多保留 3 位小数，避免浮点垃圾进流水', () => {
    assert.equal(qtyOf(1.23456), 1.235);
    assert.equal(qtyOf(0.1 + 0.2), 0.3);
  });

  test('数量为 0 / 负数 / NaN / 不可解析文本 → 整条丢弃', () => {
    for (const q of [0, -1, NaN, 'abc', '一箱', undefined, {}]) {
      const r = sanitizeParseEntry({ purchases: [{ name: '面粉', quantity: q }] });
      assert.equal(r.purchases.length, 0, `quantity=${JSON.stringify(q)} 本应被丢弃`);
      assert.ok(r.dropped.some((d) => /进货条目不完整已忽略/.test(d)));
    }
  });

  test('数量上限 100000：等于上限保留，超过丢弃（防 AI 把"一批"写成天文数字）', () => {
    assert.equal(qtyOf(100000), 100000);
    assert.equal(sanitizeParseEntry({ purchases: [{ name: '面粉', quantity: 100001 }] }).purchases.length, 0);
  });

  test('商品名缺失 → 整条丢弃（没名字的账记不了）', () => {
    for (const name of [undefined, '', '  ', 123]) {
      assert.equal(sanitizeParseEntry({ sales: [{ name, quantity: 5 }] }).sales.length, 0);
    }
  });
});

describe('sanitizeParseEntry · 金额清洗', () => {
  const amountOf = (amount) => sanitizeParseEntry({ expenses: [{ category: '水电', amount }] }).expenses[0]?.amount;

  test('人民币写法的字符串金额能转换："¥12.5" / "12元" / "1,200"', () => {
    assert.equal(amountOf('¥12.5'), 12.5);
    assert.equal(amountOf('12元'), 12);
    assert.equal(amountOf('1,200'), 1200);
    assert.equal(amountOf('¥1,200元'), 1200);
  });

  test('金额保留 2 位小数，浮点误差被抹平（0.1+0.2 落成 0.3 而不是 0.30000000000000004）', () => {
    assert.equal(amountOf(0.1 + 0.2), 0.3);
    // 下面三条是 Math.round(x*100)/100 这套取整的固有下限，不是本项目的 bug，
    // 但它决定了"分"这一位可能比数学期望少 1 分——固化在这里，将来换 Decimal 时会立刻发现差异。
    assert.equal(amountOf(1.005), 1); // 1.005*100 = 100.49999999999999 → 100 → 1.00
    assert.equal(amountOf(1.015), 1.01); // 1.015*100 = 101.49999999999999 → 101
    assert.equal(amountOf(8.165), 8.16); // 8.165*100 = 816.4999999999999 → 816
    assert.equal(amountOf(1.345), 1.35); // 对照：这个恰好是精确的 134.5，进位正常
  });

  test('金额 NaN / 不可解析 → 开销条目丢弃', () => {
    for (const a of [NaN, 'abc', undefined, '不知道']) {
      const r = sanitizeParseEntry({ expenses: [{ category: '水电', amount: a }] });
      assert.equal(r.expenses.length, 0);
      assert.ok(r.dropped.some((d) => /开销金额非法已忽略/.test(d)));
    }
  });

  test('开销/汇总金额必须为正：0 和负数都丢弃', () => {
    for (const a of [0, -5]) {
      assert.equal(sanitizeParseEntry({ expenses: [{ category: '水电', amount: a }] }).expenses.length, 0);
      assert.equal(sanitizeParseEntry({ aggregates: [{ label: '营业额', amount: a }] }).aggregates.length, 0);
    }
  });

  test('金额上限 1000 万：等于上限保留，超过丢弃', () => {
    assert.equal(amountOf(10000000), 10000000);
    assert.equal(sanitizeParseEntry({ expenses: [{ category: '水电', amount: 10000001 }] }).expenses.length, 0);
  });
});

describe('sanitizeParseEntry · 开销类目收敛到枚举', () => {
  const catOf = (category) => sanitizeParseEntry({ expenses: [{ category, amount: 100 }] }).expenses[0].category;

  test('六个合法类目原样保留', () => {
    for (const c of ['摊位费', '燃气', '运输', '水电', '人工', '其他']) assert.equal(catOf(c), c);
  });

  test('枚举外的类目一律收敛成"其他"（不让 AI 自创类目污染报表分组）', () => {
    for (const c of ['饭钱', '房租', 'other', '', undefined, null, 123]) assert.equal(catOf(c), '其他');
  });

  test('note 超长截断到 60 字，空 note 落 null', () => {
    assert.equal(sanitizeParseEntry({ expenses: [{ category: '水电', amount: 1, note: '备'.repeat(80) }] })
      .expenses[0].note.length, 60);
    assert.equal(sanitizeParseEntry({ expenses: [{ category: '水电', amount: 1, note: '  ' }] })
      .expenses[0].note, null);
  });

  test('开销条目只保留 category/amount/note 三个字段（不透传 AI 多给的键）', () => {
    const e = sanitizeParseEntry({ expenses: [{ category: '水电', amount: 1, 乱塞: 'x' }] }).expenses[0];
    assert.deepEqual(Object.keys(e).sort(), ['amount', 'category', 'note']);
  });
});

describe('sanitizeParseEntry · 收款状态与 ID 防幻觉', () => {
  const paidOf = (paid) => sanitizeParseEntry({ sales: [{ name: '货', quantity: 1, paid }] }).sales[0].paid;

  test('paid 为真布尔时保留（true=现款收讫 / false=挂账）', () => {
    assert.equal(paidOf(true), true);
    assert.equal(paidOf(false), false);
  });

  test('paid 非布尔一律置 null＝"没提"，绝不猜', () => {
    // 置 null 很重要：下游对记名客户的"没提"默认挂账。
    // 若把 "true" 字符串当成真，一笔本该挂账的钱会被记成已收，月底对账查不出来。
    for (const p of ['true', 'false', 1, 0, 'yes', undefined, null, {}]) {
      assert.equal(paidOf(p), null, `paid=${JSON.stringify(p)}`);
    }
  });

  test('matchedProductId / customerId / suggestedTypeId 非整数一律置 null（防 AI 幻觉 ID）', () => {
    const s = sanitizeParseEntry({
      sales: [{ name: '货', quantity: 1, matchedProductId: '12', customerId: 3.5 }],
      purchases: [{ name: '货', quantity: 1, matchedProductId: null, suggestedTypeId: 'abc' }],
    });
    assert.equal(s.sales[0].matchedProductId, null);
    assert.equal(s.sales[0].customerId, null);
    assert.equal(s.purchases[0].suggestedTypeId, null);
  });

  test('整数 ID 原样保留', () => {
    const s = sanitizeParseEntry({ sales: [{ name: '货', quantity: 1, matchedProductId: 12, customerId: 3 }] });
    assert.equal(s.sales[0].matchedProductId, 12);
    assert.equal(s.sales[0].customerId, 3);
  });
});

describe('sanitizeParseEntry · 结构与兜底', () => {
  test('单位缺失兜底成"件"，超长截断 10 字', () => {
    const r = sanitizeParseEntry({ purchases: [{ name: '货', quantity: 1 }, { name: '货2', quantity: 1, unit: '单'.repeat(20) }] });
    assert.equal(r.purchases[0].unit, '件');
    assert.equal(r.purchases[1].unit.length, 10);
  });

  test('warnings 过滤非字符串并截断 120 字', () => {
    const r = sanitizeParseEntry({ warnings: ['听不清是进还是出', null, 123, '长'.repeat(200)] });
    assert.deepEqual(r.warnings.map((w) => w.length), [8, 120]);
  });

  test('deliveryNote / supplierName 空值落 null 并各自截断', () => {
    assert.equal(sanitizeParseEntry({}).deliveryNote, null);
    assert.equal(sanitizeParseEntry({}).supplierName, null);
    assert.equal(sanitizeParseEntry({ deliveryNote: '备'.repeat(200) }).deliveryNote.length, 120);
    assert.equal(sanitizeParseEntry({ supplierName: '供'.repeat(80) }).supplierName.length, 40);
  });

  test('顶层结构是垃圾（null / 字符串 / 非数组字段）时返回全空结构，不抛异常', () => {
    for (const input of [null, undefined, 'oops', 42, {}, { purchases: 'x', sales: null }]) {
      const r = sanitizeParseEntry(input);
      assert.deepEqual(r.purchases, []);
      assert.deepEqual(r.sales, []);
      assert.deepEqual(r.expenses, []);
      assert.deepEqual(r.aggregates, []);
      assert.deepEqual(r.warnings, []);
    }
  });

  test('aggregates 的 label 缺失兜底成"营业额"', () => {
    assert.equal(sanitizeParseEntry({ aggregates: [{ amount: 1280 }] }).aggregates[0].label, '营业额');
    assert.equal(sanitizeParseEntry({ aggregates: [{ label: '今日营业额', amount: 1280 }] })
      .aggregates[0].label, '今日营业额');
  });

  test('多条混合输入：合法的进、非法的出，dropped 一一对应', () => {
    const r = sanitizeParseEntry({
      purchases: [{ name: '面粉', quantity: 10, unitCost: '¥3.5' }, { name: '', quantity: 5 }],
      sales: [{ name: '馄饨', quantity: 20, totalAmount: '240元' }, { name: '油条', quantity: 'abc' }],
      expenses: [{ category: '摊位费', amount: 30 }, { category: '燃气', amount: 'x' }],
    });
    assert.equal(r.purchases.length, 1);
    assert.equal(r.sales.length, 1);
    assert.equal(r.expenses.length, 1);
    assert.equal(r.dropped.length, 3);
    assert.equal(r.purchases[0].unitCost, 3.5);
    assert.equal(r.sales[0].totalAmount, 240);
  });
});

describe('sanitizeParseEntry · "没填"必须保持"没填"，绝不能变成 0', () => {
  // 提示词明令"缺失填 null"，AI 照做时 num(null) === Number(null) === 0，
  // 于是"没说进价"被清洗成"进价 0"。confirmEntry 的 `if (item.unitCost != null)`
  // 会把这个 0 写进 sku.costPrice，静默抹掉商品原有成本 → 毛利虚高。
  // 这里固化当前行为，修复后本用例应当失败并被改成期望 null。
  test('totalCost/unitCost 显式为 null 时保持 null（AI 按提示词填 null 就是"不知道"）', () => {
    const r = sanitizeParseEntry({ purchases: [{ name: '面粉', quantity: 10, totalCost: null, unitCost: null }] });
    assert.equal(r.purchases[0].totalCost, null);
    assert.equal(r.purchases[0].unitCost, null);
  });

  test('空串/只有货币符号 也算没填，不是 0', () => {
    const r = sanitizeParseEntry({ purchases: [{ name: '面粉', quantity: 10, totalCost: '', unitCost: '元' }] });
    assert.equal(r.purchases[0].totalCost, null);
    assert.equal(r.purchases[0].unitCost, null);
  });

  test('totalAmount/unitPrice 显式为 null 时保持 null', () => {
    const r = sanitizeParseEntry({ sales: [{ name: '馄饨', quantity: 2, totalAmount: null, unitPrice: null }] });
    assert.equal(r.sales[0].totalAmount, null);
    assert.equal(r.sales[0].unitPrice, null);
  });

  test('对照组：键整个缺失（undefined）时才正确落成 null', () => {
    const r = sanitizeParseEntry({ purchases: [{ name: '面粉', quantity: 10 }] });
    assert.equal(r.purchases[0].totalCost, null);
    assert.equal(r.purchases[0].unitCost, null);
  });

  test('AI 多塞的键一律不透传（白名单只放行流程用得到的字段）', () => {
    const s = sanitizeParseEntry({ sales: [{ name: '货', quantity: 1, costPrice: 9, 任意键: 'x' }] }).sales[0];
    assert.equal(s.costPrice, undefined, 'AI 不该能往卖出条目里塞成本价');
    assert.equal(s.任意键, undefined);
    assert.equal(s.name, '货', '白名单内的字段照常保留');
    assert.equal(s.quantity, 1);
  });
});
