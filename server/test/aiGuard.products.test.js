// 环节2/3：商品生成 & 粘贴导入（sanitizeProducts）
// 最关键的一条业务铁律在这里落地：**生成环节 AI 绝不许编成本价**（allowCost=false 强制剥离 costPrice）。
// 假成本比没成本危害大得多——0 能一眼看穿，4.2 永远发现不了。
const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const { sanitizeProducts } = require('../src/utils/aiGuard');

const P = (over = {}) => ({ name: '飞天茅台', skus: [{ price: 1499 }], ...over });

describe('sanitizeProducts · 铁律：生成环节强制剥离 costPrice', () => {
  test('allowCost=false（AI 按品类生成）时，AI 硬塞的 costPrice 被剥掉', () => {
    const r = sanitizeProducts({ products: [P({ skus: [{ price: 1499, costPrice: 980 }] })] }, { allowCost: false });
    assert.equal(r.products[0].skus[0].price, 1499);
    assert.equal('costPrice' in r.products[0].skus[0], false, 'costPrice 必须被剥离，不许出现在结果里');
  });

  test('不传 allowCost 时默认就是剥离（默认值必须是安全的那一侧）', () => {
    const r = sanitizeProducts({ products: [P({ skus: [{ price: 1499, costPrice: 980 }] })] });
    assert.equal('costPrice' in r.products[0].skus[0], false);
  });

  test('allowCost=true（粘贴导入用户自己的真实数据）时保留 costPrice', () => {
    const r = sanitizeProducts({ products: [P({ skus: [{ price: 1499, costPrice: 980 }] })] }, { allowCost: true });
    assert.equal(r.products[0].skus[0].costPrice, 980);
  });

  test('allowCost=true 但成本为负数时不写入（负成本没有业务含义）', () => {
    const r = sanitizeProducts({ products: [P({ skus: [{ price: 10, costPrice: -5 }] })] }, { allowCost: true });
    assert.equal('costPrice' in r.products[0].skus[0], false);
  });
});

describe('sanitizeProducts · 价格合法性', () => {
  test('价格缺失/非数字/负数/超上限的规格被丢弃', () => {
    for (const price of [undefined, 'abc', -1, 1000001]) {
      const r = sanitizeProducts({ products: [P({ skus: [{ price }] })] });
      assert.equal(r.products.length, 0, `price=${price} 本应被丢弃`);
      assert.ok(r.dropped.some((d) => /价格非法/.test(d)));
    }
  });

  test('价格边界：0 和 1000000 合法', () => {
    for (const price of [0, 1000000]) {
      const r = sanitizeProducts({ products: [P({ skus: [{ price }] })] });
      assert.equal(r.products[0].skus[0].price, price);
    }
  });

  test('字符串价格按人民币写法转换："¥1,499" / "1499元" 都能转成数字', () => {
    for (const [raw, want] of [['¥1499', 1499], ['1499元', 1499], ['1,499', 1499], [' 12.5 ', 12.5], ['￥12', null]]) {
      const r = sanitizeProducts({ products: [P({ skus: [{ price: raw }] })] });
      if (want == null) {
        assert.equal(r.products.length, 0, `price=${raw} 本应被丢弃`);
      } else {
        assert.equal(r.products[0].skus[0].price, want, `price=${raw}`);
      }
    }
  });

  test('一个商品下部分规格价格非法时，只丢那个规格，其余保留', () => {
    const r = sanitizeProducts({ products: [P({ skus: [{ price: 100 }, { price: 'abc' }, { price: 200 }] })] });
    assert.equal(r.products[0].skus.length, 2);
    assert.deepEqual(r.products[0].skus.map((s) => s.price), [100, 200]);
    assert.equal(r.dropped.length, 1);
  });

  test('所有规格都非法时整条商品忽略（不留一个没有价格的空壳商品）', () => {
    const r = sanitizeProducts({ products: [P({ skus: [{ price: 'abc' }, { price: -1 }] })] });
    assert.equal(r.products.length, 0);
    assert.ok(r.dropped.some((d) => /没有一个合法规格/.test(d)));
  });

  test('商品完全没给 skus 时不会凭空造一个 0 元规格，而是整条丢弃', () => {
    const r = sanitizeProducts({ products: [{ name: '飞天茅台' }] });
    assert.equal(r.products.length, 0);
    assert.ok(r.dropped.some((d) => /没有一个合法规格/.test(d)));
  });
});

describe('sanitizeProducts · specValues 必须落在品类定义的范围内', () => {
  const specDefs = [
    { key: 'volume', options: ['500ml', '1L'] },
    { key: 'pack', options: ['盒装', '袋装'] },
  ];

  test('值在 options 内的规格维度保留', () => {
    const r = sanitizeProducts(
      { products: [P({ skus: [{ price: 100, specValues: { volume: '500ml' } }] })] },
      { specDefs }
    );
    assert.deepEqual(r.products[0].skus[0].specValues, { volume: '500ml' });
  });

  test('值不在 options 内 → 整个规格丢弃（AI 编的"330ml"不许进库）', () => {
    const r = sanitizeProducts(
      { products: [P({ skus: [{ price: 100, specValues: { volume: '330ml' } }] })] },
      { specDefs }
    );
    assert.equal(r.products.length, 0);
    assert.ok(r.dropped.some((d) => /规格值不在选项内：volume=330ml/.test(d)));
  });

  test('品类里没定义过的维度被静默忽略，但规格本身还留着', () => {
    const r = sanitizeProducts(
      { products: [P({ skus: [{ price: 100, specValues: { volume: '500ml', 编造维度: 'x' } }] })] },
      { specDefs }
    );
    assert.deepEqual(r.products[0].skus[0].specValues, { volume: '500ml' });
    assert.equal(r.dropped.length, 0);
  });

  test('没有 specDefs 时（无规格品类）所有 specValues 都被忽略', () => {
    const r = sanitizeProducts({ products: [P({ skus: [{ price: 100, specValues: { volume: '500ml' } }] })] });
    assert.deepEqual(r.products[0].skus[0].specValues, {});
  });

  test('specValues 值超长截断到 30 字', () => {
    const r = sanitizeProducts(
      { products: [P({ skus: [{ price: 100, specValues: { free: '长'.repeat(50) } }] })] },
      { specDefs: [{ key: 'free' }] }
    );
    assert.equal(r.products[0].skus[0].specValues.free.length, 30);
  });
});

describe('sanitizeProducts · 重名与数量上限', () => {
  test('同名商品只留第一条', () => {
    const r = sanitizeProducts({
      products: [P({ name: '飞天茅台', unit: '瓶' }), P({ name: '飞天茅台', unit: '箱' })],
    });
    assert.equal(r.products.length, 1);
    assert.equal(r.products[0].unit, '瓶');
    assert.ok(r.dropped.some((d) => /商品重复：飞天茅台/.test(d)));
  });

  test('名字前后空格视为同名（" 茅台 " 与 "茅台" 判重）', () => {
    const r = sanitizeProducts({ products: [P({ name: ' 茅台 ' }), P({ name: '茅台' })] });
    assert.equal(r.products.length, 1);
    assert.equal(r.products[0].name, '茅台');
  });

  test('被整条丢弃的商品不占用重名表——同名的后一条合法商品还能进来', () => {
    const r = sanitizeProducts({
      products: [{ name: '茅台', skus: [{ price: 'abc' }] }, { name: '茅台', skus: [{ price: 1499 }] }],
    });
    assert.equal(r.products.length, 1);
    assert.equal(r.products[0].skus[0].price, 1499);
  });

  test('名称缺失/非字符串的商品被丢弃', () => {
    for (const name of [undefined, '', '   ', 123, null]) {
      const r = sanitizeProducts({ products: [P({ name })] });
      assert.equal(r.products.length, 0, `name=${JSON.stringify(name)} 本应被丢弃`);
      assert.ok(r.dropped.some((d) => /缺名称/.test(d)));
    }
  });

  test('名称超长截断到 40 字', () => {
    const r = sanitizeProducts({ products: [P({ name: '名'.repeat(60) })] });
    assert.equal(r.products[0].name.length, 40);
  });

  test('默认最多 30 个商品；maxCount 可调', () => {
    const many = Array.from({ length: 35 }, (_, i) => P({ name: `商品${i}` }));
    assert.equal(sanitizeProducts({ products: many }).products.length, 30);
    assert.equal(sanitizeProducts({ products: many }, { maxCount: 5 }).products.length, 5);
  });
});

describe('sanitizeProducts · 其余字段兜底', () => {
  test('unit 缺失兜底成"件"，超长截断到 10 字', () => {
    assert.equal(sanitizeProducts({ products: [P({ unit: undefined })] }).products[0].unit, '件');
    assert.equal(sanitizeProducts({ products: [P({ unit: '  ' })] }).products[0].unit, '件');
    assert.equal(sanitizeProducts({ products: [P({ unit: '单'.repeat(20) })] }).products[0].unit.length, 10);
  });

  test('customFields 非对象时兜底成空对象', () => {
    for (const cf of [undefined, null, 'x', 42]) {
      assert.deepEqual(sanitizeProducts({ products: [P({ customFields: cf })] }).products[0].customFields, {});
    }
  });

  test('initQuantity 负数归零、非数字归零、字符串数字可转换', () => {
    const q = (initQuantity) =>
      sanitizeProducts({ products: [P({ skus: [{ price: 1, initQuantity }] })] }).products[0].skus[0].initQuantity;
    assert.equal(q(-5), 0);
    assert.equal(q('abc'), 0);
    assert.equal(q(undefined), 0);
    assert.equal(q('12'), 12);
    assert.equal(q(3.5), 3.5);
  });

  test('barcode 为空时不写入结果', () => {
    assert.equal('barcode' in sanitizeProducts({ products: [P()] }).products[0].skus[0], false);
    assert.equal(sanitizeProducts({ products: [P({ skus: [{ price: 1, barcode: ' 690123 ' }] })] })
      .products[0].skus[0].barcode, '690123');
  });

  test('AI 返回垃圾结构不抛异常，返回空结果', () => {
    for (const input of [null, undefined, 'oops', {}, { products: 'not-array' }]) {
      const r = sanitizeProducts(input);
      assert.deepEqual(r.products, []);
      assert.deepEqual(r.dropped, []);
    }
  });
});
