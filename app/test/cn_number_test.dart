// 中文键盘数字输入清洗（真人测试：酒精度想填 1.5，中文键盘打出 1。5，死活输不进去）
import 'package:flutter_test/flutter_test.dart';
import 'package:stockmate/core/theme.dart';

TextEditingValue _fmt(String s) =>
    const CnNumberFormatter().formatEditUpdate(TextEditingValue.empty, TextEditingValue(text: s));

void main() {
  group('中文标点/全角数字 → 合法数字', () {
    test('中文句号当小数点', () => expect(_fmt('1。5').text, '1.5'));
    test('中文逗号当小数点', () => expect(_fmt('1，5').text, '1.5'));
    test('英文逗号当小数点', () => expect(_fmt('1,5').text, '1.5'));
    test('全角数字转半角', () => expect(_fmt('５２').text, '52'));
    test('混合垃圾也能救', () => expect(_fmt('５２。３').text, '52.3'));
    test('正常输入原样通过', () => expect(_fmt('12.5').text, '12.5'));
    test('清洗后能被 double.parse', () {
      expect(double.tryParse(_fmt('1。5').text), 1.5);
      expect(double.tryParse(_fmt('５２。３').text), 52.3);
    });
  });
}
