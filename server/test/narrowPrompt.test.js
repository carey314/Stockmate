// 提示词瘦身：只把可能相关的商品/客户拼进 AI 提示词，省钱。
// **这层的红线是"绝不能漏"**——口述里提到的商品一旦被过滤掉，AI 就永远匹配不上，
// 用户会看到"没有商品档案"，比多花点钱严重得多。所以宽松优先。
const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const { narrowForPrompt } = require('../src/utils/biz');

const P = (name) => ({ name });
const 目录 = [
  P('泸州老窖 整箱'), P('青岛啤酒 500ml'), P('农夫山泉 整箱'), P('芹菜馄饨 袋装'),
  P('虾仁馄饨 袋装'), P('老干妈 单瓶'), P('德芙巧克力 礼盒'), P('乐事薯片 大包'),
  P('海天酱油 单瓶'), P('双汇火腿肠 小包'),
];
const names = (r) => r.map((x) => x.name);

describe('绝不能漏 · 口述提到的商品必须进提示词', () => {
  test('完整商品名', () => {
    const r = narrowForPrompt(目录, (p) => p.name, '卖了3袋芹菜馄饨45块', { floor: 0, cap: 100 });
    assert.ok(names(r).some((n) => n.includes('芹菜馄饨')));
  });

  test('只说了商品名的一部分', () => {
    const r = narrowForPrompt(目录, (p) => p.name, '进了2箱青岛', { floor: 0, cap: 100 });
    assert.ok(names(r).some((n) => n.includes('青岛啤酒')));
  });

  test('用简称（"青啤"要能命中"青岛啤酒"，所以按单字匹配而不是词组）', () => {
    const r = narrowForPrompt(目录, (p) => p.name, '青啤来两箱', { floor: 0, cap: 100 });
    assert.ok(names(r).some((n) => n.includes('青岛啤酒')));
  });

  test('一句话提到多个商品，全都要在', () => {
    const r = narrowForPrompt(目录, (p) => p.name, '卖了老干妈和德芙巧克力，还进了农夫山泉', { floor: 0, cap: 100 });
    const n = names(r).join('|');
    assert.ok(n.includes('老干妈') && n.includes('德芙巧克力') && n.includes('农夫山泉'));
  });
});

describe('省钱 · 明显不相关的要滤掉', () => {
  test('一个字都不沾边的商品不进提示词', () => {
    const r = narrowForPrompt(目录, (p) => p.name, '卖了3袋芹菜馄饨45块', { floor: 0, cap: 100 });
    assert.ok(!names(r).some((n) => n.includes('海天酱油')));
    assert.ok(!names(r).some((n) => n.includes('双汇火腿肠')));
  });

  test('数字和字母不参与匹配（"500ml"不该被口述里的"192"命中）', () => {
    const r = narrowForPrompt([P('青岛啤酒 500ml'), P('可乐 330ml')], (p) => p.name, '进货花了192元，共500件', { floor: 0, cap: 100 });
    assert.equal(r.length, 0, '纯数字/字母不构成匹配依据，否则过滤形同虚设');
  });

  test('大目录能显著缩短（这就是省钱的来源）', () => {
    const big = Array.from({ length: 300 }, (_, i) => P(`${目录[i % 目录.length].name} ${i}号`));
    const r = narrowForPrompt(big, (p) => p.name, '卖了2瓶老干妈', { floor: 20, cap: 150 });
    assert.ok(r.length < big.length * 0.6, `应显著缩减，实际 ${r.length}/${big.length}`);
  });
});

describe('边界 · 不能因为省钱把自己搞崩', () => {
  test('命中太少时补到 floor（新店/短句不能拼出空清单）', () => {
    const r = narrowForPrompt(目录, (p) => p.name, 'xyz', { floor: 5, cap: 100 });
    assert.equal(r.length, 5);
  });

  test('命中太多时截到 cap', () => {
    const big = Array.from({ length: 200 }, () => P('芹菜馄饨'));
    const r = narrowForPrompt(big, (p) => p.name, '芹菜馄饨', { floor: 10, cap: 50 });
    assert.equal(r.length, 50);
  });

  test('空列表 / 空文本 / 名字为空都不炸', () => {
    assert.deepEqual(narrowForPrompt([], (p) => p.name, '随便', {}), []);
    assert.equal(narrowForPrompt(目录, (p) => p.name, '', { floor: 3, cap: 10 }).length, 3);
    assert.doesNotThrow(() => narrowForPrompt([{ name: null }], (p) => p.name, '测试', { floor: 1, cap: 5 }));
  });
});
