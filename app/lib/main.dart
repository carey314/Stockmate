import 'dart:async';

import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:flutter_localizations/flutter_localizations.dart';

import 'core/crash_report.dart';
import 'core/legal.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import 'core/api.dart';
import 'core/providers.dart';
import 'core/theme.dart';
import 'features/auth/login_screen.dart';
import 'features/shell/app_shell.dart';
import 'features/dashboard/dashboard_screen.dart';
import 'features/types/types_screen.dart';
import 'features/types/type_edit_screen.dart';
import 'features/products/products_screen.dart';
import 'features/products/product_form_screen.dart';
import 'features/products/product_detail_screen.dart';
import 'features/scan/scan_screen.dart';
import 'features/scan/scan_code_screen.dart';
import 'features/voice/voice_entry_screen.dart';
import 'features/orders/orders_screen.dart';
import 'features/orders/order_create_screen.dart';
import 'features/orders/order_detail_screen.dart';
import 'features/profile/profile_screen.dart';
import 'features/reports/reports_screen.dart';
import 'features/reports/statement_screen.dart';
import 'features/reports/ask_screen.dart';
import 'features/reports/supplier_statement_screen.dart';
import 'features/profile/staff_screen.dart';
import 'features/stocktake/stocktake_screen.dart';
import 'features/printer/printer_screen.dart';
import 'features/customers/customers_screen.dart';
import 'features/inventory/inventory_move_screen.dart';
import 'features/notifications/notifications_screen.dart';
import 'features/purchase/purchase_orders_screen.dart';
import 'features/profile/about_screen.dart';
import 'features/purchase/purchase_order_create_screen.dart';
import 'features/purchase/purchase_order_detail_screen.dart';

Future<void> main() async {
  // 崩溃全局捕获必须最先挂，否则启动过程中的错误抓不到
  runZonedGuarded(_boot, (error, stack) => CrashReport.report('zone', error, stack));
}

Future<void> _boot() async {
  WidgetsFlutterBinding.ensureInitialized();
  CrashReport.install();
  await Api.I.loadToken();
  // 仅 debug：本地联调自动登录，省去每次输密码（发布版无此逻辑）
  if (kDebugMode && !Api.I.hasToken) {
    try {
      // 账号可覆盖：拍应用商店截图时指向线上 demo 店
      // --dart-define=DEMO_USER=review --dart-define=DEMO_PASS=xxx
      final data = await Api.I.post('/auth/login', data: {
        'username': const String.fromEnvironment('DEMO_USER', defaultValue: 'admin'),
        'password': const String.fromEnvironment('DEMO_PASS', defaultValue: 'admin123'),
      });
      await Api.I.setToken(data['token']);
    } catch (_) {/* 后端没开就停在登录页 */}
  }
  runApp(const ProviderScope(child: StockMateApp()));
}

final _routerProvider = Provider<GoRouter>((ref) {
  final loggedIn = ref.watch(authProvider);
  return GoRouter(
    // START_ROUTE：开发用 --dart-define=START_ROUTE=/types 直达某屏（默认首页）
    initialLocation: loggedIn ? const String.fromEnvironment('START_ROUTE', defaultValue: '/') : '/login',
    redirect: (context, state) {
      final isLogin = state.matchedLocation == '/login';
      if (!loggedIn && !isLogin) return '/login';
      if (loggedIn && isLogin) return '/';
      return null;
    },
    routes: [
      GoRoute(path: '/login', builder: (_, __) => const LoginScreen()),
      // 底部 5 Tab 壳
      StatefulShellRoute.indexedStack(
        builder: (_, __, shell) => AppShell(shell: shell),
        branches: [
          StatefulShellBranch(routes: [GoRoute(path: '/', builder: (_, __) => const DashboardScreen())]),
          StatefulShellBranch(routes: [GoRoute(path: '/products', builder: (_, __) => const ProductsScreen())]),
          // 顺序与 app_shell.dart 的 items 严格对应：开单在中间(大按钮)，扫码退到第4位
          StatefulShellBranch(routes: [GoRoute(path: '/orders', builder: (_, __) => const OrdersScreen())]),
          StatefulShellBranch(routes: [GoRoute(path: '/scan', builder: (_, __) => const ScanScreen())]),
          StatefulShellBranch(routes: [GoRoute(path: '/profile', builder: (_, __) => const ProfileScreen())]),
        ],
      ),
      GoRoute(path: '/about', builder: (_, __) => const AboutScreen()),
      GoRoute(path: '/types', builder: (_, __) => const TypesScreen()),
      GoRoute(path: '/types/new', builder: (_, s) => TypeEditScreen(aiTheme: s.uri.queryParameters['theme'])),
      GoRoute(path: '/types/:id', builder: (_, s) => TypeEditScreen(typeId: int.parse(s.pathParameters['id']!))),
      GoRoute(
          path: '/products/new',
          builder: (_, s) => ProductFormScreen(
              initialTypeId: s.uri.queryParameters['typeId'] == null ? null : int.parse(s.uri.queryParameters['typeId']!),
              initialBarcode: s.uri.queryParameters['barcode'])),
      GoRoute(path: '/products/:id/edit', builder: (_, s) => ProductFormScreen(productId: int.parse(s.pathParameters['id']!))),
      GoRoute(path: '/products/:id', builder: (_, s) => ProductDetailScreen(productId: int.parse(s.pathParameters['id']!))),
      GoRoute(path: '/voice-entry', builder: (_, __) => const VoiceEntryScreen()),
      GoRoute(path: '/reports', builder: (_, __) => const ReportsScreen()),
      GoRoute(path: '/ask', builder: (_, __) => const AskScreen()),
      GoRoute(path: '/scan-code', builder: (_, __) => const ScanCodeScreen()),
      GoRoute(path: '/purchase-orders', builder: (_, __) => const PurchaseOrdersScreen()),
      GoRoute(path: '/purchase-orders/new', builder: (_, __) => const PurchaseOrderCreateScreen()),
      GoRoute(path: '/purchase-orders/:id', builder: (_, s) => PurchaseOrderDetailScreen(poId: int.parse(s.pathParameters['id']!))),
      GoRoute(path: '/reports/statement/:customerId', builder: (_, s) => StatementScreen(customerId: int.parse(s.pathParameters['customerId']!))),
      GoRoute(path: '/reports/supplier-statement/:supplierId', builder: (_, s) => SupplierStatementScreen(supplierId: int.parse(s.pathParameters['supplierId']!))),
      GoRoute(path: '/staff', builder: (_, __) => const StaffScreen()),
      GoRoute(path: '/printer', builder: (_, __) => const PrinterScreen()),
      GoRoute(path: '/customers', builder: (_, __) => const CustomersScreen()),
      GoRoute(path: '/customers/:id', builder: (_, s) => CustomerDetailScreen(customerId: int.parse(s.pathParameters['id']!))),
      GoRoute(path: '/inventory-move', builder: (_, __) => const InventoryMoveScreen()),
      GoRoute(path: '/notifications', builder: (_, __) => const NotificationsScreen()),
      GoRoute(path: '/stocktakes', builder: (_, __) => const StocktakeListScreen()),
      GoRoute(path: '/stocktakes/new', builder: (_, __) => const StocktakeCreateScreen()),
      GoRoute(path: '/stocktakes/:id', builder: (_, s) => StocktakeDetailScreen(id: int.parse(s.pathParameters['id']!))),
      GoRoute(
          path: '/orders/new',
          builder: (_, s) => OrderCreateScreen(
              initialCustomerId: s.uri.queryParameters['customer'] == null ? null : int.parse(s.uri.queryParameters['customer']!),
              duplicateFromId: s.uri.queryParameters['from'] == null ? null : int.parse(s.uri.queryParameters['from']!))),
      GoRoute(path: '/orders/:id', builder: (_, s) => OrderDetailScreen(orderId: int.parse(s.pathParameters['id']!))),
    ],
  );
});

class StockMateApp extends ConsumerWidget {
  const StockMateApp({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    return MaterialApp.router(
      title: 'StockMate 智存',
      debugShowCheckedModeBanner: false,
      theme: buildTheme(),
      // 国际化：跟随系统语言（不设 locale）。中文系统全中文（含日期选择器等系统组件），
      // 其他语言回退英文组件（业务文案暂为中文，全量翻译是后续工程）
      localizationsDelegates: const [
        GlobalMaterialLocalizations.delegate,
        GlobalWidgetsLocalizations.delegate,
        GlobalCupertinoLocalizations.delegate,
      ],
      supportedLocales: const [Locale('zh', 'CN'), Locale('zh'), Locale('en')],
      // 首启隐私同意门（中国区合规）：同意前整屏拦截
      builder: (context, child) => PrivacyGate(child: child ?? const SizedBox()),
      routerConfig: ref.watch(_routerProvider),
    );
  }
}
