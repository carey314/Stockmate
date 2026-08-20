import 'dart:async';

import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:in_app_purchase/in_app_purchase.dart';
import 'package:url_launcher/url_launcher.dart';

import '../../core/api.dart';
import '../../core/legal.dart';
import '../../core/providers.dart';
import '../../core/theme.dart';

/// 专业版订阅页。
///
/// 版式的取舍（2026-08-16 重做，原版是两张灰白卡平铺，没有视觉重心也没有价格锚点）：
/// 顶部先用**用户自己的真实数据**说话，再给价格。顺序很重要——
/// 上来就摆价格，用户第一反应是"我为什么要花这个钱"；
/// 先让他看见 AI 到底帮他省了什么，价格才有参照物。
///
/// hero 说的是「省了多少时间」而不是「用了多少次 / 够不够用」。
/// 中间试过后者，问题是没撞过额度墙的轻度用户会看到一句"目前还够用"——
/// 订阅页把最大的版面拿来劝人别买，很尴尬。省下的时间任何用量都是正数，不自相矛盾。
/// 用量为 0 的新用户连这块都不显示（没有数据就不编数据），直接落到价值说明。
///
/// 苹果对订阅页的**硬性要求**，缺一样就拒（3.1.2）：
///   1. 订阅名称、时长、价格购买前明示  2. 必须能恢复购买
///   3. 隐私政策 + 用户协议链接        4. 说清自动续期和怎么取消
/// 另外**绝不能**出现站外购买引导（反导流红线），所以这页只有 IAP 一条路。
class ProScreen extends ConsumerStatefulWidget {
  const ProScreen({super.key});

  @override
  ConsumerState<ProScreen> createState() => _ProScreenState();
}

/// 与 App Store Connect 里创建的商品 ID 必须**一字不差**，
/// 后端 PRODUCT_TO_PLAN 也用同样的 ID 映射权益档位。
const kMonthlyId = 'com.carey.stockmate.pro.monthly';
const kYearlyId = 'com.carey.stockmate.pro.yearly';

/// 只为在本地看版式用：App Store Connect 的商品建好之前，
/// queryProductDetails 一定返回空，这页就永远只能看到「订阅暂时不可用」。
/// 用 `--dart-define=IAP_PREVIEW=true` 塞两个假商品把版式撑出来。
/// **必须写 =true**：bool.fromEnvironment 只认字面量 "true"，写 =1 会被当成 false
/// 静默失效（吃过一次亏：断言块整个被跳过，测试还报 All tests passed）。
///
/// **同时卡 kDebugMode**，release 包里这个分支根本不存在——
/// 只靠 dart-define 的话，哪天打包手滑带上这个参数，用户看到的就是假价格。
const _kPreviewIap = kDebugMode && bool.fromEnvironment('IAP_PREVIEW');

/// 手动记一笔账的耗时估算。**这是估的，不是实测出来的。**
/// 所以页面上必须把口径写出来（"按手动开一单约 40 秒估算"），
/// 让用户自己判断这个数字可不可信——省下来的时间是拿来劝人掏钱的，
/// 藏着口径就成了拿假数字忽悠人。
///
/// 取 40 秒是保守值：手动开一单要选客户、搜商品、填数量、填单价、提交，
/// 五步在手机上快不到哪去。以后真做了用户计时，把这个常数换成实测值即可。
const _kSecondsPerManualEntry = 40;

/// 秒 → 人话。小于 1 分钟说秒，超过 90 分钟说小时，中间说分钟。
@visibleForTesting
String fmtSaved(int seconds) {
  if (seconds < 60) return '$seconds 秒';
  final m = seconds ~/ 60;
  if (m < 90) return '$m 分钟';
  final h = m ~/ 60, rest = m % 60;
  return rest == 0 ? '$h 小时' : '$h 小时 $rest 分';
}

List<ProductDetails> _previewProducts() => [
      ProductDetails(
        id: kMonthlyId, title: '专业版 · 月付', description: '',
        price: '¥19.00', rawPrice: 19, currencyCode: 'CNY', currencySymbol: '¥',
      ),
      ProductDetails(
        id: kYearlyId, title: '专业版 · 年付', description: '',
        price: '¥168.00', rawPrice: 168, currencyCode: 'CNY', currencySymbol: '¥',
      ),
    ];

class _ProScreenState extends ConsumerState<ProScreen> {
  final _iap = InAppPurchase.instance;
  StreamSubscription<List<PurchaseDetails>>? _sub;
  List<ProductDetails> _products = [];
  bool _loading = true;
  bool _busy = false;
  String? _error;

  /// 默认选中年付。**这不是暗黑模式套路**——年付确实更便宜，
  /// 而且两张卡都摆在眼前、按钮上写着选中的是哪个，用户改一下就是一次点击。
  String _selectedId = kYearlyId;

  @override
  void initState() {
    super.initState();
    // 先订阅再拉商品：purchaseStream 会重放未完成的交易
    //（上次买到一半被杀进程、或苹果补发的续期），漏订阅就会丢单
    _sub = _iap.purchaseStream.listen(_onPurchases, onError: (e) {
      if (mounted) setState(() => _error = '$e');
    });
    _load();
  }

  @override
  void dispose() {
    _sub?.cancel();
    super.dispose();
  }

  Future<void> _load() async {
    if (_kPreviewIap) {
      setState(() { _products = _previewProducts(); _loading = false; _error = null; });
      return;
    }
    if (mounted) setState(() { _loading = true; _error = null; });
    try {
      if (!await _iap.isAvailable()) {
        if (mounted) setState(() { _loading = false; _error = '这台设备不支持 App 内购买'; });
        return;
      }
      final r = await _iap.queryProductDetails({kMonthlyId, kYearlyId});
      if (!mounted) return;
      setState(() {
        _products = r.productDetails..sort((a, b) => a.rawPrice.compareTo(b.rawPrice));
        _loading = false;
        if (_products.isEmpty) _error = '暂时取不到订阅信息，可能是网络不通。你现在可以继续免费使用。';
      });
    } catch (e) {
      if (mounted) setState(() { _loading = false; _error = '$e'; });
    }
  }

  /// 交易回调。**必须对每一笔调 completePurchase**，否则苹果会一直重发，
  /// 用户下次打开还会看到扣款弹窗。
  Future<void> _onPurchases(List<PurchaseDetails> list) async {
    for (final p in list) {
      if (p.status == PurchaseStatus.pending) continue;
      if (p.status == PurchaseStatus.error) {
        if (mounted) setState(() { _busy = false; _error = p.error?.message ?? '购买失败'; });
      } else if (p.status == PurchaseStatus.purchased || p.status == PurchaseStatus.restored) {
        await _redeem(p);
      } else if (p.status == PurchaseStatus.canceled) {
        if (mounted) setState(() => _busy = false);
      }
      if (p.pendingCompletePurchase) await _iap.completePurchase(p);
    }
  }

  /// 收据送到自己的服务端校验换权益。
  /// **不能**信客户端的 status 直接放权——那等于谁改个包都能白嫖。
  Future<void> _redeem(PurchaseDetails p) async {
    try {
      await Api.I.post('/me/entitlement/apple', data: {
        'receipt': p.verificationData.serverVerificationData,
      });
      ref.invalidate(entitlementProvider);
      if (!mounted) return;
      setState(() { _busy = false; _error = null; });
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('✓ 专业版已开通，AI 额度已放开')),
      );
    } catch (e) {
      if (mounted) {
        setState(() {
          _busy = false;
          _error = '开通失败：$e。钱已经扣了的话，点「恢复购买」重试即可，不会重复扣费';
        });
      }
    }
  }

  Future<void> _buy(ProductDetails p) async {
    setState(() { _busy = true; _error = null; });
    await _iap.buyNonConsumable(purchaseParam: PurchaseParam(productDetails: p));
  }

  Future<void> _restore() async {
    setState(() { _busy = true; _error = null; });
    await _iap.restorePurchases();
    Future.delayed(const Duration(seconds: 4), () {
      if (mounted && _busy) setState(() => _busy = false);
    });
  }

  ProductDetails? get _monthly => _products.where((p) => p.id == kMonthlyId).firstOrNull;
  ProductDetails? get _yearly => _products.where((p) => p.id == kYearlyId).firstOrNull;

  /// 年付比按月买省多少。**用苹果返回的真实价格算**，不写死——
  /// 各地区价格档不同，写死的百分比必然有地方对不上。
  int? get _yearlySavePercent {
    final m = _monthly, y = _yearly;
    if (m == null || y == null || m.rawPrice <= 0) return null;
    final save = (1 - y.rawPrice / (m.rawPrice * 12)) * 100;
    return save > 3 ? save.round() : null; // 省得太少就不吹
  }

  @override
  Widget build(BuildContext context) {
    final t = Theme.of(context).textTheme;
    final ent = ref.watch(entitlementProvider).valueOrNull;
    final isPro = ent != null && ent['plan'] != null && ent['plan'] != 'free';

    return Scaffold(
      appBar: AppBar(title: const Text('专业版')),
      body: ListView(
        padding: const EdgeInsets.fromLTRB(kPagePadding, 4, kPagePadding, 32),
        children: [
          if (isPro) _proStatus(t, ent) else ...[
            _usageHero(t, ent),
            const SizedBox(height: 14),
            _priceRow(t),
            if (_products.isNotEmpty) ...[
              const SizedBox(height: 12),
              _cta(t),
            ],
            if (_error != null) ...[
              const SizedBox(height: 12),
              _errorCard(t),
            ],
            const SizedBox(height: 16),
            _benefits(t),
          ],
          const SizedBox(height: 18),
          // 苹果要求：必须能恢复已购
          Center(
            child: TextButton(
              onPressed: _busy ? null : _restore,
              child: Text(_busy ? '处理中…' : '恢复购买'),
            ),
          ),
          // 苹果要求：自动续期规则写清楚
          Text(
            '订阅说明：付款后由 Apple 账户扣费。订阅到期前 24 小时内会自动续期并扣费，'
            '除非在到期前 24 小时以上关闭自动续订。开通后可随时在 iPhone'
            '「设置 → Apple 账户 → 订阅」中管理或取消。',
            style: t.bodyMedium?.copyWith(fontSize: 11),
          ),
          const SizedBox(height: 6),
          Row(mainAxisAlignment: MainAxisAlignment.center, children: [
            TextButton(
              onPressed: () => launchUrl(Uri.parse(termsUrl), mode: LaunchMode.externalApplication),
              child: const Text('用户协议', style: TextStyle(fontSize: 12)),
            ),
            const Text('·', style: TextStyle(color: AppColors.outlineVariant)),
            TextButton(
              onPressed: () => launchUrl(Uri.parse(privacyUrl), mode: LaunchMode.externalApplication),
              child: const Text('隐私政策', style: TextStyle(fontSize: 12)),
            ),
          ]),
        ],
      ),
    );
  }

  // ===== 已订阅状态 =====
  Widget _proStatus(TextTheme t, Map<String, dynamic> ent) {
    final expires = ent['expiresAt'] as String?;
    return SoftCard(
      child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
        Row(children: [
          const Icon(Icons.verified_rounded, color: AppColors.success, size: 22),
          const SizedBox(width: 8),
          Text('专业版使用中', style: t.titleLarge),
        ]),
        if (expires != null) ...[
          const SizedBox(height: 8),
          Text('有效期至 ${expires.substring(0, 10)}', style: t.bodyMedium?.copyWith(fontSize: 13)),
        ],
        const SizedBox(height: 8),
        Text('AI 口述记账不限次，AI 问生意每天 50 次。', style: t.bodyMedium?.copyWith(fontSize: 13)),
      ]),
    );
  }

  // ===== 用量 hero：说「省了多少时间」，不说「够不够用」 =====
  //
  // 上一版这里是「你这个月用 AI 记了 64 笔账」+ 进度条，没撞过额度墙的人
  // 底下会看到一句「目前还够用」——订阅页把最大的版面拿来劝人别买，很尴尬。
  // 改成省下的时间后，任何用量都是正面数字，不会自相矛盾。
  //
  // 「撞墙 N 天」那句保留，但降级成 hero 下面的附加行，且**只在真撞过墙时出现**。
  // 它是全页唯一真实的痛点信号，丢掉可惜；轻度用户压根看不到它，也就不存在劝退。
  Widget _usageHero(TextTheme t, Map<String, dynamic>? ent) {
    final used = (ent?['aiUsedThisMonth'] as int?) ?? 0;
    final hitDays = (ent?['daysHitLimitThisMonth'] as int?) ?? 0;
    final today = ent?['today'] as Map<String, dynamic>?;
    final limit = (today?['coreLimit'] as int?) ?? 0;

    // 新用户没有用量数据。**不编数字**——直接讲价值，等他用出数据再说。
    if (used <= 0) {
      return SoftCard(
        child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          Text('说一句话就记完一笔账', style: t.headlineMedium),
          const SizedBox(height: 8),
          Text('免费版每天能这么记 ${limit > 0 ? limit : 8} 次，够绝大多数小店用。\n'
              '货多单多、一天要记十几二十笔的，才需要专业版。',
              style: t.bodyMedium?.copyWith(fontSize: 13)),
        ]),
      );
    }

    final saved = fmtSaved(used * _kSecondsPerManualEntry);
    return SoftCard(
      child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
        Text('AI 帮你省了', style: t.bodyMedium?.copyWith(fontSize: 13)),
        const SizedBox(height: 2),
        FittedBox(
          fit: BoxFit.scaleDown,
          alignment: Alignment.centerLeft,
          child: Text(saved,
              maxLines: 1,
              style: const TextStyle(
                  fontSize: 44, fontWeight: FontWeight.w800,
                  color: AppColors.primary, height: 1.15)),
        ),
        const SizedBox(height: 8),
        Text('这个月 $used 笔账，一笔笔手打大概要 $saved，你说一句就完了。',
            style: t.bodyMedium?.copyWith(fontSize: 13)),
        const SizedBox(height: 4),
        // 口径必须写在脸上。这是估算不是实测，藏起来就成了拿假数字劝人掏钱。
        Text('按手动开一单约 $_kSecondsPerManualEntry 秒估算',
            style: t.bodyMedium?.copyWith(fontSize: 11)),
        if (hitDays > 0) ...[
          const SizedBox(height: 12),
          ClipRRect(
            borderRadius: BorderRadius.circular(6),
            child: LinearProgressIndicator(
              value: limit > 0 ? (used / (limit * 30.0)).clamp(0.0, 1.0) : 0.0,
              minHeight: 8,
              backgroundColor: AppColors.surfaceContainer,
              valueColor: const AlwaysStoppedAnimation(AppColors.warning),
            ),
          ),
          const SizedBox(height: 8),
          Text('其中有 $hitDays 天把当天的 $limit 次用完了，剩下的只能手动记。',
              style: const TextStyle(
                  fontSize: 13, fontWeight: FontWeight.w600, color: AppColors.warning)),
        ],
      ]),
    );
  }

  // ===== 价格：两张并排，年付带省多少 =====
  Widget _priceRow(TextTheme t) {
    if (_loading) {
      return const Padding(padding: EdgeInsets.all(28), child: Center(child: CircularProgressIndicator()));
    }
    if (_products.isEmpty) return const SizedBox.shrink();
    return IntrinsicHeight(
      child: Row(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
        if (_monthly != null)
          Expanded(child: _priceCard(t, _monthly!, '按月', null)),
        if (_monthly != null && _yearly != null) const SizedBox(width: 10),
        if (_yearly != null)
          Expanded(child: _priceCard(t, _yearly!, '按年', _yearlySavePercent)),
      ]),
    );
  }

  /// 一张卡 = 一个选项，**点它只是选中，不直接掏钱**。
  /// 老式做法是点卡片就弹苹果付款框，对 50 多岁的摊主来说等于误触扣款。
  /// 选完再按下面那个大按钮，多一步，但心里有数。
  Widget _priceCard(TextTheme t, ProductDetails p, String period, int? save) {
    final on = _selectedId == p.id;
    return GestureDetector(
      onTap: _busy ? null : () => setState(() => _selectedId = p.id),
      child: AnimatedContainer(
        duration: const Duration(milliseconds: 140),
        padding: const EdgeInsets.fromLTRB(12, 14, 12, 14),
        decoration: BoxDecoration(
          color: on ? AppColors.primary.withValues(alpha: 0.06) : AppColors.surfaceLowest,
          borderRadius: BorderRadius.circular(kRadiusCard),
          border: Border.all(
            color: on ? AppColors.primary : AppColors.outlineVariant,
            width: on ? 2 : 1,
          ),
        ),
        child: Column(mainAxisAlignment: MainAxisAlignment.center, children: [
          Row(mainAxisAlignment: MainAxisAlignment.center, children: [
            Icon(on ? Icons.radio_button_checked : Icons.radio_button_unchecked,
                size: 15, color: on ? AppColors.primary : AppColors.outlineVariant),
            const SizedBox(width: 5),
            Text(period,
                style: TextStyle(
                    fontSize: 13,
                    fontWeight: FontWeight.w600,
                    color: on ? AppColors.primary : AppColors.onSurfaceVariant)),
          ]),
          const SizedBox(height: 8),
          // 价格一律用苹果返回的本地化字符串，绝不写死
          FittedBox(
            fit: BoxFit.scaleDown,
            child: Text(p.price,
                maxLines: 1,
                style: const TextStyle(
                    fontSize: 26, fontWeight: FontWeight.w800, color: AppColors.onSurface)),
          ),
          const SizedBox(height: 4),
          // 年付摊到每月是多少——摊主真正会拿来比的就是这个数
          Text(_perMonthLabel(p),
              style: t.bodyMedium?.copyWith(fontSize: 11), textAlign: TextAlign.center),
          if (save != null) ...[
            const SizedBox(height: 8),
            Container(
              padding: const EdgeInsets.symmetric(horizontal: 9, vertical: 3),
              decoration: BoxDecoration(
                color: AppColors.success.withValues(alpha: 0.12),
                borderRadius: BorderRadius.circular(20),
              ),
              child: Text('省 $save%',
                  style: const TextStyle(
                      fontSize: 11, fontWeight: FontWeight.w700, color: AppColors.success)),
            ),
          ],
        ]),
      ),
    );
  }

  /// 「¥14 / 月」这种。年付卡上换算，月付卡上直接说每天几毛，
  /// 因为一天六毛比一个月十九块更容易被接受。
  String _perMonthLabel(ProductDetails p) {
    final sym = p.currencySymbol;
    if (p.id == kYearlyId) {
      return '折合 $sym${(p.rawPrice / 12).toStringAsFixed(0)} / 月';
    }
    final perDay = p.rawPrice / 30;
    return '约 $sym${perDay.toStringAsFixed(1)} / 天';
  }

  /// 唯一的付款入口。按钮上必须写清「买的是哪个 + 多少钱」，
  /// 苹果 3.1.2 要求购买前明示，用户也不该在按下去之后才知道扣多少。
  Widget _cta(TextTheme t) {
    final p = _products.where((x) => x.id == _selectedId).firstOrNull ?? _products.first;
    final period = p.id == kYearlyId ? '年' : '月';
    return SizedBox(
      width: double.infinity,
      height: 52,
      child: FilledButton(
        onPressed: _busy ? null : () => _buy(p),
        style: FilledButton.styleFrom(
          backgroundColor: AppColors.primary,
          shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(kRadiusCard)),
        ),
        child: _busy
            ? const SizedBox(
                width: 20, height: 20,
                child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white))
            : FittedBox(
                fit: BoxFit.scaleDown,
                child: Text('开通专业版 · ${p.price} / $period',
                    maxLines: 1,
                    style: const TextStyle(
                        fontSize: 16, fontWeight: FontWeight.w700, color: Colors.white)),
              ),
      ),
    );
  }

  /// 取不到商品 / 付款失败时的样子。
  /// 原来这里是一行裸红字贴在背景上，看着像崩了。用户看到的第一反应
  /// 应该是「哦，重试一下」，而不是「这软件坏了，钱别给它」。
  Widget _errorCard(TextTheme t) {
    return Container(
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(
        color: AppColors.surfaceLowest,
        borderRadius: BorderRadius.circular(kRadiusCard),
        border: Border.all(color: AppColors.outlineVariant),
      ),
      child: Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
        const Icon(Icons.info_outline_rounded, size: 18, color: AppColors.onSurfaceVariant),
        const SizedBox(width: 8),
        Expanded(
          child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            Text('订阅暂时不可用', style: t.titleMedium?.copyWith(fontSize: 14)),
            const SizedBox(height: 4),
            Text(_error!, style: t.bodyMedium?.copyWith(fontSize: 12)),
            const SizedBox(height: 4),
            Align(
              alignment: Alignment.centerLeft,
              child: TextButton(
                onPressed: _busy ? null : _load,
                style: TextButton.styleFrom(
                  padding: EdgeInsets.zero,
                  minimumSize: const Size(0, 32),
                  tapTargetSize: MaterialTapTargetSize.shrinkWrap,
                ),
                child: const Text('重试', style: TextStyle(fontSize: 13)),
              ),
            ),
          ]),
        ),
      ]),
    );
  }

  // ===== 买了多什么 + 免费承诺 =====
  Widget _benefits(TextTheme t) {
    return SoftCard(
      child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
        Text('订阅之后', style: t.titleMedium),
        const SizedBox(height: 10),
        _plus('AI 口述记账 不限次（每天 100 次防滥用上限）'),
        _plus('AI 问生意 / 生成商品 每天 50 次'),
        const SizedBox(height: 12),
        Container(height: 1, color: AppColors.outlineVariant.withValues(alpha: 0.4)),
        const SizedBox(height: 12),
        Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
          const Icon(Icons.lock_open_rounded, size: 15, color: AppColors.success),
          const SizedBox(width: 6),
          Expanded(
            child: Text(
              '开单、进货、库存、欠款、报表、对账、打印、导出——'
              '这些记账功能永久免费，不会变成收费项，数据也随时能全量导出。',
              style: t.bodyMedium?.copyWith(fontSize: 12),
            ),
          ),
        ]),
      ]),
    );
  }

  Widget _plus(String text) => Padding(
        padding: const EdgeInsets.only(bottom: 6),
        child: Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
          const Icon(Icons.add_rounded, size: 16, color: AppColors.primary),
          const SizedBox(width: 6),
          Expanded(child: Text(text, style: const TextStyle(fontSize: 13, fontWeight: FontWeight.w500))),
        ]),
      );
}
