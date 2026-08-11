import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import '../../core/api.dart';
import '../../core/providers.dart';
import '../../core/theme.dart';

/// 品类/模板管理（对应参考图「目录管理」屏）
class TypesScreen extends ConsumerWidget {
  const TypesScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final t = Theme.of(context).textTheme;
    final types = ref.watch(typesProvider);
    final mainTypeId = ref.watch(mainTypeIdProvider);
    final isAdmin = ref.watch(profileProvider).valueOrNull?['role'] == 'admin';

    return Scaffold(
      appBar: AppBar(title: const Text('品类管理')),
      floatingActionButton: FloatingActionButton(
        backgroundColor: AppColors.primary,
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(18)),
        onPressed: () => context.push('/types/new'),
        child: const Icon(Icons.add_rounded, color: Colors.white),
      ),
      body: RefreshIndicator(
        onRefresh: () async => ref.refresh(typesProvider.future),
        child: ListView(
          padding: const EdgeInsets.fromLTRB(kPagePadding, 8, kPagePadding, 100),
          children: [
            Text('品类管理', style: t.headlineLarge),
            const SizedBox(height: 4),
            Text('每种生意一套字段，商品录入表单跟着变', style: t.bodyMedium),
            const SizedBox(height: 4),
            Text('设一个★主营品类，商品页/开单/进货/盘点都会默认它', style: t.bodyMedium?.copyWith(fontSize: 12, color: AppColors.primary)),
            const SizedBox(height: 20),
            // AI 一键生成入口（参考图同款渐变卡）
            AiGradientCard(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Row(children: [
                    const Icon(Icons.auto_awesome, size: 18, color: AppColors.primary),
                    const SizedBox(width: 6),
                    Text('AI 智能辅助', style: t.labelMedium?.copyWith(color: AppColors.primary)),
                  ]),
                  const SizedBox(height: 10),
                  Text('一键生成新品类', style: t.headlineMedium),
                  const SizedBox(height: 6),
                  Text('说出你的生意（如"奶茶店物料"），AI 自动配好全套字段', style: t.bodyMedium),
                  const SizedBox(height: 16),
                  FilledButton.icon(
                    onPressed: () => _askTheme(context),
                    icon: const Icon(Icons.add_circle_outline, size: 20),
                    label: const Text('立即创建'),
                  ),
                ],
              ),
            ),
            const SizedBox(height: 20),
            types.when(
              loading: () => const Padding(padding: EdgeInsets.all(40), child: Center(child: CircularProgressIndicator())),
              error: (e, _) => SoftCard(child: Text('加载失败：$e')),
              data: (list) => Column(
                children: [
                  for (final type in list)
                    Padding(
                      padding: const EdgeInsets.only(bottom: 14),
                      child: SoftCard(
                        onTap: () => context.push('/types/${type.id}'),
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Row(
                              children: [
                                Expanded(child: Text(type.name, style: t.titleLarge)),
                                if (type.id == mainTypeId)
                                  Container(
                                    padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
                                    decoration: BoxDecoration(
                                      color: AppColors.primaryFixed,
                                      borderRadius: BorderRadius.circular(8),
                                    ),
                                    child: const Text('★ 主营',
                                        style: TextStyle(fontSize: 11, color: AppColors.primary, fontWeight: FontWeight.w600)),
                                  )
                                else if (type.isPreset)
                                  Text('预设', style: t.bodyMedium?.copyWith(fontSize: 11, color: AppColors.primary)),
                              ],
                            ),
                            const SizedBox(height: 4),
                            Text('包含字段 (${type.fields.length})', style: t.bodyMedium?.copyWith(fontSize: 12)),
                            const SizedBox(height: 10),
                            Wrap(
                              spacing: 8,
                              runSpacing: 8,
                              children: [for (final f in type.fields) Chip(label: Text(f.label))],
                            ),
                            const SizedBox(height: 10),
                            Row(children: [
                              Expanded(child: Text('${type.productCount} 件商品', style: t.bodyMedium?.copyWith(fontSize: 12))),
                              if (isAdmin)
                                TextButton.icon(
                                  onPressed: () => _setMainType(context, ref, type.id == mainTypeId ? null : type.id, type.name),
                                  icon: Icon(type.id == mainTypeId ? Icons.star_rounded : Icons.star_border_rounded, size: 18),
                                  label: Text(type.id == mainTypeId ? '取消主营' : '设为主营', style: const TextStyle(fontSize: 13)),
                                ),
                            ]),
                          ],
                        ),
                      ),
                    ),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }

  /// 设/取消主营品类（老板专属；全App默认筛选跟着变）
  Future<void> _setMainType(BuildContext context, WidgetRef ref, int? typeId, String name) async {
    try {
      await Api.I.put('/settings/main-type', data: {'productTypeId': typeId});
      ref.invalidate(profileProvider);
      if (context.mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text(typeId == null ? '已取消主营品类' : '✓ 「$name」设为主营，开单和商品页会默认显示它')),
        );
      }
    } catch (e) {
      if (context.mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text('$e')));
    }
  }

  /// 问用户主题 → 跳 AI 生成
  Future<void> _askTheme(BuildContext context) async {
    final controller = TextEditingController();
    final theme = await showModalBottomSheet<String>(
      context: context,
      isScrollControlled: true,
      builder: (ctx) => Padding(
        padding: EdgeInsets.fromLTRB(24, 24, 24, MediaQuery.of(ctx).viewInsets.bottom + 32),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text('你做的是什么生意？', style: Theme.of(ctx).textTheme.headlineMedium),
            const SizedBox(height: 8),
            Text('AI 会为它生成一套合适的商品字段', style: Theme.of(ctx).textTheme.bodyMedium),
            const SizedBox(height: 20),
            TextField(
              controller: controller,
              autofocus: true,
              decoration: const InputDecoration(hintText: '例如：奶茶店物料 / 五金店 / 宠物用品'),
              onSubmitted: (v) => Navigator.pop(ctx, v.trim()),
            ),
            const SizedBox(height: 20),
            FilledButton.icon(
              onPressed: () => Navigator.pop(ctx, controller.text.trim()),
              icon: const Icon(Icons.auto_awesome, size: 18),
              label: const Text('AI 生成字段'),
            ),
          ],
        ),
      ),
    );
    if (theme != null && theme.isNotEmpty && context.mounted) {
      context.push('/types/new?theme=${Uri.encodeComponent(theme)}');
    }
  }
}
