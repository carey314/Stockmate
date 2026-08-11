// 环节1：品类字段生成（sanitizeFields）
// 这层的职责是「AI 说什么不算数，过了清洗才算数」——非法字段必须被丢弃并记进 dropped，
// 绝不能带病进 UI 变成一个建不出来的品类。
const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const { sanitizeFields } = require('../src/utils/aiGuard');

// 造一条一定合法的字段，测试里只覆写要考察的那个属性
const okField = (over = {}) => ({ key: 'brand', label: '品牌', type: 'text', ...over });

describe('sanitizeFields · 品类字段生成清洗', () => {
  test('合法字段原样保留，并补齐 required/affectsStock 默认值', () => {
    const r = sanitizeFields({ fields: [okField()], specs: [] });
    assert.equal(r.dropped.length, 0);
    assert.deepEqual(r.fields, [
      { key: 'brand', label: '品牌', type: 'text', required: false, affectsStock: true },
    ]);
  });

  test('key 非法（中文/数字开头/带横线/下划线开头）一律丢弃', () => {
    const bad = ['容量', '2volume', 'vol-ume', '_volume', 'vol ume'];
    for (const key of bad) {
      const r = sanitizeFields({ fields: [okField({ key })] });
      assert.equal(r.fields.length, 0, `key=${key} 本应被丢弃`);
      assert.match(r.dropped[0], /key 非法|缺 key/);
    }
  });

  test('key 合法字符集：字母开头 + 字母数字下划线', () => {
    const good = ['brand', 'brand_name', 'Brand2', 'a'];
    for (const key of good) {
      const r = sanitizeFields({ fields: [okField({ key })] });
      assert.equal(r.fields.length, 1, `key=${key} 本应通过`);
    }
  });

  test('key 或 label 为非字符串（AI 给了数字/对象）当作缺失丢弃', () => {
    for (const f of [okField({ key: 123 }), okField({ label: null }), okField({ label: '   ' })]) {
      const r = sanitizeFields({ fields: [f] });
      assert.equal(r.fields.length, 0);
      assert.equal(r.dropped.length, 1);
    }
  });

  test('type 越界不丢弃而是降级成 text（字段本身还有用，只是类型不认）', () => {
    const r = sanitizeFields({ fields: [okField({ type: 'color' })] });
    assert.equal(r.fields.length, 1);
    assert.equal(r.fields[0].type, 'text');
    assert.equal(r.dropped.length, 0);
  });

  test('五种合法 type 都放行', () => {
    for (const type of ['text', 'number', 'select', 'date', 'boolean']) {
      const f = type === 'select' ? okField({ type, options: ['A', 'B'] }) : okField({ type });
      const r = sanitizeFields({ fields: [f] });
      assert.equal(r.fields[0].type, type);
    }
  });

  test('select 选项不足 2 个直接丢弃（只有一个选项的下拉框是废字段）', () => {
    for (const options of [undefined, [], ['盒装'], '盒装/袋装']) {
      const r = sanitizeFields({ fields: [okField({ type: 'select', options })] });
      assert.equal(r.fields.length, 0, `options=${JSON.stringify(options)} 本应被丢弃`);
      assert.match(r.dropped[0], /选项不足 2 个/);
    }
  });

  test('select 选项先去重去空再判数量：["A","A"] 去重后只剩 1 个，仍然丢弃', () => {
    const r = sanitizeFields({ fields: [okField({ type: 'select', options: ['A', 'A', '  ', ''] })] });
    assert.equal(r.fields.length, 0);
    assert.match(r.dropped[0], /选项不足 2 个/);
  });

  test('select 选项去重保序，单个选项截断到 20 字', () => {
    const long = '超'.repeat(30);
    const r = sanitizeFields({ fields: [okField({ type: 'select', options: [' 盒装 ', '盒装', '袋装', long] })] });
    assert.deepEqual(r.fields[0].options, ['盒装', '袋装', '超'.repeat(20)]);
  });

  test('key 重复只保留第一条，后面的记 dropped', () => {
    const r = sanitizeFields({
      fields: [okField({ key: 'brand', label: '品牌' }), okField({ key: 'brand', label: '牌子' })],
    });
    assert.equal(r.fields.length, 1);
    assert.equal(r.fields[0].label, '品牌');
    assert.match(r.dropped[0], /key 重复：brand/);
  });

  test('fields 与 specs 共用同一个 key 命名空间（同名 key 会在第二处被拦）', () => {
    const r = sanitizeFields({
      fields: [okField({ key: 'volume', label: '容量' })],
      specs: [okField({ key: 'volume', label: '容量' })],
    });
    assert.equal(r.fields.length, 1);
    assert.equal(r.specs.length, 0);
    assert.match(r.dropped[0], /规格字段 key 重复：volume/);
  });

  test('商品字段上限 6 个，超出的记 dropped 而不是静默截断', () => {
    const many = Array.from({ length: 8 }, (_, i) => okField({ key: `f${i}`, label: `字段${i}` }));
    const r = sanitizeFields({ fields: many });
    assert.equal(r.fields.length, 6);
    assert.equal(r.dropped.length, 2);
    assert.match(r.dropped[0], /商品「字段6」超出数量上限/);
  });

  test('规格字段上限 3 个', () => {
    const many = Array.from({ length: 5 }, (_, i) => okField({ key: `s${i}`, label: `规格${i}` }));
    const r = sanitizeFields({ specs: many });
    assert.equal(r.specs.length, 3);
    assert.equal(r.dropped.length, 2);
    assert.match(r.dropped[0], /规格「规格3」超出数量上限/);
  });

  test('非法字段不占用数量配额（先判上限再校验，无效条目不挤掉有效条目）', () => {
    const r = sanitizeFields({
      // 头两条非法，后面 6 条合法 —— 6 条都应留下
      fields: [
        okField({ key: '中文key' }),
        okField({ type: 'select', options: ['只有一个'] }),
        ...Array.from({ length: 6 }, (_, i) => okField({ key: `f${i}`, label: `字段${i}` })),
      ],
    });
    assert.equal(r.fields.length, 6);
    assert.equal(r.dropped.length, 2);
    assert.ok(!r.dropped.some((d) => /超出数量上限/.test(d)));
  });

  test('required 只有严格 true 才算必填（字符串 "true" 不算）', () => {
    assert.equal(sanitizeFields({ fields: [okField({ required: true })] }).fields[0].required, true);
    for (const v of ['true', 1, 'yes', undefined]) {
      assert.equal(sanitizeFields({ fields: [okField({ required: v })] }).fields[0].required, false);
    }
  });

  test('affectsStock 只有严格 false 才不产生库存规格（默认 true）', () => {
    assert.equal(sanitizeFields({ fields: [okField({ affectsStock: false })] }).fields[0].affectsStock, false);
    for (const v of ['false', 0, undefined, null]) {
      assert.equal(sanitizeFields({ fields: [okField({ affectsStock: v })] }).fields[0].affectsStock, true);
    }
  });

  test('unit 为空时不写进结果（避免落一个空串单位）', () => {
    assert.equal('unit' in sanitizeFields({ fields: [okField()] }).fields[0], false);
    assert.equal('unit' in sanitizeFields({ fields: [okField({ unit: '  ' })] }).fields[0], false);
    assert.equal(sanitizeFields({ fields: [okField({ unit: ' ml ' })] }).fields[0].unit, 'ml');
  });

  test('key/label 超长按各自上限截断（key 40 / label 20）', () => {
    const r = sanitizeFields({ fields: [okField({ key: `a${'b'.repeat(60)}`, label: '标'.repeat(30) })] });
    assert.equal(r.fields[0].key.length, 40);
    assert.equal(r.fields[0].label.length, 20);
  });

  test('AI 返回垃圾结构（null / 字符串 / 缺字段）不抛异常，返回空结果', () => {
    for (const input of [null, undefined, 'oops', 42, {}, { fields: 'not-array', specs: null }]) {
      const r = sanitizeFields(input);
      assert.deepEqual(r.fields, []);
      assert.deepEqual(r.specs, []);
      assert.deepEqual(r.dropped, []);
    }
  });
});
