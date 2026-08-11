// 窄屏布局体检：用小屏（iPhone SE 尺寸）走一遍带底部操作栏/多按钮横排的页面，
// 收集所有布局异常（溢出、无限宽约束）一次性报出来。
//
// 由来：用户两次发现的问题是同一类——"按钮裸放在 Row 里被主题的无限宽撑爆"
// 和"中文标签被挤到换行"。这类问题在大屏上看不出来，小屏必现。
// 跑法（后端须在 3100）：flutter test integration_test/narrow_layout_test.dart -d <udid>
import 'dart:convert';

import 'package:flutter_test/flutter_test.dart';
import 'package:integration_test/integration_test.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:stockmate/core/api.dart';
import 'package:stockmate/main.dart';

Future<void> _pumpFor(WidgetTester t, Duration d) async {
  final end = DateTime.now().add(d);
  while (DateTime.now().isBefore(end)) {
    await t.pump(const Duration(milliseconds: 150));
  }
}

Future<bool> _waitFor(WidgetTester t, Finder f, {int tries = 40}) async {
  for (var i = 0; i < tries; i++) {
    await t.pump(const Duration(milliseconds: 250));
    if (f.evaluate().isNotEmpty) return true;
  }
  return false;
}

Future<void> _back(WidgetTester t) async {
  for (final f in [find.byTooltip('返回'), find.byTooltip('Back'), find.byType(BackButton)]) {
    if (f.evaluate().isNotEmpty) {
      await t.tap(f.first);
      await _pumpFor(t, const Duration(seconds: 2));
      return;
    }
  }
}

void main() {
  IntegrationTestWidgetsFlutterBinding.ensureInitialized();

  setUpAll(() async {
    final auth = await Api.I.post('/auth/login', data: {'username': 'admin', 'password': 'admin123'});
    await Api.I.setToken(auth['token']);
    final prods = await Api.I.get('/products', query: {'page': 1, 'pageSize': 50});
    final sku = ((prods['list'] as List).first)['skus'][0];
    final sp = await SharedPreferences.getInstance();
    await sp.setBool('privacy_agreed_v1', true);
    // 开单页要有货才能测到底部结算栏
    await sp.setString('sale_draft_v1', jsonEncode({
      'customerId': null,
      'items': [
        {'skuId': sku['id'], 'qty': 3.0, 'price': (sku['price'] as num).toDouble(), 'src': 'default'}
      ],
    }));
  });

  tearDownAll(() async {
    (await SharedPreferences.getInstance()).remove('sale_draft_v1');
  });

  testWidgets('小屏(375pt)走查主要页面，不许有布局异常', (t) async {
    // iPhone SE / mini 级别的宽度——大屏能藏住的挤压，这里全现形
    t.view.physicalSize = const Size(750, 1334);
    t.view.devicePixelRatio = 2.0;
    addTearDown(() {
      t.view.resetPhysicalSize();
      t.view.resetDevicePixelRatio();
    });

    // 自己收集布局异常：不让第一处失败就中断走查，一次跑完拿到完整清单
    final problems = <String>[];
    final prevOnError = FlutterError.onError;
    FlutterError.onError = (details) {
      final msg = details.exception.toString();
      if (msg.contains('overflowed') || msg.contains('infinite') || msg.contains('Infinity') || msg.contains('RenderFlex')) {
        problems.add(msg.split('\n').first);
      } else {
        prevOnError?.call(details);
      }
    };
    addTearDown(() => FlutterError.onError = prevOnError);

    await t.pumpWidget(const ProviderScope(child: StockMateApp()));
    await _pumpFor(t, const Duration(seconds: 3));
    if (find.text('同意并继续').evaluate().isNotEmpty) {
      await t.tap(find.text('同意并继续'));
      await _pumpFor(t, const Duration(seconds: 2));
    }
    await _waitFor(t, find.byIcon(Icons.grid_view_rounded));

    // ① 五个主 Tab
    for (final icon in [Icons.grid_view_rounded, Icons.inventory_2_outlined, Icons.receipt_long_rounded, Icons.qr_code_scanner_rounded]) {
      await t.tap(find.byIcon(icon).first);
      await _pumpFor(t, const Duration(seconds: 2));
    }

    // ② 开单页（底部结算栏 + 购物车行，按钮最密集的一屏）
    await t.tap(find.byIcon(Icons.receipt_long_rounded).first);
    await _pumpFor(t, const Duration(seconds: 1));
    if (await _waitFor(t, find.byIcon(Icons.add_rounded))) {
      await t.tap(find.byIcon(Icons.add_rounded).first);
      await _waitFor(t, find.text('提交订单'));
      await _pumpFor(t, const Duration(seconds: 5)); // 等草稿恢复
      await _back(t);
    }

    // ③ 订单详情（四个动作的底栏，用户报过问题的那屏）
    if (await _waitFor(t, find.textContaining('SO'))) {
      await t.tap(find.textContaining('SO').first);
      await _waitFor(t, find.textContaining('分享单据'));
      await _pumpFor(t, const Duration(seconds: 2));
      await _back(t);
    }

    // ④ 「我的」里的二级页（各自都有底部按钮或密集横排）
    await t.tap(find.text('我的').last);
    await _pumpFor(t, const Duration(seconds: 2));
    for (final entry in ['报表中心', '品类管理', '进货单', '盘点单', '出入库（报损/自用）', '客户（欠款/对账）', 'AI 口述记账', '关于智存']) {
      if (find.text(entry).evaluate().isEmpty) {
        await t.drag(find.byType(ListView).first, const Offset(0, -220));
        await _pumpFor(t, const Duration(milliseconds: 600));
      }
      if (find.text(entry).evaluate().isEmpty) continue;
      await t.tap(find.text(entry));
      await _pumpFor(t, const Duration(seconds: 3));
      await _back(t);
      await _pumpFor(t, const Duration(seconds: 1));
    }

    expect(problems, isEmpty, reason: '小屏下发现 ${problems.length} 处布局问题:\n${problems.take(10).join("\n")}');
  });
}
