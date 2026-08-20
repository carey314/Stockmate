import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../core/api.dart';
import '../../core/theme.dart';

final staffListProvider = FutureProvider.autoDispose<List<Map<String, dynamic>>>((ref) async {
  final d = await Api.I.get('/system/users');
  return List<Map<String, dynamic>>.from(d);
});

/// 员工管理（仅老板可见）：添加员工 / 停用启用 / 重置密码
/// 员工登录后自动受限：看不到利润、资金流水、员工业绩、导出、员工管理，不能删商品/品类
class StaffScreen extends ConsumerWidget {
  const StaffScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final users = ref.watch(staffListProvider);
    final t = Theme.of(context).textTheme;
    return Scaffold(
      appBar: AppBar(title: const Text('员工管理'), actions: [
        IconButton(
          icon: const Icon(Icons.person_add_alt_1_rounded, color: AppColors.primary),
          onPressed: () => _addStaff(context, ref),
        ),
      ]),
      body: users.when(
        loading: () => const Center(child: CircularProgressIndicator()),
        error: (e, _) => Center(child: Text('$e')),
        data: (list) => ListView(
          padding: const EdgeInsets.fromLTRB(kPagePadding, 8, kPagePadding, 120),
          children: [
            SoftCard(
              child: Row(children: [
                const Icon(Icons.info_outline_rounded, size: 18, color: AppColors.primary),
                const SizedBox(width: 10),
                Expanded(
                  child: Text('员工账号可以开单、进货、盘库存，但看不到利润报表和资金流水，也不能删除商品和导出数据。',
                      style: t.bodyMedium?.copyWith(fontSize: 12, height: 1.5)),
                ),
              ]),
            ),
            const SizedBox(height: 12),
            for (final u in list)
              Padding(
                padding: const EdgeInsets.only(bottom: 10),
                child: SoftCard(
                  child: Row(children: [
                    CircleAvatar(
                      backgroundColor: u['status'] == 1 ? AppColors.primaryFixed : const Color(0xFFEEEEEE),
                      child: Text((u['realName'] ?? '?').toString().characters.first,
                          style: TextStyle(color: u['status'] == 1 ? AppColors.primary : Colors.grey, fontWeight: FontWeight.w700)),
                    ),
                    const SizedBox(width: 12),
                    Expanded(
                      child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                        Row(children: [
                          Text(u['realName'] ?? '-', style: t.titleMedium),
                          const SizedBox(width: 6),
                          Container(
                            padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
                            decoration: BoxDecoration(
                              color: u['role'] == 'admin' ? AppColors.primaryFixed : const Color(0xFFF0F0F0),
                              borderRadius: BorderRadius.circular(6),
                            ),
                            child: Text(u['role'] == 'admin' ? '老板' : '员工',
                                style: TextStyle(fontSize: 10, color: u['role'] == 'admin' ? AppColors.primary : Colors.grey)),
                          ),
                          if (u['status'] != 1) ...[
                            const SizedBox(width: 6),
                            const Text('已停用', style: TextStyle(fontSize: 10, color: AppColors.error)),
                          ],
                        ]),
                        const SizedBox(height: 2),
                        Text('账号：${u['username']}', style: t.bodyMedium?.copyWith(fontSize: 12)),
                      ]),
                    ),
                    if (u['role'] != 'admin')
                      PopupMenuButton<String>(
                        icon: const Icon(Icons.more_horiz_rounded, color: AppColors.onSurfaceVariant),
                        onSelected: (v) {
                          if (v == 'toggle') _toggle(context, ref, u);
                          if (v == 'pwd') _resetPwd(context, u);
                        },
                        itemBuilder: (_) => [
                          PopupMenuItem(value: 'toggle', child: Text(u['status'] == 1 ? '停用账号' : '启用账号')),
                          const PopupMenuItem(value: 'pwd', child: Text('重置密码')),
                        ],
                      ),
                  ]),
                ),
              ),
          ],
        ),
      ),
    );
  }

  Future<void> _addStaff(BuildContext context, WidgetRef ref) async {
    final username = TextEditingController();
    final realName = TextEditingController();
    final password = TextEditingController();
    final ok = await showDialog<bool>(
      context: context,
      builder: (dctx) => AlertDialog(
        title: const Text('添加员工'),
        content: Column(mainAxisSize: MainAxisSize.min, children: [
          TextField(controller: realName, autofocus: true, decoration: const InputDecoration(labelText: '员工姓名/称呼')),
          const SizedBox(height: 10),
          TextField(controller: username, decoration: const InputDecoration(labelText: '登录用户名（至少3位）')),
          const SizedBox(height: 10),
          TextField(controller: password, decoration: const InputDecoration(labelText: '初始密码（至少6位）')),
        ]),
        actions: [
          TextButton(onPressed: () => Navigator.pop(dctx, false), child: const Text('取消')),
          TextButton(onPressed: () => Navigator.pop(dctx, true), child: const Text('创建')),
        ],
      ),
    );
    if (ok != true || !context.mounted) return;
    try {
      await Api.I.post('/system/users', data: {
        'username': username.text.trim(),
        'realName': realName.text.trim(),
        'password': password.text,
      });
      ref.invalidate(staffListProvider);
      if (context.mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
            SnackBar(content: Text('✓ 员工「${realName.text.trim()}」已创建，把用户名和密码告诉他即可登录')));
      }
    } catch (e) {
      if (context.mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text('$e')));
    }
  }

  Future<void> _toggle(BuildContext context, WidgetRef ref, Map<String, dynamic> u) async {
    try {
      await Api.I.put('/system/users/${u['id']}/toggle');
      ref.invalidate(staffListProvider);
      if (context.mounted) {
        ScaffoldMessenger.of(context)
            .showSnackBar(SnackBar(content: Text(u['status'] == 1 ? '已停用，该账号无法再登录' : '✓ 已重新启用')));
      }
    } catch (e) {
      if (context.mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text('$e')));
    }
  }

  Future<void> _resetPwd(BuildContext context, Map<String, dynamic> u) async {
    final pwd = TextEditingController();
    final ok = await showDialog<bool>(
      context: context,
      builder: (dctx) => AlertDialog(
        title: Text('重置「${u['realName']}」的密码'),
        content: TextField(controller: pwd, autofocus: true, decoration: const InputDecoration(labelText: '新密码（至少6位）')),
        actions: [
          TextButton(onPressed: () => Navigator.pop(dctx, false), child: const Text('取消')),
          TextButton(onPressed: () => Navigator.pop(dctx, true), child: const Text('重置')),
        ],
      ),
    );
    if (ok != true || !context.mounted) return;
    try {
      await Api.I.put('/system/users/${u['id']}/password', data: {'password': pwd.text});
      if (context.mounted) ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('✓ 密码已重置')));
    } catch (e) {
      if (context.mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text('$e')));
    }
  }
}
