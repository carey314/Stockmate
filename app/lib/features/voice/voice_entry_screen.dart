import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'dart:async';

import 'package:speech_to_text/speech_to_text.dart' as stt;
import '../../core/api.dart';
import '../../core/pick_image.dart';
import '../../core/models.dart';
import '../../core/providers.dart';
import '../../core/theme.dart';

/// AI 口述记账 v2：进货 / 卖出 / 开销 三合一
/// - 卖出已建档商品 → 挂"散客"真实扣库存（正式销售单）
/// - 卖出未建档商品 → 只记收入（明确标注，不做假库存）
/// - AI 只出草案，确认前零落库；底部大按钮带汇总
/// 收款规则的完整解释。选项里只放结果（已收款/挂账/默认），规则收在 ⓘ 里，
/// 免得每个选项都拖一句长解释。文案与 Web 端一字不差。
const _kPaidRuleHint = '口述里没说收没收钱时：散客默认按已收款，记名客户默认记挂账（月结常态，防止把没收的钱记成收了）';

class VoiceEntryScreen extends ConsumerStatefulWidget {
  /// 语音事件时间线：集成测试诊断 + 真机排障用（同 isolate 直接读）
  static final List<String> debugEvents = [];
  static void logEvent(String e) {
    debugEvents.add(e);
    if (debugEvents.length > 50) debugEvents.removeAt(0); // 防无限增长
  }
  const VoiceEntryScreen({super.key});

  @override
  ConsumerState<VoiceEntryScreen> createState() => _VoiceEntryScreenState();
}

class _VoiceEntryScreenState extends ConsumerState<VoiceEntryScreen> {
  final _text = TextEditingController();
  final _speech = stt.SpeechToText();
  bool _speechReady = false; // 引擎只初始化一次
  bool _listening = false;
  DateTime? _listenStartAt; // 判定"刚开听就悄悄结束"用
  bool _parsing = false;
  bool _saving = false;
  double _soundLevel = 0; // 音量反馈
  ParseResult? _result;

  @override
  void initState() {
    super.initState();
    // 不在这里初始化语音引擎：那会让用户刚点开页面就被系统弹"想访问语音识别"，
    // 什么都还没干就要授权，很多人直接点不允许。改成点麦克风时才申请（_toggleListen 里已有懒初始化）
  }

  Future<void> _initSpeech() async {
    try {
      _speechReady = await _speech.initialize(
        onStatus: (s) {
          VoiceEntryScreen.logEvent('status=$s listening=$_listening textEmpty=${_text.text.isEmpty} elapsedMs=${_listenStartAt == null ? -1 : DateTime.now().difference(_listenStartAt!).inMilliseconds}');
          if ((s == 'done' || s == 'notListening') && mounted) {
            final wasListening = _listening;
            setState(() => _listening = false);
            // 模拟器第二种失败模式：listen 表面成功、无 onError，几秒后引擎悄悄死掉。
            // 特征 = 刚开听就结束且一个字没识别到（正常说话不可能）→ 说人话，别让"正在听"无解释地消失
            if (wasListening &&
                _text.text.isEmpty &&
                _listenStartAt != null &&
                DateTime.now().difference(_listenStartAt!) < const Duration(seconds: 5)) {
              _speechReady = false; // 引擎不可靠，下次点击重新初始化
              _toast('语音没启动成功（模拟器不支持语音，真机上正常）。先打字，或点输入框用键盘上的 🎤 说');
            }
          }
        },
        onError: (e) {
          VoiceEntryScreen.logEvent('error=${e.errorMsg} permanent=${e.permanent}');
          if (!mounted) return;
          // permanent 错误后插件必须重新 initialize 才能再用——
          // 否则下次 listen 静默无效且无回调，界面会卡死在"正在听"
          if (e.permanent) _speechReady = false;
          setState(() => _listening = false);
          // 把真实原因说人话
          final msg = switch (e.errorMsg) {
            'error_no_match' => '没听清，再说一次试试',
            'error_speech_timeout' => '没听到声音，检查麦克风',
            'error_network' => '语音识别需要网络，检查网络后重试',
            'error_listen_failed' ||
            'error_unknown' =>
              '这台设备的语音引擎启动不了（模拟器不支持，真机上正常）。先打字，或点输入框用键盘上的 🎤 说',
            _ => '语音识别出错（${e.errorMsg}），也可以点输入框用键盘上的 🎤 说',
          };
          ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(msg)));
        },
        // 权限弹窗等待中/模拟器引擎挂死时，initialize 可能永不返回——超时按不可用处理，
        // 用户授权后再点麦克风会重新走到这里（那时立即成功）
      ).timeout(const Duration(seconds: 6), onTimeout: () => false);
    } catch (_) {
      _speechReady = false;
    }
    VoiceEntryScreen.logEvent('init ready=$_speechReady');
    if (mounted) setState(() {});
  }

  // ===== 汇总 =====
  double get _purchaseTotal => _result?.purchases.fold(0.0, (s, i) => s! + (i.totalCost ?? 0)) ?? 0;
  double get _saleTotal => _result?.sales.fold(0.0, (s, i) => s! + i.effectiveAmount) ?? 0;
  double get _expenseTotal => _result?.expenses.fold(0.0, (s, e) => s! + e.amount) ?? 0;
  double get _aggregateTotal => _result?.aggregates.fold(0.0, (s, a) => s! + a.amount) ?? 0;
  bool get _hasStockIssue => _result?.sales.any((s) => s.stockInsufficient) ?? false;
  bool get _isEmpty =>
      _result == null ||
      (_result!.purchases.isEmpty && _result!.sales.isEmpty && _result!.expenses.isEmpty && _result!.aggregates.isEmpty);

  Future<void> _toggleListen() async {
    if (_listening) {
      // 先复位再 stop：stop 会触发 onStatus('notListening')，
      // 若届时 _listening 仍为 true 会被误判成"引擎没启动"而弹提示
      setState(() => _listening = false);
      await _speech.stop();
      return;
    }
    if (!_speechReady) {
      await _initSpeech(); // 再试一次（用户可能刚给了权限）
      if (!_speechReady) {
        _toast('本设备语音识别不可用（模拟器不支持，真机需允许麦克风+语音识别权限）。先打字，或点输入框用键盘上的 🎤 说');
        return;
      }
    }
    setState(() {
      _listening = true;
      _soundLevel = 0;
    });
    _listenStartAt = DateTime.now();
    // 不 await：模拟器/异常状态下 listen 可能永不返回，兜底校验必须独立于它执行
    unawaited(_speech.listen(
      listenOptions: stt.SpeechListenOptions(
        localeId: 'zh_CN',
        partialResults: true, // 边说边上屏
        listenMode: stt.ListenMode.dictation, // 长句听写模式
        pauseFor: const Duration(seconds: 8), // 说话中途想数量停顿，不轻易断
        listenFor: const Duration(seconds: 90), // 最长一口气说 90 秒
        cancelOnError: false,
      ),
      onSoundLevelChange: (level) {
        if (mounted && _listening) setState(() => _soundLevel = level.clamp(0, 10));
      },
      onResult: (r) => setState(() => _text.text = r.recognizedWords),
    ));
    // 兜底：listen 可能静默失败甚至挂起（不回调 onError）。独立校验引擎真的在听，
    // 没在听就复位界面，绝不让"正在听"卡死
    await Future.delayed(const Duration(milliseconds: 1200));
    VoiceEntryScreen.logEvent('fallback: listening=$_listening pluginListening=${_speech.isListening}');
    if (mounted && _listening && !_speech.isListening) {
      _speechReady = false; // 下次点击重新初始化引擎
      setState(() => _listening = false);
      _toast('语音没启动成功。先打字，或点输入框用键盘上的 🎤 说');
    }
  }

  @override
  void dispose() {
    _speech.stop();
    _text.dispose();
    super.dispose();
  }

  /// 账单截图识别：选微信收款助手/支付宝日账单截图 → 苹果原生 OCR → 文字进输入框 → 自动 AI 解析
  static const _ocrChannel = MethodChannel('stockmate/ocr');
  bool _ocrRunning = false;

  Future<void> _pickBillImage() async {
    if (_ocrRunning) return;
    final picked = await pickImageWithChoice(context, cameraLabel: '拍账单/小票', galleryLabel: '从相册选截图');
    if (picked == null) return;
    setState(() => _ocrRunning = true);
    try {
      final text = await _ocrChannel.invokeMethod<String>('recognizeText', {'path': picked.path});
      if (text == null || text.trim().length < 2) {
        _toast('没识别出文字，换张更清晰的截图试试');
        return;
      }
      setState(() => _text.text = '账单截图内容：\n${text.trim()}');
      await _parse(); // 直接走 AI 结构化
    } on PlatformException catch (e) {
      _toast('识别失败：${e.message}');
    } finally {
      if (mounted) setState(() => _ocrRunning = false);
    }
  }

  // default=随手记 | customerOrder=客户发来的订货消息 | purchaseBill=供应商送货单
  String _mode = 'default';

  Future<void> _parse() async {
    final text = _text.text.trim();
    if (text.length < 2) return _toast('先说点什么，比如"卖了3袋虾仁馄饨75块"');
    setState(() {
      _parsing = true;
      _result = null;
    });
    try {
      final data = await Api.I.post('/ai/parse-entry', data: {'text': text, 'mode': _mode});
      ref.invalidate(entitlementProvider); // 用掉一次，剩余数当场刷新
      setState(() => _result = ParseResult.fromJson(data));
    } catch (e) {
      // 额度用完（后端 402）不该只弹个 toast 就完事——给他一条出路。
      // 出路只能是 App 内订阅页（IAP），出现任何站外购买引导都是审核红线。
      final msg = '$e';
      if (msg.contains('用完了')) {
        if (!mounted) return;
        ref.invalidate(entitlementProvider);
        final go = await showDialog<bool>(
          context: context,
          builder: (dctx) => AlertDialog(
            title: const Text('今天的 AI 次数用完了'),
            content: Text(msg.replaceFirst(RegExp(r'^.*?：'), '')),
            actions: [
              TextButton(onPressed: () => Navigator.pop(dctx, false), child: const Text('知道了')),
              TextButton(onPressed: () => Navigator.pop(dctx, true), child: const Text('看看专业版')),
            ],
          ),
        );
        if (go == true && mounted) context.push('/pro');
        return;
      }
      _toast('AI 解析失败：$e');
    } finally {
      if (mounted) setState(() => _parsing = false);
    }
  }

  Future<void> _confirm() async {
    final r = _result;
    if (r == null || _isEmpty) return;
    if (_hasStockIssue) return _toast('有商品库存不够，先改数量或补库存');
    // 进货里的新商品需要归属品类（AI 建议已预填，缺的补选）
    for (final item in r.purchases) {
      if (item.matchedProductId == null && item.productTypeId == null) {
        if (!mounted) return;
        final picked = await _pickType(item);
        if (picked == null) return;
      }
    }
    setState(() => _saving = true);
    try {
      await Api.I.post('/ai/confirm-entry', data: {
        'purchases': [
          for (final i in r.purchases)
            {
              if (i.matchedProductId != null) 'productId': i.matchedProductId,
              if (i.matchedProductId == null && i.createProduct) 'createProduct': true,
              if (i.productTypeId != null) 'productTypeId': i.productTypeId,
              'name': i.name,
              'quantity': i.quantity,
              'unit': i.unit,
              if (i.totalCost != null) 'totalCost': i.totalCost,
              if (i.unitCost != null) 'unitCost': i.unitCost,
            }
        ],
        'sales': [
          for (final s in r.sales)
            {
              if (s.skuId != null) 'skuId': s.skuId,
              if (s.customerId != null) 'customerId': s.customerId,
              'name': s.name,
              'quantity': s.quantity,
              'unit': s.unit,
              if (s.totalAmount != null) 'totalAmount': s.totalAmount,
              if (s.unitPrice != null) 'unitPrice': s.unitPrice,
              if (s.paid != null) 'paid': s.paid,
              if (s.matchedProductId == null && s.createProduct) ...{
                'createProduct': true,
                if (s.productTypeId != null) 'productTypeId': s.productTypeId,
              },
            }
        ],
        'expenses': [
          for (final e in r.expenses) {'category': e.category, 'amount': e.amount, if (e.note != null) 'note': e.note}
        ],
        'aggregates': [
          for (final a in r.aggregates) {'label': a.label, 'amount': a.amount, if (a.note != null) 'note': a.note}
        ],
      });
      ref.invalidate(overviewProvider);
      invalidateProducts(ref);
      ref.invalidate(ordersProvider);
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('✓ 已入账')));
        if (context.canPop()) context.pop();
      }
    } catch (e) {
      _toast('入账失败：$e');
    } finally {
      if (mounted) setState(() => _saving = false);
    }
  }

  /// 选品类（含"新建品类"入口）
  Future<int?> _pickType(ParsedItem item) async {
    final types = await ref.read(typesProvider.future);
    if (!mounted) return null;
    final picked = await showModalBottomSheet<int>(
      context: context,
      builder: (ctx) => SafeArea(
        child: Padding(
          padding: const EdgeInsets.all(24),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text('「${item.name}」归到哪个品类？', style: Theme.of(ctx).textTheme.headlineMedium),
              const SizedBox(height: 16),
              Wrap(
                spacing: 10,
                runSpacing: 10,
                children: [
                  for (final t in types)
                    ActionChip(
                      avatar: item.productTypeId == t.id ? const Icon(Icons.check, size: 16, color: AppColors.primary) : null,
                      label: Text(t.name),
                      onPressed: () => Navigator.pop(ctx, t.id),
                    ),
                  ActionChip(
                    avatar: const Icon(Icons.auto_awesome, size: 16, color: AppColors.primary),
                    label: const Text('新建品类'),
                    onPressed: () => Navigator.pop(ctx, -1),
                  ),
                ],
              ),
            ],
          ),
        ),
      ),
    );
    if (picked == null) return null;
    if (picked == -1) {
      if (!mounted) return null;
      await context.push('/types/new?theme=${Uri.encodeComponent(item.name)}');
      ref.invalidate(typesProvider);
      if (!mounted) return null;
      return _pickType(item);
    }
    final t = types.firstWhere((x) => x.id == picked);
    setState(() {
      item.productTypeId = t.id;
      item.productTypeName = t.name;
    });
    return picked;
  }

  /// 卖出条目切换规格
  Future<void> _pickSku(ParsedSale sale) async {
    if (sale.skuOptions.length <= 1) return;
    final picked = await showModalBottomSheet<int>(
      context: context,
      builder: (ctx) => SafeArea(
        child: ListView(
          padding: const EdgeInsets.all(20),
          shrinkWrap: true,
          children: [
            Text('${sale.matchedProductName} · 卖的是哪个规格？', style: Theme.of(ctx).textTheme.headlineMedium),
            const SizedBox(height: 12),
            for (final s in sale.skuOptions)
              ListTile(
                leading: sale.skuId == s.id ? const Icon(Icons.check_circle, color: AppColors.primary) : const Icon(Icons.circle_outlined),
                title: Text(s.displayName),
                subtitle: Text('¥${s.price} · 库存 ${s.stock}'),
                onTap: () => Navigator.pop(ctx, s.id),
              ),
          ],
        ),
      ),
    );
    if (picked != null) setState(() => sale.skuId = picked);
  }

  void _toast(String msg) {
    if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(msg)));
  }

  @override
  Widget build(BuildContext context) {
    final t = Theme.of(context).textTheme;
    return Scaffold(
      appBar: AppBar(title: const Text('AI 口述记账')),
      // 底部醒目确认区：汇总 + 大按钮
      bottomNavigationBar: _isEmpty
          ? null
          : SafeArea(
              child: Container(
                padding: const EdgeInsets.fromLTRB(20, 12, 20, 12),
                decoration: const BoxDecoration(
                  color: AppColors.surfaceLowest,
                  boxShadow: [BoxShadow(color: Color(0x14000000), offset: Offset(0, -4), blurRadius: 12)],
                ),
                child: Column(mainAxisSize: MainAxisSize.min, children: [
                  Row(children: [
                    if (_purchaseTotal > 0) _SummaryPill(label: '进货', amount: _purchaseTotal, color: AppColors.primary),
                    if (_saleTotal > 0) _SummaryPill(label: '卖出', amount: _saleTotal, color: AppColors.success),
                    if (_aggregateTotal > 0) _SummaryPill(label: '营业额', amount: _aggregateTotal, color: AppColors.success),
                    if (_expenseTotal > 0) _SummaryPill(label: '开销', amount: _expenseTotal, color: AppColors.warning),
                  ]),
                  const SizedBox(height: 10),
                  FilledButton.icon(
                    onPressed: _saving || _hasStockIssue ? null : _confirm,
                    icon: _saving
                        ? const SizedBox(width: 18, height: 18, child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white))
                        : const Icon(Icons.check_circle, size: 22),
                    label: Text(
                      _hasStockIssue ? '有商品库存不足，先处理' : (_saving ? '入账中…' : '确认无误，全部入账'),
                      style: const TextStyle(fontSize: 16, fontWeight: FontWeight.w700),
                    ),
                  ),
                ]),
              ),
            ),
      body: ListView(
        padding: const EdgeInsets.fromLTRB(kPagePadding, 8, kPagePadding, 40),
        children: [
          Text('今天进了什么、\n卖了什么、花了什么？', style: t.headlineLarge),
          const SizedBox(height: 6),
          Text('说出来或打出来都行，AI 帮你记', style: t.bodyMedium),
          const SizedBox(height: 14),
          // 这段话是什么：随手记 / 客户发来的订货消息(整段按卖出) / 供应商单据(整段按进货)
          Wrap(spacing: 8, children: [
            for (final (m, label) in const [
              ('default', '随手记'),
              ('customerOrder', '客户订货消息'),
              ('purchaseBill', '进货单据文字'),
            ])
              ChoiceChip(
                label: Text(label, style: const TextStyle(fontSize: 12)),
                selected: _mode == m,
                onSelected: (_) => setState(() => _mode = m),
              ),
          ]),
          const SizedBox(height: 10),
          TextField(
            controller: _text,
            maxLines: 3,
            decoration: InputDecoration(
              hintText: switch (_mode) {
                'customerOrder' => '把客户微信里发的订货消息原样粘贴进来，AI 整段按"卖出"解析并匹配客户',
                'purchaseBill' => '把供应商送货单/小票的文字贴进来（或用下面🧾拍照识别），整段按"进货"解析',
                _ => '例如：进了30斤面粉90块，卖了3袋虾仁馄饨75块，摊位费50',
              },
            ),
          ),
          const SizedBox(height: 14),
          Row(children: [
            // 麦克风：听的时候按音量呼吸
            GestureDetector(
              onTap: _toggleListen,
              child: SizedBox(
                width: 60,
                height: 60,
                child: Stack(alignment: Alignment.center, children: [
                  if (_listening)
                    AnimatedContainer(
                      duration: const Duration(milliseconds: 120),
                      width: 44 + _soundLevel * 1.6,
                      height: 44 + _soundLevel * 1.6,
                      decoration: BoxDecoration(color: AppColors.error.withValues(alpha: 0.18), shape: BoxShape.circle),
                    ),
                  Container(
                    width: 52,
                    height: 52,
                    decoration: BoxDecoration(
                      color: _listening ? AppColors.error : AppColors.primary.withValues(alpha: 0.1),
                      shape: BoxShape.circle,
                    ),
                    child: Icon(_listening ? Icons.stop_rounded : Icons.mic_rounded,
                        color: _listening ? Colors.white : AppColors.primary),
                  ),
                ]),
              ),
            ),
            const SizedBox(width: 8),
            // 账单截图识别
            GestureDetector(
              onTap: _ocrRunning ? null : _pickBillImage,
              child: Container(
                width: 52,
                height: 52,
                decoration: BoxDecoration(color: AppColors.primary.withValues(alpha: 0.1), shape: BoxShape.circle),
                child: _ocrRunning
                    ? const Padding(padding: EdgeInsets.all(15), child: CircularProgressIndicator(strokeWidth: 2))
                    : const Icon(Icons.receipt_long_outlined, color: AppColors.primary),
              ),
            ),
            const SizedBox(width: 8),
            Expanded(
              child: FilledButton.icon(
                onPressed: _parsing ? null : _parse,
                icon: _parsing
                    ? const SizedBox(width: 18, height: 18, child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white))
                    : const Icon(Icons.auto_awesome, size: 18),
                label: Text(_parsing ? 'AI 解析中…' : 'AI 解析'),
              ),
            ),
          ]),
          Padding(
            padding: const EdgeInsets.only(top: 8),
            child: Row(children: [
              Expanded(
                child: Text('🎤 说话 · 🧾 传收款账单截图（微信/支付宝日账单）· 或直接打字',
                    style: t.bodyMedium?.copyWith(fontSize: 11)),
              ),
              _quotaChip(),
            ]),
          ),
          if (_listening)
            Padding(
              padding: const EdgeInsets.only(top: 10),
              child: Row(children: [
                const SizedBox(
                    width: 12, height: 12, child: CircularProgressIndicator(strokeWidth: 2, color: AppColors.error)),
                const SizedBox(width: 8),
                Text('正在听，慢慢说（停顿不会断），说完点红色停止',
                    style: t.bodyMedium?.copyWith(fontSize: 12, color: AppColors.error)),
              ]),
            ),
          if (_result != null) ...[
            const SizedBox(height: 24),
            _buildResult(t),
          ],
        ],
      ),
    );
  }

  Widget _buildResult(TextTheme t) {
    final r = _result!;
    return AiGradientCard(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(children: [
            const Icon(Icons.auto_awesome, size: 18, color: AppColors.primary),
            const SizedBox(width: 6),
            Text('AI 听懂了这些，请核对', style: t.labelMedium?.copyWith(color: AppColors.primary)),
          ]),
          // ===== 进货 =====
          if (r.purchases.isNotEmpty) ...[
            const SizedBox(height: 14),
            _SectionHeader(icon: Icons.shopping_bag_outlined, label: '进货（${r.purchases.length}）', color: AppColors.primary),
            const SizedBox(height: 6),
            for (final (i, item) in r.purchases.indexed)
              _RowCard(children: [
                Expanded(
                  child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                    // 同卖出行：名字 + 状态标签挤一行会溢出，交给 Wrap 换行
                    Wrap(
                      spacing: 6,
                      runSpacing: 4,
                      crossAxisAlignment: WrapCrossAlignment.center,
                      children: [
                      ConstrainedBox(
                        constraints: const BoxConstraints(maxWidth: 180),
                        child: Text(item.name, style: t.titleMedium, maxLines: 1, overflow: TextOverflow.ellipsis),
                      ),
                      if (item.matchedProductId != null)
                        const Text('已有商品', style: TextStyle(fontSize: 11, color: AppColors.success))
                      else
                        _TapTag(
                          text: item.productTypeName == null ? '新商品·选品类' : '新商品→${item.productTypeName}',
                          onTap: () => _pickType(item),
                        ),
                    ]),
                    if (item.matchedProductId == null)
                      _createProductToggle(
                        value: item.createProduct,
                        typeId: item.productTypeId,
                        onChanged: (v) => setState(() => item.createProduct = v),
                        onTypeResolved: (id) => setState(() => item.productTypeId = id),
                        verb: '入库',
                      ),
                    Text(
                      '${_fmtQty(item.quantity)}${item.unit}${item.totalCost != null ? ' · 共¥${item.totalCost}' : ''}${item.unitCost != null ? ' · ¥${item.unitCost}/${item.unit}' : ''}',
                      style: t.bodyMedium?.copyWith(fontSize: 13),
                    ),
                  ]),
                ),
                IconButton(icon: const Icon(Icons.edit_outlined, size: 18), onPressed: () => _editPurchase(i)),
                IconButton(icon: const Icon(Icons.close_rounded, size: 18), onPressed: () => setState(() => r.purchases.removeAt(i))),
              ]),
          ],
          // ===== 卖出 =====
          if (r.sales.isNotEmpty) ...[
            const SizedBox(height: 10),
            Row(children: [
              _SectionHeader(icon: Icons.sell_outlined, label: '卖出（${r.sales.length}）', color: AppColors.success),
              // 规则解释收进 ⓘ：选项只留结果，解释放这里，互不干扰
              IconButton(
                icon: const Icon(Icons.info_outline_rounded, size: 16, color: AppColors.onSurfaceVariant),
                visualDensity: VisualDensity.compact,
                padding: const EdgeInsets.only(left: 4),
                constraints: const BoxConstraints(),
                tooltip: _kPaidRuleHint,
                onPressed: () => showDialog<void>(
                  context: context,
                  builder: (dctx) => AlertDialog(
                    title: const Text('收款怎么算？'),
                    content: const Text(_kPaidRuleHint),
                    actions: [TextButton(onPressed: () => Navigator.pop(dctx), child: const Text('知道了'))],
                  ),
                ),
              ),
            ]),
            const SizedBox(height: 6),
            for (final (i, s) in r.sales.indexed)
              _RowCard(children: [
                Expanded(
                  child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                    // 名字 + 客户 + 收款 + 库存四个东西挤一行必然溢出（真爆过 67px）。
                    // 用 Wrap 让标签自动换行——手机宽度就那么点，硬挤只会出黑黄条纹。
                    Wrap(
                      spacing: 6,
                      runSpacing: 4,
                      crossAxisAlignment: WrapCrossAlignment.center,
                      children: [
                      ConstrainedBox(
                        constraints: const BoxConstraints(maxWidth: 160),
                        child: Text(s.name, style: t.titleMedium, maxLines: 1, overflow: TextOverflow.ellipsis),
                      ),
                      // 卖给谁（识别到的客户 / 散客）
                      _TapTag(text: s.customerName ?? '散客', color: AppColors.primary),
                      // 收款状态：点一下能改。文案说结果不说系统行话——
                      // "没提"这种词店主看不懂，直接告诉他这笔按什么算
                      _TapTag(
                        text: _paidLabel(s),
                        color: s.paid == true
                            ? AppColors.success
                            : (s.paid == false ? AppColors.warning : AppColors.onSurfaceVariant),
                        onTap: () => _pickPaid(s),
                      ),
                      if (s.matchedProductId != null)
                        _TapTag(
                          text: '扣库存${s.chosenSku != null && s.chosenSku!.specText.isNotEmpty ? '·${s.chosenSku!.specText}' : ''}${s.skuOptions.length > 1 ? ' ▾' : ''}',
                          color: AppColors.success,
                          onTap: () => _pickSku(s),
                        )
                      else
                        const _TapTag(text: '未建档·只记收入', color: AppColors.warning),
                    ]),
                    // 没档案的商品，可以确认时顺便建进来。不勾就只记一笔收入、不动库存。
                    if (s.matchedProductId == null)
                      _createProductToggle(
                        value: s.createProduct,
                        typeId: s.productTypeId,
                        onChanged: (v) => setState(() => s.createProduct = v),
                        onTypeResolved: (id) => setState(() => s.productTypeId = id),
                        verb: '扣库存',
                      ),
                    Text(
                      s.priceUnstated && s.chosenSku != null
                          // 没说价 → 显示系统将按什么价（专属/上次/标价）
                          ? '${_fmtQty(s.quantity)}${s.unit} · 按${s.chosenSku!.priceSourceLabel} ¥${s.chosenSku!.suggestedPrice}/${s.unit} = ¥${s.effectiveAmount.toStringAsFixed(s.effectiveAmount % 1 == 0 ? 0 : 2)}'
                          : '${_fmtQty(s.quantity)}${s.unit} · 收¥${s.effectiveAmount.toStringAsFixed(s.effectiveAmount % 1 == 0 ? 0 : 2)}',
                      style: t.bodyMedium?.copyWith(fontSize: 13),
                    ),
                    if (s.chosenSku != null)
                      Text(
                        s.stockInsufficient ? '⚠ 库存只剩 ${s.chosenSku!.stock}，不够卖 ${_fmtQty(s.quantity)}' : '库存 ${s.chosenSku!.stock} → 卖后剩 ${s.chosenSku!.stock - s.quantity.round()}',
                        style: TextStyle(fontSize: 12, fontWeight: FontWeight.w600, color: s.stockInsufficient ? AppColors.error : AppColors.success),
                      ),
                  ]),
                ),
                IconButton(icon: const Icon(Icons.edit_outlined, size: 18), onPressed: () => _editSale(i)),
                IconButton(icon: const Icon(Icons.close_rounded, size: 18), onPressed: () => setState(() => r.sales.removeAt(i))),
              ]),
          ],
          // ===== 汇总营业额 =====
          if (r.aggregates.isNotEmpty) ...[
            const SizedBox(height: 10),
            _SectionHeader(icon: Icons.savings_outlined, label: '汇总营业额（${r.aggregates.length}）', color: AppColors.success),
            const SizedBox(height: 6),
            for (final (i, a) in r.aggregates.indexed)
              _RowCard(children: [
                Expanded(
                  child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                    Text('${a.label}  ¥${a.amount}', style: t.bodyLarge),
                    if (a.note != null) Text(a.note!, style: t.bodyMedium?.copyWith(fontSize: 12)),
                    Text('计入收入，不涉及库存', style: t.bodyMedium?.copyWith(fontSize: 11)),
                  ]),
                ),
                IconButton(icon: const Icon(Icons.close_rounded, size: 18), onPressed: () => setState(() => r.aggregates.removeAt(i))),
              ]),
          ],
          // ===== 开销 =====
          if (r.expenses.isNotEmpty) ...[
            const SizedBox(height: 10),
            _SectionHeader(icon: Icons.payments_outlined, label: '开销（${r.expenses.length}）', color: AppColors.warning),
            const SizedBox(height: 6),
            for (final (i, e) in r.expenses.indexed)
              _RowCard(children: [
                Expanded(child: Text('${e.category}  ¥${e.amount}', style: t.bodyLarge)),
                IconButton(icon: const Icon(Icons.close_rounded, size: 18), onPressed: () => setState(() => r.expenses.removeAt(i))),
              ]),
          ],
          if (r.deliveryNote != null && r.deliveryNote!.isNotEmpty)
            Padding(
              padding: const EdgeInsets.only(bottom: 8),
              child: _RowCard(children: [
                const Icon(Icons.local_shipping_outlined, size: 16, color: AppColors.primary),
                const SizedBox(width: 8),
                Expanded(child: Text('送货：${r.deliveryNote}', style: const TextStyle(fontSize: 13))),
              ]),
            ),
          if (r.supplierName != null && r.supplierName!.isNotEmpty)
            Padding(
              padding: const EdgeInsets.only(bottom: 8),
              child: _RowCard(children: [
                const Icon(Icons.storefront_outlined, size: 16, color: AppColors.primary),
                const SizedBox(width: 8),
                Expanded(child: Text('供应商：${r.supplierName}', style: const TextStyle(fontSize: 13))),
              ]),
            ),
          if (r.warnings.isNotEmpty) ...[
            const SizedBox(height: 8),
            for (final w in r.warnings)
              Padding(
                padding: const EdgeInsets.only(bottom: 4),
                child: Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
                  const Icon(Icons.info_outline, size: 14, color: AppColors.warning),
                  const SizedBox(width: 4),
                  Expanded(child: Text(w, style: t.bodyMedium?.copyWith(fontSize: 12, color: AppColors.warning))),
                ]),
              ),
          ],
        ],
      ),
    );
  }

  String _fmtQty(double q) => q % 1 == 0 ? q.toInt().toString() : q.toString();

  /// 改名后按新名字在本地商品档案里重配（确定性，不再调 AI）。
  /// 唯一命中→自动改绑；多个/零个→弹选择器让人挑。
  /// 之前的坑：改了名字 skuId 纹丝不动，看着是"改对了"，扣的还是原来那个错的库存——
  /// 假修复比不给改更恶劣，它让人相信已经改好了。
  Future<Product?> _rematchByName(String newName) async {
    final all = await ref.read(productsProvider(null).future);
    final q = newName.trim();
    final hits = all.where((p) => p.name == q).toList();
    if (hits.length == 1) return hits.first;
    final fuzzy = all.where((p) => p.name.contains(q) || q.contains(p.name)).toList();
    if (fuzzy.length == 1) return fuzzy.first;
    if (!mounted) return null;
    // 0 个或 ≥2 个候选：绝不静默取第一条，让人自己挑（或明确选"没有对应商品"）
    return showModalBottomSheet<Product?>(
      context: context,
      builder: (ctx) => SafeArea(
        child: ListView(padding: const EdgeInsets.all(20), shrinkWrap: true, children: [
          Text('「$q」对应哪个商品？', style: Theme.of(ctx).textTheme.headlineMedium),
          const SizedBox(height: 10),
          for (final p in (fuzzy.isNotEmpty ? fuzzy : all).take(12))
            ListTile(title: Text(p.name), subtitle: Text('库存 ${fmtQty(p.totalStock)}'), onTap: () => Navigator.pop(ctx, p)),
          ListTile(
            leading: const Icon(Icons.link_off_rounded, color: AppColors.onSurfaceVariant),
            title: const Text('档案里没有这个商品'),
            subtitle: const Text('卖出将只记收入不扣库存；进货将新建商品', style: TextStyle(fontSize: 12)),
            onTap: () => Navigator.pop(ctx, null),
          ),
        ]),
      ),
    );
  }

  Future<void> _editPurchase(int index) async {
    final item = _result!.purchases[index];
    final vals = await _editSheet(name: item.name, qty: item.quantity, unit: item.unit, amount: item.totalCost, amountLabel: '总花费 ¥');
    if (vals == null) return;
    final nameChanged = vals.$1 != item.name;
    setState(() {
      item.name = vals.$1;
      item.quantity = vals.$2;
      item.unit = vals.$3;
      item.totalCost = vals.$4;
      item.unitCost = vals.$4 != null && vals.$2 > 0 ? double.parse((vals.$4! / vals.$2).toStringAsFixed(2)) : null;
    });
    if (nameChanged) {
      final p = await _rematchByName(vals.$1);
      setState(() {
        item.matchedProductId = p?.id;
        item.matchedProductName = p?.name;
      });
    }
  }

  /// 「顺便建档」勾选：没档案的商品，确认时一并建进商品库并真扣/加库存。
  /// 默认落在主营品类——摊主九成时间只做一门生意，不该每次都问他归到哪。
  /// 一个品类都没有时禁用并说清楚为什么，别给个点不动的空勾选框。
  Widget _createProductToggle({
    required bool value,
    required int? typeId,
    required ValueChanged<bool> onChanged,
    required ValueChanged<int> onTypeResolved,
    required String verb, // 扣库存 / 入库
  }) {
    final types = ref.watch(typesProvider).valueOrNull ?? const [];
    if (types.isEmpty) {
      return const Padding(
        padding: EdgeInsets.only(top: 4),
        child: Text('先建品类，才能顺便建商品档案', style: TextStyle(fontSize: 11, color: AppColors.warning)),
      );
    }
    final resolved = typeId ?? ref.read(mainTypeIdProvider) ?? types.first.id;
    if (typeId != resolved) {
      WidgetsBinding.instance.addPostFrameCallback((_) => onTypeResolved(resolved));
    }
    final tname = types.where((x) => x.id == resolved).firstOrNull?.name ?? types.first.name;
    return Padding(
      padding: const EdgeInsets.only(top: 2),
      child: Row(children: [
        SizedBox(
          width: 26,
          height: 26,
          child: Checkbox(
            value: value,
            visualDensity: VisualDensity.compact,
            materialTapTargetSize: MaterialTapTargetSize.shrinkWrap,
            onChanged: (v) => onChanged(v ?? false),
          ),
        ),
        const SizedBox(width: 4),
        Flexible(
          child: GestureDetector(
            onTap: () => onChanged(!value),
            child: Text('顺便建档到「$tname」并$verb',
                style: const TextStyle(fontSize: 12, color: AppColors.onSurfaceVariant)),
          ),
        ),
      ]),
    );
  }

  /// 今天还剩几次。**不是为了限制，是为了让人心里有数**——
  /// 用到第 9 次突然被拦，和一路看着"还剩 2 次"用到底，是完全不同的体验。
  /// 额度为 null（付费版/未配额度）时整个不显示，免得给不限量的用户添噪音。
  Widget _quotaChip() {
    final e = ref.watch(entitlementProvider).valueOrNull;
    if (e == null) return const SizedBox.shrink();
    final today = e['today'] as Map<String, dynamic>?;
    final limit = today?['coreLimit'] as int?;
    if (limit == null || limit <= 0) return const SizedBox.shrink();
    final used = (today?['coreUsed'] as int?) ?? 0;
    final left = (limit - used).clamp(0, limit);
    // 剩 2 次以内转成警示色：给用户留出"今天悠着点用"的余地
    final warn = left <= 2;
    return Container(
      margin: const EdgeInsets.only(left: 8),
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
      decoration: BoxDecoration(
        color: (warn ? AppColors.warning : AppColors.primary).withValues(alpha: 0.10),
        borderRadius: BorderRadius.circular(8),
      ),
      child: Text(
        left > 0 ? '今天还剩 $left 次' : '今天次数已用完',
        style: TextStyle(
          fontSize: 11,
          fontWeight: FontWeight.w600,
          color: warn ? AppColors.warning : AppColors.primary,
        ),
      ),
    );
  }

  /// 这一行当前按什么算。null（没明说）时直接告诉他默认会走哪边，不出现"没提"这种行话。
  String _paidLabel(ParsedSale s) {
    if (s.paid == true) return '已收款';
    if (s.paid == false) return '挂账（先欠着）';
    return s.isNamedCustomer ? '默认：挂账' : '默认：已收款';
  }

  /// 三选一：已收款 / 挂账（先欠着）/ 默认（跟着客户类型走）
  Future<void> _pickPaid(ParsedSale s) async {
    final picked = await showModalBottomSheet<String>(
      context: context,
      builder: (ctx) => SafeArea(
        child: Column(mainAxisSize: MainAxisSize.min, children: [
          Padding(
            padding: const EdgeInsets.fromLTRB(20, 18, 20, 6),
            child: Align(
              alignment: Alignment.centerLeft,
              child: Text('这笔钱收了吗？', style: Theme.of(ctx).textTheme.headlineMedium),
            ),
          ),
          ListTile(
            leading: const Icon(Icons.check_circle_outline_rounded, color: AppColors.success),
            title: const Text('已收款'),
            onTap: () => Navigator.pop(ctx, 'paid'),
          ),
          ListTile(
            leading: const Icon(Icons.schedule_rounded, color: AppColors.warning),
            title: const Text('挂账（先欠着）'),
            onTap: () => Navigator.pop(ctx, 'unpaid'),
          ),
          ListTile(
            leading: const Icon(Icons.auto_awesome_outlined, color: AppColors.onSurfaceVariant),
            title: Text(s.isNamedCustomer ? '默认：挂账' : '默认：已收款'),
            subtitle: const Text(_kPaidRuleHint, style: TextStyle(fontSize: 11)),
            onTap: () => Navigator.pop(ctx, 'auto'),
          ),
          const SizedBox(height: 8),
        ]),
      ),
    );
    if (picked == null) return;
    setState(() => s.paid = picked == 'paid' ? true : (picked == 'unpaid' ? false : null));
  }

  Future<void> _editSale(int index) async {
    final s = _result!.sales[index];
    final vals = await _editSheet(name: s.name, qty: s.quantity, unit: s.unit, amount: s.totalAmount, amountLabel: '总卖价 ¥');
    if (vals == null) return;
    final nameChanged = vals.$1 != s.name;
    setState(() {
      s.name = vals.$1;
      s.quantity = vals.$2;
      s.unit = vals.$3;
      s.totalAmount = vals.$4;
      s.unitPrice = vals.$4 != null && vals.$2 > 0 ? double.parse((vals.$4! / vals.$2).toStringAsFixed(2)) : null;
    });
    if (nameChanged) {
      final p = await _rematchByName(vals.$1);
      setState(() {
        s.matchedProductId = p?.id;
        s.matchedProductName = p?.name;
        s.skuOptions = p == null
            ? []
            : [
                for (final k in p.skus)
                  SaleSkuOption(
                    id: k.id,
                    specText: k.specText,
                    price: k.price,
                    isDefault: k.isDefault,
                    stock: k.stock.round(),
                    suggestedPrice: k.price,
                    priceSource: 'default',
                  )
              ];
        s.skuId = p == null ? null : (p.defaultSku?.id ?? p.skus.firstOrNull?.id);
      });
    }
  }

  Future<(String, double, String, double?)?> _editSheet(
      {required String name, required double qty, required String unit, double? amount, required String amountLabel}) async {
    final nameC = TextEditingController(text: name);
    final qtyC = TextEditingController(text: _fmtQty(qty));
    final unitC = TextEditingController(text: unit);
    final amountC = TextEditingController(text: amount?.toString() ?? '');
    final saved = await showModalBottomSheet<bool>(
      context: context,
      isScrollControlled: true,
      builder: (ctx) => Padding(
        padding: EdgeInsets.fromLTRB(24, 24, 24, MediaQuery.of(ctx).viewInsets.bottom + 32),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text('修改', style: Theme.of(ctx).textTheme.headlineMedium),
            const SizedBox(height: 16),
            TextField(controller: nameC, decoration: const InputDecoration(labelText: '名称')),
            const SizedBox(height: 12),
            Row(children: [
              Expanded(child: TextField(controller: qtyC, keyboardType: TextInputType.number, decoration: const InputDecoration(labelText: '数量'))),
              const SizedBox(width: 12),
              Expanded(child: TextField(controller: unitC, decoration: const InputDecoration(labelText: '单位'))),
            ]),
            const SizedBox(height: 12),
            TextField(controller: amountC, keyboardType: TextInputType.number, decoration: InputDecoration(hintText: amountLabel)),
            const SizedBox(height: 16),
            FilledButton(onPressed: () => Navigator.pop(ctx, true), child: const Text('确定')),
          ],
        ),
      ),
    );
    if (saved != true) return null;
    return (nameC.text.trim(), double.tryParse(qtyC.text) ?? qty, unitC.text.trim(), double.tryParse(amountC.text));
  }
}

// ===== 小组件 =====

class _SectionHeader extends StatelessWidget {
  final IconData icon;
  final String label;
  final Color color;
  const _SectionHeader({required this.icon, required this.label, required this.color});
  @override
  Widget build(BuildContext context) {
    return Row(children: [
      Icon(icon, size: 16, color: color),
      const SizedBox(width: 6),
      Text(label, style: TextStyle(fontSize: 14, fontWeight: FontWeight.w700, color: color)),
    ]);
  }
}

class _RowCard extends StatelessWidget {
  final List<Widget> children;
  const _RowCard({required this.children});
  @override
  Widget build(BuildContext context) {
    return Container(
      margin: const EdgeInsets.only(bottom: 8),
      padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 10),
      decoration: BoxDecoration(color: Colors.white, borderRadius: BorderRadius.circular(16)),
      child: Row(children: children),
    );
  }
}

class _TapTag extends StatelessWidget {
  final String text;
  final Color color;
  final VoidCallback? onTap;
  const _TapTag({required this.text, this.color = AppColors.primary, this.onTap});
  @override
  Widget build(BuildContext context) {
    return GestureDetector(
      onTap: onTap,
      child: Container(
        padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
        decoration: BoxDecoration(color: color.withValues(alpha: 0.1), borderRadius: BorderRadius.circular(10)),
        child: Text(text, style: TextStyle(fontSize: 11, fontWeight: FontWeight.w600, color: color)),
      ),
    );
  }
}

class _SummaryPill extends StatelessWidget {
  final String label;
  final double amount;
  final Color color;
  const _SummaryPill({required this.label, required this.amount, required this.color});
  @override
  Widget build(BuildContext context) {
    return Container(
      margin: const EdgeInsets.only(right: 8),
      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
      decoration: BoxDecoration(color: color.withValues(alpha: 0.1), borderRadius: BorderRadius.circular(12)),
      child: Text('$label ¥${amount.toStringAsFixed(amount % 1 == 0 ? 0 : 2)}',
          style: TextStyle(fontSize: 13, fontWeight: FontWeight.w700, color: color)),
    );
  }
}
