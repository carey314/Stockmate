import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import '../../core/theme.dart';

/// 底部 5 Tab 壳：首页 | 商品库存 | 开单(中间大按钮) | 扫码 | 我的
///
/// 中间那个最大最亮的按钮原来是「扫码」，而扫码页干的是改库存不记钱——
/// 老板每天最想干的是「开单收钱」，点最显眼的按钮却把货扫没了、钱没记上。
/// 主按钮必须是开单。
class AppShell extends StatelessWidget {
  final StatefulNavigationShell shell;
  const AppShell({super.key, required this.shell});

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      body: shell,
      // 内容不延伸到导航条后面（列表滚动不会穿到功能栏下）
      extendBody: false,
      bottomNavigationBar: _GlassNavBar(shell: shell),
    );
  }
}

class _GlassNavBar extends StatelessWidget {
  final StatefulNavigationShell shell;
  const _GlassNavBar({required this.shell});

  @override
  Widget build(BuildContext context) {
    // 顺序必须与 main.dart 的 StatefulShellBranch 顺序严格一致
    final items = [
      (Icons.grid_view_rounded, '首页'),
      (Icons.inventory_2_outlined, '商品'),
      (Icons.receipt_long_rounded, '开单'), // 中间大按钮 = 每天最高频的动作
      (Icons.qr_code_scanner_rounded, '扫码'),
      (Icons.insights_rounded, '我的'),
    ];

    return Container(
      margin: const EdgeInsets.fromLTRB(16, 0, 16, 24),
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 8),
      decoration: BoxDecoration(
        color: Colors.white.withValues(alpha: 0.85),
        borderRadius: BorderRadius.circular(32),
        boxShadow: const [
          BoxShadow(color: Color(0x14000000), offset: Offset(0, 8), blurRadius: 24, spreadRadius: -4),
        ],
      ),
      child: Row(
        children: List.generate(items.length, (i) {
          final selected = shell.currentIndex == i;
          final isCenter = i == 2; // 开单大按钮

          if (isCenter) {
            return Expanded(
              child: GestureDetector(
                onTap: () => shell.goBranch(i),
                child: Container(
                  height: 56,
                  margin: const EdgeInsets.symmetric(horizontal: 4),
                  decoration: BoxDecoration(
                    gradient: const LinearGradient(
                      begin: Alignment.topLeft,
                      end: Alignment.bottomRight,
                      colors: [AppColors.primary, Color(0xFF6A5AE0)],
                    ),
                    borderRadius: BorderRadius.circular(28),
                    boxShadow: [
                      BoxShadow(color: AppColors.primary.withValues(alpha: 0.35), offset: const Offset(0, 6), blurRadius: 16),
                    ],
                  ),
                  child: Icon(items[i].$1, color: Colors.white, size: 26),
                ),
              ),
            );
          }

          return Expanded(
            child: GestureDetector(
              behavior: HitTestBehavior.opaque,
              onTap: () => shell.goBranch(i),
              child: Container(
                height: 56,
                decoration: selected
                    ? BoxDecoration(color: AppColors.primary.withValues(alpha: 0.1), borderRadius: BorderRadius.circular(28))
                    : null,
                child: Column(
                  mainAxisAlignment: MainAxisAlignment.center,
                  children: [
                    Icon(items[i].$1, size: 22, color: selected ? AppColors.primary : const Color(0xFF9AA0AE)),
                    const SizedBox(height: 2),
                    Text(items[i].$2,
                        style: TextStyle(
                          fontSize: 10,
                          fontWeight: selected ? FontWeight.w700 : FontWeight.w500,
                          color: selected ? AppColors.primary : const Color(0xFF9AA0AE),
                        )),
                  ],
                ),
              ),
            ),
          );
        }),
      ),
    );
  }
}
