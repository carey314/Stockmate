// 环节4：AI 问生意（sanitizeAnswer）
// 这层只保证一件事：返回给老板的永远是一段有长度上限的字符串，
// AI 交白卷时给诚实占位而不是渲染出一个空气泡。
const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const { sanitizeAnswer } = require('../src/utils/aiGuard');

const PLACEHOLDER = '（AI 没有给出有效回答，换个问法试试）';

describe('sanitizeAnswer · 问生意回答清洗', () => {
  test('正常回答原样返回并去掉首尾空白', () => {
    assert.equal(sanitizeAnswer({ answer: '  本月毛利 ¥3200  ' }), '本月毛利 ¥3200');
  });

  test('answer 不是字符串（数字/对象/数组/null）一律给占位', () => {
    for (const answer of [42, { text: 'x' }, ['x'], null, undefined, true]) {
      assert.equal(sanitizeAnswer({ answer }), PLACEHOLDER, `answer=${JSON.stringify(answer)}`);
    }
  });

  test('空字符串与纯空白给占位（不返回空气泡）', () => {
    for (const answer of ['', '   ', '\n\t ']) {
      assert.equal(sanitizeAnswer({ answer }), PLACEHOLDER);
    }
  });

  test('整个响应是垃圾（null/字符串/缺 answer 键）也给占位，不抛异常', () => {
    for (const input of [null, undefined, 'oops', 42, {}]) {
      assert.equal(sanitizeAnswer(input), PLACEHOLDER);
    }
  });

  test('600 字以内不截断', () => {
    const a = '答'.repeat(600);
    assert.equal(sanitizeAnswer({ answer: a }), a);
  });

  test('超过 600 字截断到 600 字并补省略号（防 AI 长篇大论撑爆气泡）', () => {
    const out = sanitizeAnswer({ answer: '答'.repeat(601) });
    assert.equal(out.length, 601, '600 正文 + 1 个省略号');
    assert.ok(out.endsWith('…'));
    assert.equal(out.slice(0, 600), '答'.repeat(600));
  });

  test('长度判定发生在 trim 之后（首尾空白不占额度）', () => {
    const out = sanitizeAnswer({ answer: `   ${'答'.repeat(600)}   ` });
    assert.equal(out.length, 600);
    assert.ok(!out.endsWith('…'));
  });
});
