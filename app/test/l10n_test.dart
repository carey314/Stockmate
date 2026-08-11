// 本地化接线防回归：zh locale 下 Material 系统组件文案必须是中文
// （日期选择器/对话框按钮等靠 GlobalMaterialLocalizations——有人删 delegates 这里立刻红）
import 'package:flutter/material.dart';
import 'package:flutter_localizations/flutter_localizations.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  testWidgets('中文环境下 Material 组件文案为中文', (t) async {
    late BuildContext ctx;
    await t.pumpWidget(MaterialApp(
      localizationsDelegates: const [
        GlobalMaterialLocalizations.delegate,
        GlobalWidgetsLocalizations.delegate,
        GlobalCupertinoLocalizations.delegate,
      ],
      supportedLocales: const [Locale('zh', 'CN'), Locale('zh'), Locale('en')],
      locale: const Locale('zh', 'CN'),
      home: Builder(builder: (c) {
        ctx = c;
        return const SizedBox();
      }),
    ));
    final l = MaterialLocalizations.of(ctx);
    expect(l.okButtonLabel, '确定');
    expect(l.cancelButtonLabel, '取消');
    expect(l.saveButtonLabel, '保存');
  });
}
