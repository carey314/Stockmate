import 'package:flutter/material.dart';

import '../../core/crash_report.dart';
import '../../core/legal.dart';
import '../../core/theme.dart';

/// 关于智存：版本号 + 备案号 + 法务入口。
/// 备案号是工信部硬要求（App 内显著位置展示），号下来后改 legal.dart 的 icpFiling 即可。
class AboutScreen extends StatelessWidget {
  const AboutScreen({super.key});

  @override
  Widget build(BuildContext context) {
    final t = Theme.of(context).textTheme;
    return Scaffold(
      appBar: AppBar(title: const Text('关于')),
      body: ListView(
        padding: const EdgeInsets.fromLTRB(kPagePadding, 24, kPagePadding, 40),
        children: [
          Center(
            child: Column(children: [
              Container(
                width: 84,
                height: 84,
                decoration: BoxDecoration(
                  gradient: const LinearGradient(colors: [AppColors.primary, AppColors.primaryContainer]),
                  borderRadius: BorderRadius.circular(20),
                ),
                child: const Icon(Icons.auto_awesome, color: Colors.white, size: 40),
              ),
              const SizedBox(height: 14),
              Text('智存 StockMate', style: t.titleLarge),
              const SizedBox(height: 4),
              Text('AI 原生 · 什么生意都能管的进销存', style: t.bodyMedium),
              const SizedBox(height: 6),
              Text('版本 ${CrashReport.appVersion}', style: t.bodyMedium?.copyWith(fontSize: 12)),
            ]),
          ),
          const SizedBox(height: 26),
          SoftCard(
            padding: EdgeInsets.zero,
            child: Column(children: [
              _Row(
                label: 'ICP 备案号',
                value: icpFiling.isEmpty ? '备案办理中' : icpFiling,
                dim: icpFiling.isEmpty,
              ),
              const Divider(height: 1, indent: 20),
              _Tile(icon: Icons.privacy_tip_outlined, title: '隐私政策', onTap: () => openLegal(privacyUrl)),
              const Divider(height: 1, indent: 56),
              _Tile(icon: Icons.description_outlined, title: '用户协议', onTap: () => openLegal(termsUrl)),
              const Divider(height: 1, indent: 56),
              _Tile(icon: Icons.help_outline_rounded, title: '帮助与联系我们', onTap: () => openLegal(supportUrl)),
            ]),
          ),
          const SizedBox(height: 20),
          Center(
            child: Text(
              '你的经营数据存在中国境内服务器\n可随时全量导出，也可随时删除账号',
              textAlign: TextAlign.center,
              style: t.bodyMedium?.copyWith(fontSize: 12, height: 1.7),
            ),
          ),
        ],
      ),
    );
  }
}

class _Row extends StatelessWidget {
  final String label;
  final String value;
  final bool dim;
  const _Row({required this.label, required this.value, this.dim = false});

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: 20, vertical: 16),
      child: Row(children: [
        Text(label, style: const TextStyle(fontSize: 15)),
        const Spacer(),
        Text(value,
            style: TextStyle(fontSize: 14, color: dim ? AppColors.onSurfaceVariant : AppColors.onSurface)),
      ]),
    );
  }
}

class _Tile extends StatelessWidget {
  final IconData icon;
  final String title;
  final VoidCallback onTap;
  const _Tile({required this.icon, required this.title, required this.onTap});

  @override
  Widget build(BuildContext context) {
    return ListTile(
      leading: Icon(icon, color: AppColors.onSurfaceVariant),
      title: Text(title, style: const TextStyle(fontSize: 15)),
      trailing: const Icon(Icons.chevron_right_rounded, color: AppColors.outlineVariant),
      onTap: onTap,
    );
  }
}
