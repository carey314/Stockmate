// src/utils/biz.js 的纯函数部分。
// 时区必须在任何 Date 之前钉死——这正是 src/app.js 开头做的事，
// 测试进程复刻同一套前提，否则换台 UTC 机器跑测试结论就变了。
process.env.TZ = 'Asia/Shanghai';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const {
  httpError,
  parseJson,
  serializeField,
  serializeType,
  serializeSku,
  serializeProduct,
  localDayKey,
  buildSpecText,
  genProductCode,
  genOrderNo,
  genPurchaseNo,
} = require('../src/utils/biz');

describe('localDayKey · 日期键必须按本地时区取（修过的真 bug）', () => {
  test('北京时间早上 6:30 的单子算当天，不能被 UTC 挤到前一天', () => {
    // 早市摊主 6 点就开张了。用 toISOString 会得到 2026-08-07，一整个早市的营业额都记到昨天。
    assert.equal(localDayKey('2026-08-08T06:30:00+08:00'), '2026-08-08');
    assert.equal(
      new Date('2026-08-08T06:30:00+08:00').toISOString().slice(0, 10),
      '2026-08-07',
      '这条断言钉住"错误做法"本身——一旦它不再为真，说明 Node 行为变了，上面的用例也要重看'
    );
  });

  test('北京时间 00:00-08:00 整段都不会漂到前一天', () => {
    for (const h of ['00:00', '00:01', '03:00', '07:59']) {
      assert.equal(localDayKey(`2026-08-08T${h}:00+08:00`), '2026-08-08', `${h} 漂了`);
    }
  });

  test('当天最后一刻仍算当天，不会提前跳到明天', () => {
    assert.equal(localDayKey('2026-08-08T23:59:59+08:00'), '2026-08-08');
  });

  test('跨月边界：8/1 凌晨算 8 月，不能算成 7/31', () => {
    assert.equal(localDayKey('2026-08-01T00:30:00+08:00'), '2026-08-01');
  });

  test('跨年边界：元旦凌晨算新一年，不能算成去年 12/31', () => {
    assert.equal(localDayKey('2026-01-01T02:00:00+08:00'), '2026-01-01');
  });

  test('接受 Date 对象 / ISO 字符串 / 毫秒时间戳三种入参，结果一致', () => {
    const iso = '2026-08-08T06:30:00+08:00';
    const d = new Date(iso);
    assert.equal(localDayKey(d), '2026-08-08');
    assert.equal(localDayKey(iso), '2026-08-08');
    assert.equal(localDayKey(d.getTime()), '2026-08-08');
  });

  test('返回值恒为 yyyy-MM-dd 十位字符串', () => {
    assert.match(localDayKey(new Date()), /^\d{4}-\d{2}-\d{2}$/);
  });
});

describe('buildSpecText · 规格描述文本', () => {
  const fields = [
    { key: 'volume', label: '容量', unit: 'ml' },
    { key: 'degree', label: '酒精度', type: 'number' },
    { key: 'pack', label: '包装', type: 'select' },
  ];

  test('有单位的维度拼成"值+单位"（500 + ml → 500ml）', () => {
    assert.equal(buildSpecText({ volume: '500' }, fields), '500ml');
  });

  test('数字型且无单位的维度前面补 label，否则光一个数字看不懂', () => {
    assert.equal(buildSpecText({ degree: '52' }, fields), '酒精度52');
  });

  test('枚举值本身可读，直接用值（袋装/盒装不需要再加 label）', () => {
    assert.equal(buildSpecText({ pack: '盒装' }, fields), '盒装');
  });

  test('多个维度用" · "连接，顺序跟随 specValues 的键顺序', () => {
    assert.equal(buildSpecText({ volume: '500', degree: '52', pack: '盒装' }, fields), '500ml · 酒精度52 · 盒装');
  });

  test('单位优先于数字型：同时有 unit 和 type=number 时按单位拼', () => {
    assert.equal(buildSpecText({ x: '5' }, [{ key: 'x', label: '重量', type: 'number', unit: 'kg' }]), '5kg');
  });

  test('无规格（空对象/null/undefined）返回空串，供上层落成 null', () => {
    for (const v of [{}, null, undefined]) assert.equal(buildSpecText(v, fields), '');
  });

  test('fields 缺失或维度未定义时退化成裸值，不报错', () => {
    assert.equal(buildSpecText({ volume: '500' }, null), '500');
    assert.equal(buildSpecText({ 未知维度: 'x' }, fields), 'x');
  });
});

describe('parseJson · DB 里 JSON 存字符串，解析必须永不抛错', () => {
  test('合法 JSON 正常解析', () => {
    assert.deepEqual(parseJson('{"a":1}', {}), { a: 1 });
    assert.deepEqual(parseJson('[1,2]', null), [1, 2]);
  });

  test('null / undefined 走 fallback', () => {
    assert.deepEqual(parseJson(null, { fb: 1 }), { fb: 1 });
    assert.deepEqual(parseJson(undefined, { fb: 1 }), { fb: 1 });
  });

  test('非法 JSON（空串/半截/裸文本）走 fallback 而不是抛错炸掉整个列表接口', () => {
    for (const bad of ['', '{', 'not json', '{a:1}']) {
      assert.deepEqual(parseJson(bad, { fb: 1 }), { fb: 1 }, `输入 ${JSON.stringify(bad)}`);
    }
  });

  test('字符串 "null" 是合法 JSON，解析成 null 而不是 fallback', () => {
    assert.equal(parseJson('null', { fb: 1 }), null);
  });
});

describe('序列化：JSON 字段从字符串还原成对象', () => {
  test('serializeField 把 options 字符串还原成数组，非法/缺失落 null', () => {
    assert.deepEqual(serializeField({ key: 'p', options: '["盒装","袋装"]' }).options, ['盒装', '袋装']);
    assert.equal(serializeField({ key: 'p', options: null }).options, null);
    assert.equal(serializeField({ key: 'p', options: 'oops' }).options, null);
  });

  test('serializeSku 把 specValues 还原成对象，缺失落空对象', () => {
    assert.deepEqual(serializeSku({ id: 1, specValues: '{"volume":"500ml"}' }).specValues, { volume: '500ml' });
    assert.deepEqual(serializeSku({ id: 1, specValues: null }).specValues, {});
  });

  test('serializeType 递归序列化 fields；没有 fields 时不凭空加字段', () => {
    const t = serializeType({ id: 1, name: '白酒', fields: [{ key: 'p', options: '["A"]' }] });
    assert.deepEqual(t.fields[0].options, ['A']);
    assert.equal('fields' in serializeType({ id: 1, name: '白酒' }), false);
  });

  test('serializeProduct 汇总 totalStock（缺 inventory 的规格按 0 算，不是 NaN）', () => {
    const p = serializeProduct({
      id: 1,
      customFields: '{"brand":"茅台"}',
      skus: [
        { id: 1, specValues: '{"v":"500ml"}', inventory: { quantity: 12 } },
        { id: 2, specValues: '{}', inventory: { quantity: 3.5 } },
        { id: 3, specValues: '{}' }, // 从没入过库，没有 inventory 行
      ],
    });
    assert.deepEqual(p.customFields, { brand: '茅台' });
    assert.deepEqual(p.skus[0].specValues, { v: '500ml' });
    assert.equal(p.totalStock, 15.5);
  });

  test('serializeProduct 没有 skus 时不产出 totalStock 字段（避免前端把 undefined 当 0 显示）', () => {
    const p = serializeProduct({ id: 1, customFields: '{}' });
    assert.equal('totalStock' in p, false);
  });

  test('serializeProduct 的 customFields 是脏数据时兜底成空对象', () => {
    assert.deepEqual(serializeProduct({ id: 1, customFields: 'oops' }).customFields, {});
  });
});

describe('genProductCode / genDocNo · 编号生成', () => {
  test('商品编码形如 P + 8 位数字', () => {
    assert.match(genProductCode(), /^P\d{8}$/);
  });

  // genOrderNo/genPurchaseNo 依赖注入进来的 prisma.count 和 findFirst（占号检查），用桩即可零 DB 覆盖
  const stub = (model, count) => {
    const calls = [];
    return {
      db: {
        [model]: {
          count: async (args) => (calls.push(args), count),
          findFirst: async () => null, // 默认没人占号
        },
      },
      calls,
    };
  };
  const ymd = () => {
    const d = new Date();
    return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
  };

  test('销售单号 = SO + 本地日期 + 3 位当日序号', async () => {
    const { db, calls } = stub('order', 0);
    assert.equal(await genOrderNo(db), `SO${ymd()}001`);
    assert.deepEqual(calls[0], { where: { orderNo: { startsWith: `SO${ymd()}` } } });
  });

  test('进货单号用 PO 前缀，且查的是 purchaseOrder 表', async () => {
    const { db, calls } = stub('purchaseOrder', 7);
    assert.equal(await genPurchaseNo(db), `PO${ymd()}008`);
    assert.deepEqual(calls[0], { where: { orderNo: { startsWith: `PO${ymd()}` } } });
  });

  test('序号按当日已有单量 +1，只统计同前缀（即同一天）的单', async () => {
    assert.equal(await genOrderNo(stub('order', 41).db), `SO${ymd()}042`);
  });

  test('单日超过 999 单时序号自然变 4 位，不会截断成重号', async () => {
    assert.equal(await genOrderNo(stub('order', 999).db), `SO${ymd()}1000`);
  });

  test('号被占用时顺延取下一个空号（两台手机同时开单不会撞车）', async () => {
    // 模拟：count 说该发 004，但 004 已被别人抢先占用 → 必须自动让到 005
    const taken = new Set([`SO${ymd()}004`]);
    const db = {
      order: {
        count: async () => 3,
        findFirst: async ({ where }) => (taken.has(where.orderNo) ? { id: 1 } : null),
      },
    };
    assert.equal(await genOrderNo(db), `SO${ymd()}005`);
  });
});

describe('httpError · 带状态码的业务异常', () => {
  test('产出真正的 Error 并挂上 status，供 errorHandler 直接用', () => {
    const e = httpError(404, '客户不存在');
    assert.ok(e instanceof Error);
    assert.equal(e.status, 404);
    assert.equal(e.message, '客户不存在');
  });
});
