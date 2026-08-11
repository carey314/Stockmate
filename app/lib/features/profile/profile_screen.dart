import 'dart:convert';
import 'dart:io';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:intl/intl.dart';
import 'package:path_provider/path_provider.dart';
import 'package:share_plus/share_plus.dart';

import '../../core/legal.dart';
import '../../core/share_util.dart';
import '../../core/api.dart';
import '../../core/providers.dart';
import '../../core/theme.dart';

/// 我的：客户管理入口 / 品类管理 / 退出（P0 极简版，报表 P1 补）
class ProfileScreen extends ConsumerWidget {
  const ProfileScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final t = Theme.of(context).textTheme;
    // 角色控制：员工看不到 员工管理/导出/改店名（后端同样有权限拦截，这里只是不展示）
    final isAdmin = ref.watch(profileProvider).valueOrNull?['role'] == 'admin';
    return Scaffold(
      appBar: AppBar(title: const Text('我的')),
      body: ListView(
        padding: const EdgeInsets.fromLTRB(kPagePadding, 8, kPagePadding, 120),
        children: [
          Text('我的', style: t.headlineLarge),
          const SizedBox(height: 20),
          // ===== 账号卡：店名/用户名/角色 + 资料修改入口 =====
          Consumer(builder: (context, ref, _) {
            final profile = ref.watch(profileProvider);
            return profile.when(
              loading: () => const SoftCard(child: Center(child: Padding(padding: EdgeInsets.all(8), child: CircularProgressIndicator()))),
              error: (e, _) => SoftCard(child: Text('账号信息加载失败：$e', style: t.bodyMedium)),
              data: (u) => SoftCard(
                child: Column(children: [
                  Row(children: [
                    CircleAvatar(
                      radius: 26,
                      backgroundColor: AppColors.primaryFixed,
                      child: Text((u['realName'] ?? '?').toString().characters.first,
                          style: const TextStyle(fontSize: 22, fontWeight: FontWeight.w700, color: AppColors.primary)),
                    ),
                    const SizedBox(width: 14),
                    Expanded(
                      child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                        Text(u['shopName'] ?? u['realName'] ?? '-', style: t.titleLarge),
                        const SizedBox(height: 2),
                        Text('${u['realName']} · 账号 ${u['username']} · ${u['role'] == 'admin' ? '老板' : '员工'}',
                            style: t.bodyMedium?.copyWith(fontSize: 12)),
                      ]),
                    ),
                  ]),
                  const SizedBox(height: 14),
                  Row(children: [
                    if (u['role'] == 'admin') ...[
                      Expanded(
                        child: OutlinedButton.icon(
                          onPressed: () => _editShopName(context, ref, u['shopName'] ?? ''),
                          icon: const Icon(Icons.storefront_outlined, size: 16),
                          label: const Text('改店名', style: TextStyle(fontSize: 13)),
                        ),
                      ),
                      const SizedBox(width: 10),
                    ],
                    Expanded(
                      child: OutlinedButton.icon(
                        onPressed: () => _changePassword(context),
                        icon: const Icon(Icons.lock_outline, size: 16),
                        label: const Text('改密码', style: TextStyle(fontSize: 13)),
                      ),
                    ),
                  ]),
                ]),
              ),
            );
          }),
          const SizedBox(height: 16),
          SoftCard(
            padding: EdgeInsets.zero,
            child: Column(children: [
              _MenuTile(icon: Icons.bar_chart_rounded, title: '报表中心', onTap: () => context.push('/reports')),
              const Divider(height: 1, indent: 56),
              _MenuTile(icon: Icons.dashboard_customize_outlined, title: '品类管理', onTap: () => context.push('/types')),
              const Divider(height: 1, indent: 56),
              _MenuTile(icon: Icons.local_shipping_outlined, title: '进货单', onTap: () => context.push('/purchase-orders')),
              const Divider(height: 1, indent: 56),
              _MenuTile(icon: Icons.fact_check_outlined, title: '盘点单', onTap: () => context.push('/stocktakes')),
              const Divider(height: 1, indent: 56),
              _MenuTile(icon: Icons.swap_vert_rounded, title: '出入库（报损/自用）', onTap: () => context.push('/inventory-move')),
              const Divider(height: 1, indent: 56),
              _MenuTile(icon: Icons.print_outlined, title: '小票打印机', onTap: () => context.push('/printer')),
              const Divider(height: 1, indent: 56),
              _MenuTile(icon: Icons.people_outline_rounded, title: '客户（欠款/对账）', onTap: () => context.push('/customers')),
              const Divider(height: 1, indent: 56),
              _MenuTile(icon: Icons.storefront_outlined, title: '供应商管理', onTap: () => _suppliers(context, ref)),
              const Divider(height: 1, indent: 56),
              _MenuTile(icon: Icons.mic_none_rounded, title: 'AI 口述记账', onTap: () => context.push('/voice-entry')),
              if (isAdmin) ...[
                const Divider(height: 1, indent: 56),
                _MenuTile(icon: Icons.auto_awesome, title: 'AI 问生意', onTap: () => context.push('/ask')),
                const Divider(height: 1, indent: 56),
                _MenuTile(icon: Icons.badge_outlined, title: '员工管理', onTap: () => context.push('/staff')),
              ],
            ]),
          ),
          const SizedBox(height: 16),
          // 诚实承诺 + 数据导出（导出仅老板）
          SoftCard(
            padding: EdgeInsets.zero,
            child: Column(children: [
              if (isAdmin) ...[
                _MenuTile(icon: Icons.download_rounded, title: '导出全部数据（永远免费）', onTap: () => _exportAll(context)),
                const Divider(height: 1, indent: 56),
              ],
              _MenuTile(icon: Icons.verified_outlined, title: '我们的承诺', onTap: () => _promise(context)),
              const Divider(height: 1, indent: 56),
              _MenuTile(icon: Icons.privacy_tip_outlined, title: '隐私政策', onTap: () => openLegal(privacyUrl)),
              const Divider(height: 1, indent: 56),
              _MenuTile(icon: Icons.description_outlined, title: '用户协议', onTap: () => openLegal(termsUrl)),
              const Divider(height: 1, indent: 56),
              _MenuTile(icon: Icons.help_outline_rounded, title: '帮助与联系我们', onTap: () => openLegal(supportUrl)),
              const Divider(height: 1, indent: 56),
              _MenuTile(icon: Icons.info_outline_rounded, title: '关于智存', onTap: () => context.push('/about')),
            ]),
          ),
          const SizedBox(height: 16),
          SoftCard(
            padding: EdgeInsets.zero,
            child: Column(children: [
              _MenuTile(
                icon: Icons.logout_rounded,
                title: '退出登录',
                color: AppColors.error,
                onTap: () => ref.read(authProvider.notifier).logout(),
              ),
              const Divider(height: 1, indent: 56),
              // App Store 5.1.1(v)：有注册就必须能在 app 内删号
              _MenuTile(
                icon: Icons.delete_forever_outlined,
                title: '删除账号',
                color: AppColors.error,
                onTap: () => _deleteAccount(context, ref),
              ),
            ]),
          ),
        ],
      ),
    );
  }

  /// 删除账号：两步确认（说明后果 → 手输「删除」），成功后清 token 回登录页
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

  /// 改店名（店铺级设置：员工开单的票据抬头也用这个）
  Future<void> _editShopName(BuildContext context, WidgetRef ref, String current) async {
    final name = TextEditingController(text: current);
    final ok = await showDialog<bool>(
      context: context,
      builder: (dctx) => AlertDialog(
        title: const Text('修改店名'),
        content: TextField(controller: name, autofocus: true, decoration: const InputDecoration(hintText: '店名（票据抬头用）')),
        actions: [
          TextButton(onPressed: () => Navigator.pop(dctx, false), child: const Text('取消')),
          TextButton(onPressed: () => Navigator.pop(dctx, true), child: const Text('保存')),
        ],
      ),
    );
    if (ok != true || name.text.trim().isEmpty) return;
    try {
      await Api.I.put('/settings/shop-name', data: {'shopName': name.text.trim()});
      ref.invalidate(profileProvider);
      if (context.mounted) ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('✓ 店名已更新')));
    } catch (e) {
      if (context.mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text('$e')));
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
          TextField(controller: oldPwd, obscureText: true, decoration: const InputDecoration(hintText: '原密码')),
          const SizedBox(height: 10),
          TextField(controller: newPwd, obscureText: true, decoration: const InputDecoration(hintText: '新密码（至少6位）')),
          const SizedBox(height: 10),
          TextField(controller: confirm, obscureText: true, decoration: const InputDecoration(hintText: '确认新密码')),
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

  /// 数据导出：Excel表格(CSV,人看的) / JSON(完整备份,迁移用)
  Future<void> _exportAll(BuildContext context) async {
    final choice = await showModalBottomSheet<String>(
      context: context,
      builder: (ctx) => SafeArea(
        child: Padding(
          padding: const EdgeInsets.all(20),
          child: Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.start, children: [
            Text('导出全部数据', style: Theme.of(ctx).textTheme.headlineMedium),
            const SizedBox(height: 12),
            ListTile(
              leading: const Icon(Icons.table_chart_outlined, color: AppColors.primary),
              title: const Text('Excel 表格（推荐）'),
              subtitle: const Text('商品库存/销售/进货/客户/流水 6 张表，Excel/WPS 直接打开', style: TextStyle(fontSize: 12)),
              onTap: () => Navigator.pop(ctx, 'csv'),
            ),
            ListTile(
              leading: const Icon(Icons.data_object_rounded, color: AppColors.primary),
              title: const Text('完整备份（JSON）'),
              subtitle: const Text('机器可读的全量备份，换系统迁移用', style: TextStyle(fontSize: 12)),
              onTap: () => Navigator.pop(ctx, 'json'),
            ),
          ]),
        ),
      ),
    );
    if (choice == null || !context.mounted) return;

    final messenger = ScaffoldMessenger.of(context);
    messenger.showSnackBar(const SnackBar(content: Text('正在打包全部数据…')));
    try {
      final data = await Api.I.get('/export/all');
      final dir = await getTemporaryDirectory();
      final stamp = DateFormat('yyyyMMdd_HHmm').format(DateTime.now());

      if (choice == 'json') {
        final file = File('${dir.path}/StockMate完整备份_$stamp.json');
        await file.writeAsString(const JsonEncoder.withIndent('  ').convert(data));
        if (context.mounted) await shareFiles(context, [XFile(file.path)], text: 'StockMate 完整备份');
        return;
      }

      // CSV：6 张表，带 BOM 让 Excel 正确识别中文
      final files = <XFile>[];
      Future<void> writeCsv(String name, List<List<dynamic>> rows) async {
        final csv = '﻿${rows.map((r) => r.map(_csvCell).join(',')).join('\n')}';
        final f = File('${dir.path}/$name-$stamp.csv');
        await f.writeAsString(csv);
        files.add(XFile(f.path));
      }

      final d = data['数据'];
      final typeById = {for (final t in d['品类']) t['id']: t['name']};
      final productById = {for (final p in d['商品']) p['id']: p};
      final invBySku = {for (final i in d['库存']) i['skuId']: i};
      final customerById = {for (final c in d['客户']) c['id']: c['name']};
      final supplierById = {for (final s in d['供应商']) s['id']: s['name']};

      await writeCsv('商品库存', [
        ['品类', '商品', '规格', '单位', '售价', '成本价', '条码', '当前库存', '预警线'],
        for (final s in d['规格'])
          if (s['status'] == 1)
            [
              typeById[productById[s['productId']]?['productTypeId']] ?? '',
              productById[s['productId']]?['name'] ?? '',
              s['specText'] ?? '',
              productById[s['productId']]?['unit'] ?? '',
              s['price'], s['costPrice'] ?? '', s['barcode'] ?? '',
              invBySku[s['id']]?['quantity'] ?? 0, invBySku[s['id']]?['minQuantity'] ?? 0,
            ],
      ]);
      await writeCsv('销售单明细', [
        ['单号', '日期', '客户', '状态', '商品', '规格', '数量', '已退', '单价', '小计', '单据应收', '单据已收', '结算方式'],
        for (final o in d['销售单'])
          for (final it in o['items'] ?? [])
            [
              o['orderNo'], (o['createdAt'] ?? '').toString().substring(0, 16).replaceAll('T', ' '),
              customerById[o['customerId']] ?? '', o['status'] == 'completed' ? '已完成' : '已取消',
              it['productName'], it['specText'] ?? '', it['quantity'], it['returnedQty'] ?? 0,
              it['unitPrice'], it['subtotal'], o['actualAmount'], o['paidAmount'], o['settlementAccount'] ?? '',
            ],
      ]);
      await writeCsv('进货单明细', [
        ['单号', '日期', '供应商', '商品', '规格', '数量', '已退', '进价', '小计', '单据应付', '单据已付'],
        for (final o in d['进货单'])
          for (final it in o['items'] ?? [])
            [
              o['orderNo'], (o['createdAt'] ?? '').toString().substring(0, 16).replaceAll('T', ' '),
              supplierById[o['supplierId']] ?? '', it['productName'], it['specText'] ?? '',
              it['quantity'], it['returnedQty'] ?? 0, it['unitPrice'], it['subtotal'], o['actualAmount'], o['paidAmount'],
            ],
      ]);
      await writeCsv('客户', [
        ['名称', '联系人', '电话', '地址', '备注'],
        for (final c in d['客户']) [c['name'], c['contactPerson'] ?? '', c['phone'] ?? '', c['address'] ?? '', c['notes'] ?? ''],
      ]);
      await writeCsv('供应商', [
        ['名称', '联系人', '电话', '地址', '备注'],
        for (final s in d['供应商']) [s['name'], s['contactPerson'] ?? '', s['phone'] ?? '', s['address'] ?? '', s['notes'] ?? ''],
      ]);
      await writeCsv('收支流水', [
        ['时间', '类型', '金额', '方式', '备注'],
        for (final p in d['收付款流水'])
          [(p['paidAt'] ?? '').toString().substring(0, 16).replaceAll('T', ' '), p['direction'] == 'in' ? '收款' : '付款', p['amount'], p['account'] ?? '', p['note'] ?? ''],
        for (final i in d['收入'])
          [(i['incomeDate'] ?? '').toString().substring(0, 16).replaceAll('T', ' '), '收入', i['amount'], '', '${i['source']}${i['note'] != null ? '(${i['note']})' : ''}'],
        for (final e in d['支出'])
          [(e['expenseDate'] ?? '').toString().substring(0, 16).replaceAll('T', ' '), '支出', e['amount'], '', '${e['category']}${e['note'] != null ? '(${e['note']})' : ''}'],
      ]);

      if (context.mounted) await shareFiles(context, files, text: 'StockMate 数据导出（6张表）');
    } catch (e) {
      messenger.showSnackBar(SnackBar(content: Text('导出失败：$e')));
    }
  }

  /// CSV 单元格转义（含逗号/引号/换行的加引号包裹）
  static String _csvCell(dynamic v) {
    final s = (v ?? '').toString();
    if (s.contains(',') || s.contains('"') || s.contains('\n')) {
      return '"${s.replaceAll('"', '""')}"';
    }
    return s;
  }

  /// 诚实承诺
  void _promise(BuildContext context) {
    showDialog(
      context: context,
      builder: (dctx) => AlertDialog(
        title: const Text('我们的承诺'),
        content: const Text(
          '1. 基础进销存功能免费，不限单据数量，免费额度永不回收。\n\n'
          '2. 数据是你的：随时一键导出全部数据，永远免费，绝不锁数据。\n\n'
          '3. 只对 AI 能力收费（未来），一档全包，不按模块拆卖。',
          style: TextStyle(height: 1.6),
        ),
        actions: [TextButton(onPressed: () => Navigator.pop(dctx), child: const Text('好'))],
      ),
    );
  }

  /// 供应商管理（列表+新增）
  Future<void> _suppliers(BuildContext context, WidgetRef ref) async {
    await showModalBottomSheet(
      context: context,
      isScrollControlled: true,
      builder: (ctx) => SafeArea(
        child: SizedBox(
          height: MediaQuery.of(ctx).size.height * 0.75,
          child: Consumer(builder: (ctx, ref, _) {
            final suppliers = ref.watch(suppliersProvider);
            return Padding(
              padding: const EdgeInsets.all(20),
              child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                Row(children: [
                  Expanded(child: Text('供应商', style: Theme.of(ctx).textTheme.headlineMedium)),
                  IconButton(
                    icon: const Icon(Icons.add_circle_rounded, color: AppColors.primary, size: 28),
                    onPressed: () async {
                      final name = TextEditingController();
                      final phone = TextEditingController();
                      final ok = await showDialog<bool>(
                        context: ctx,
                        builder: (dctx) => AlertDialog(
                          title: const Text('新供应商'),
                          content: Column(mainAxisSize: MainAxisSize.min, children: [
                            TextField(controller: name, decoration: const InputDecoration(hintText: '供应商名称')),
                            const SizedBox(height: 10),
                            TextField(controller: phone, decoration: const InputDecoration(hintText: '电话（选填）')),
                          ]),
                          actions: [
                            TextButton(onPressed: () => Navigator.pop(dctx, false), child: const Text('取消')),
                            TextButton(onPressed: () => Navigator.pop(dctx, true), child: const Text('保存')),
                          ],
                        ),
                      );
                      if (ok == true && name.text.trim().isNotEmpty) {
                        await Api.I.post('/suppliers', data: {
                          'name': name.text.trim(),
                          if (phone.text.trim().isNotEmpty) 'phone': phone.text.trim(),
                        });
                        ref.invalidate(suppliersProvider);
                      }
                    },
                  ),
                ]),
                Expanded(
                  child: suppliers.when(
                    loading: () => const Center(child: CircularProgressIndicator()),
                    error: (e, _) => Text('$e'),
                    data: (list) => list.isEmpty
                        ? const Center(child: Text('还没有供应商，点右上角 + 添加'))
                        : ListView(children: [
                            for (final s in list)
                              ListTile(
                                leading: CircleAvatar(
                                  backgroundColor: AppColors.primaryFixed,
                                  child: Text(s.name.characters.first, style: const TextStyle(color: AppColors.primary)),
                                ),
                                title: Text(s.name),
                                subtitle: s.phone == null ? null : Text(s.phone!),
                              ),
                          ]),
                  ),
                ),
              ]),
            );
          }),
        ),
      ),
    );
  }

}

class _MenuTile extends StatelessWidget {
  final IconData icon;
  final String title;
  final VoidCallback onTap;
  final Color? color;
  const _MenuTile({required this.icon, required this.title, required this.onTap, this.color});

  @override
  Widget build(BuildContext context) {
    return ListTile(
      leading: Icon(icon, color: color ?? AppColors.primary),
      title: Text(title, style: TextStyle(fontWeight: FontWeight.w600, color: color)),
      trailing: const Icon(Icons.chevron_right_rounded, color: AppColors.onSurfaceVariant),
      onTap: onTap,
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(kRadiusCard)),
    );
  }
}
