import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/api.dart';
import '../../core/providers.dart';
import '../../core/theme.dart';

/// 账号与安全。
///
/// 「删除账号」为什么放在这一层而不是「我的」首屏：它和「退出登录」并排时，
/// 手指一滑就点错，而后果是全部经营数据永久消失、不可撤销。
/// App Store 5.1.1(v) 只要求"能在 App 内发起删号"，没要求放在首屏——
/// 我的 → 账号与安全 → 删除账号，两步可达，符合规范也符合国内 App 的惯例。
class AccountScreen extends ConsumerWidget {
  const AccountScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final t = Theme.of(context).textTheme;
    return Scaffold(
      appBar: AppBar(title: const Text('账号与安全')),
      body: ListView(
        padding: const EdgeInsets.fromLTRB(kPagePadding, 12, kPagePadding, 40),
        children: [
          Consumer(builder: (context, ref, _) {
            final u = ref.watch(profileProvider).valueOrNull;
            return SoftCard(
              child: Row(children: [
                const Icon(Icons.person_outline_rounded, color: AppColors.onSurfaceVariant),
                const SizedBox(width: 12),
                Expanded(
                  child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                    Text(u?['username'] ?? '-', style: t.titleLarge),
                    const SizedBox(height: 2),
                    Text(u?['role'] == 'admin' ? '老板（可看利润、管员工）' : '员工',
                        style: t.bodyMedium?.copyWith(fontSize: 12)),
                  ]),
                ),
              ]),
            );
          }),
          const SizedBox(height: 16),
          SoftCard(
            padding: EdgeInsets.zero,
            child: _Tile(icon: Icons.lock_outline_rounded, title: '修改密码', onTap: () => _changePassword(context)),
          ),
          const SizedBox(height: 28),
          // 危险操作单独隔离，和上面拉开距离，且带后果说明——不让人稀里糊涂点进去
          Text('危险操作', style: t.bodyMedium?.copyWith(fontSize: 12)),
          const SizedBox(height: 8),
          SoftCard(
            padding: EdgeInsets.zero,
            child: _Tile(
              icon: Icons.delete_forever_outlined,
              title: '删除账号',
              color: AppColors.error,
              subtitle: '账号和全部经营数据将永久删除，不可恢复',
              onTap: () => _deleteAccount(context, ref),
            ),
          ),
          const SizedBox(height: 12),
          Text('删除前建议先在「我的 → 导出全部数据」备份一份。',
              style: t.bodyMedium?.copyWith(fontSize: 12)),
        ],
      ),
    );
  }

  Future<void> _deleteAccount(BuildContext context, WidgetRef ref) async {
    final sure = await showDialog<bool>(
      context: context,
      builder: (dctx) => AlertDialog(
        title: const Text('删除账号'),
        content: const Text('删除后无法恢复：\n\n'
            '· 你的账号信息（用户名、姓名、手机、Apple 登录绑定）将被永久清除\n'
            '· 若你是店里唯一的账号，商品、订单、客户、报表等全部经营数据将一并永久删除\n'
            '· 若店里还有其他账号，经营单据保留，但不再关联到你\n\n'
            '建议先在「导出全部数据」备份。'),
        actions: [
          TextButton(onPressed: () => Navigator.pop(dctx, false), child: const Text('取消')),
          FilledButton(
            style: FilledButton.styleFrom(backgroundColor: AppColors.error),
            onPressed: () => Navigator.pop(dctx, true),
            child: const Text('继续删除'),
          ),
        ],
      ),
    );
    if (sure != true || !context.mounted) return;

    final input = TextEditingController();
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (dctx) => AlertDialog(
        title: const Text('最后确认'),
        content: Column(mainAxisSize: MainAxisSize.min, children: [
          const Text('请输入「删除」两个字确认：'),
          const SizedBox(height: 12),
          TextField(controller: input, autofocus: true, decoration: const InputDecoration(hintText: '删除')),
        ]),
        actions: [
          TextButton(onPressed: () => Navigator.pop(dctx, false), child: const Text('取消')),
          FilledButton(
            style: FilledButton.styleFrom(backgroundColor: AppColors.error),
            onPressed: () => Navigator.pop(dctx, input.text.trim() == '删除'),
            child: const Text('永久删除'),
          ),
        ],
      ),
    );
    if (confirmed != true || !context.mounted) return;

    try {
      await Api.I.post('/auth/delete-account');
      if (!context.mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('账号已删除')));
      ref.read(authProvider.notifier).logout();
    } on ApiError catch (e) {
      if (!context.mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text('删除失败：${e.message}')));
    }
  }

  /// 改密码
  Future<void> _changePassword(BuildContext context) async {
    final oldPwd = TextEditingController();
    final newPwd = TextEditingController();
    final confirm = TextEditingController();
    final ok = await showDialog<bool>(
      context: context,
      builder: (dctx) => AlertDialog(
        title: const Text('修改密码'),
        content: Column(mainAxisSize: MainAxisSize.min, children: [
          TextField(controller: oldPwd, obscureText: true, decoration: const InputDecoration(labelText: '原密码')),
          const SizedBox(height: 10),
          TextField(controller: newPwd, obscureText: true, decoration: const InputDecoration(labelText: '新密码（至少6位）')),
          const SizedBox(height: 10),
          TextField(controller: confirm, obscureText: true, decoration: const InputDecoration(labelText: '确认新密码')),
        ]),
        actions: [
          TextButton(onPressed: () => Navigator.pop(dctx, false), child: const Text('取消')),
          TextButton(onPressed: () => Navigator.pop(dctx, true), child: const Text('确定')),
        ],
      ),
    );
    if (ok != true) return;
    if (newPwd.text.length < 6) {
      if (context.mounted) ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('新密码至少 6 位')));
      return;
    }
    if (newPwd.text != confirm.text) {
      if (context.mounted) ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('两次新密码不一致')));
      return;
    }
    try {
      await Api.I.put('/auth/password', data: {'oldPassword': oldPwd.text, 'newPassword': newPwd.text});
      if (context.mounted) ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('✓ 密码已修改')));
    } catch (e) {
      if (context.mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text('$e')));
    }
  }
}

class _Tile extends StatelessWidget {
  final IconData icon;
  final String title;
  final String? subtitle;
  final Color? color;
  final VoidCallback onTap;
  const _Tile({required this.icon, required this.title, this.subtitle, this.color, required this.onTap});

  @override
  Widget build(BuildContext context) {
    return ListTile(
      leading: Icon(icon, color: color ?? AppColors.onSurfaceVariant),
      title: Text(title, style: TextStyle(fontSize: 15, color: color)),
      subtitle: subtitle == null
          ? null
          : Text(subtitle!, style: const TextStyle(fontSize: 12, color: AppColors.onSurfaceVariant)),
      trailing: const Icon(Icons.chevron_right_rounded, color: AppColors.outlineVariant),
      onTap: onTap,
    );
  }
}
