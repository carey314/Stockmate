import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:mobile_scanner/mobile_scanner.dart';
import '../../core/api.dart';
import '../../core/models.dart';
import '../../core/providers.dart';
import '../../core/theme.dart';

/// 扫码出入库：扫商品二维码/条形码 → 弹操作面板 → 入库/出库
class ScanScreen extends ConsumerStatefulWidget {
  const ScanScreen({super.key});

  @override
  ConsumerState<ScanScreen> createState() => _ScanScreenState();
}

class _ScanScreenState extends ConsumerState<ScanScreen> {
  final _controller = MobileScannerController(formats: [BarcodeFormat.qrCode, BarcodeFormat.ean13, BarcodeFormat.code128]);
  bool _handling = false;

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  Future<void> _onDetect(BarcodeCapture capture) async {
    if (_handling) return;
    final raw = capture.barcodes.firstOrNull?.rawValue;
    if (raw == null || raw.isEmpty) return;
    _handling = true;
    await _controller.stop();
    try {
      final data = await Api.I.post('/products/lookup', data: {'code': raw});
      final product = Product.fromJson(data);
      final matchedSku = data['matchedSku'] == null ? null : Sku.fromJson(data['matchedSku']);
      if (mounted) await _showActionSheet(product, matchedSku ?? product.defaultSku);
    } catch (e) {
      // 没建档的条码不是死路：带着码直接去建品，建完这个码立刻能扫。
      // 新店第一周对着货架扫一圈就把档案建完了，这是冷启动最快的路。
      if (mounted && e is ApiError && e.status == 404) {
        await _offerCreate(raw);
      } else if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text('$e')));
      }
    } finally {
      _handling = false;
      if (mounted) await _controller.start();
    }
  }

  /// 扫到没建档的码 → 引导建品（条码预填）
  Future<void> _offerCreate(String code) async {
    final go = await showDialog<bool>(
      context: context,
      builder: (dctx) => AlertDialog(
        title: const Text('这个码还没建档'),
        content: Text('条码 $code 没有对应的商品。现在建一个？条码会自动填好，建完就能扫了。'),
        actions: [
          TextButton(onPressed: () => Navigator.pop(dctx, false), child: const Text('取消')),
          FilledButton(onPressed: () => Navigator.pop(dctx, true), child: const Text('去建品')),
        ],
      ),
    );
    if (go == true && mounted) {
      await context.push('/products/new?barcode=${Uri.encodeComponent(code)}');
    }
  }

  /// 手动输入编码（摄像头不可用时的兜底）
  Future<void> _manualInput() async {
    final controller = TextEditingController();
    final code = await showModalBottomSheet<String>(
      context: context,
      isScrollControlled: true,
      builder: (ctx) => Padding(
        padding: EdgeInsets.fromLTRB(24, 24, 24, MediaQuery.of(ctx).viewInsets.bottom + 32),
        child: Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.start, children: [
          Text('输入商品编码', style: Theme.of(ctx).textTheme.headlineMedium),
          const SizedBox(height: 16),
          TextField(controller: controller, autofocus: true, decoration: const InputDecoration(hintText: '商品编码或条形码')),
          const SizedBox(height: 16),
          FilledButton(onPressed: () => Navigator.pop(ctx, controller.text.trim()), child: const Text('查询')),
        ]),
      ),
    );
    if (code != null && code.isNotEmpty) {
      try {
        final data = await Api.I.post('/products/lookup', data: {'code': code});
        final product = Product.fromJson(data);
        final matchedSku = data['matchedSku'] == null ? null : Sku.fromJson(data['matchedSku']);
        if (mounted) await _showActionSheet(product, matchedSku ?? product.defaultSku);
      } catch (e) {
        if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text('$e')));
      }
    }
  }

  Future<void> _showActionSheet(Product product, Sku? sku) async {
    if (sku == null) return;
    final qty = TextEditingController();
    String action = 'inbound';

    final confirmed = await showModalBottomSheet<bool>(
      context: context,
      isScrollControlled: true,
      builder: (ctx) => StatefulBuilder(
        builder: (ctx, setModal) => Padding(
          padding: EdgeInsets.fromLTRB(24, 24, 24, MediaQuery.of(ctx).viewInsets.bottom + 32),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Row(children: [
                Expanded(child: Text(product.name, style: Theme.of(ctx).textTheme.headlineMedium)),
                Text('库存 ${fmtQty(sku.stock)}', style: Theme.of(ctx).textTheme.titleMedium),
              ]),
              if (sku.specText.isNotEmpty)
                Padding(
                  padding: const EdgeInsets.only(top: 4),
                  child: Chip(label: Text(sku.specText)),
                ),
              const SizedBox(height: 12),
              // 老板最容易在这里犯的错：以为扫码就是卖货。这里只动库存不记钱。
              Container(
                padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
                decoration: BoxDecoration(color: const Color(0xFFFFF4E5), borderRadius: BorderRadius.circular(12)),
                child: Row(children: [
                  const Icon(Icons.warning_amber_rounded, size: 18, color: AppColors.warning),
                  const SizedBox(width: 8),
                  Expanded(
                    child: Text('这里只改库存，不记钱。卖货请用「开单」，进货请用「进货单」。',
                        style: TextStyle(fontSize: 12, height: 1.4, color: AppColors.warning)),
                  ),
                ]),
              ),
              const SizedBox(height: 14),
              Row(children: [
                Expanded(
                  child: ChoiceChip(
                    label: const Center(child: Text('入库 +')),
                    selected: action == 'inbound',
                    onSelected: (_) => setModal(() => action = 'inbound'),
                  ),
                ),
                const SizedBox(width: 10),
                Expanded(
                  child: ChoiceChip(
                    label: const Center(child: Text('出库 −')),
                    selected: action == 'outbound',
                    onSelected: (_) => setModal(() => action = 'outbound'),
                  ),
                ),
              ]),
              const SizedBox(height: 14),
              TextField(controller: qty, autofocus: true, keyboardType: const TextInputType.numberWithOptions(decimal: true), decoration: const InputDecoration(hintText: '数量')),
              const SizedBox(height: 8),
              Text(
                action == 'inbound' ? '用途：盘盈 / 纠错 / 自用退回' : '用途：盘亏 / 报损 / 过期 / 自用领用',
                style: const TextStyle(fontSize: 12, color: AppColors.onSurfaceVariant),
              ),
              const SizedBox(height: 14),
              // 卖货的正路就摆在这儿，别让人只能扫码
              SizedBox(
                width: double.infinity,
                child: OutlinedButton.icon(
                  onPressed: () {
                    Navigator.pop(ctx, false);
                    context.push('/orders/new');
                  },
                  icon: const Icon(Icons.receipt_long_rounded, size: 18),
                  label: const Text('要卖货？去开单 →'),
                ),
              ),
              const SizedBox(height: 10),
              FilledButton(onPressed: () => Navigator.pop(ctx, true), child: Text(action == 'inbound' ? '确认入库' : '确认出库')),
            ],
          ),
        ),
      ),
    );

    if (confirmed == true) {
      final n = double.tryParse(qty.text);
      if (n == null || n <= 0) return;
      try {
        await Api.I.post('/inventory/$action', data: {'skuId': sku.id, 'quantity': n});
        invalidateProducts(ref);
        ref.invalidate(overviewProvider);
        if (mounted) {
          ScaffoldMessenger.of(context).showSnackBar(SnackBar(
              content: Text('✓ ${product.name}${sku.specText.isNotEmpty ? ' ${sku.specText}' : ''} ${action == 'inbound' ? '入库' : '出库'} $n')));
        }
      } catch (e) {
        if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text('$e')));
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: Colors.black,
      appBar: AppBar(
        title: const Text('扫码出入库', style: TextStyle(color: Colors.white)),
        iconTheme: const IconThemeData(color: Colors.white),
        actions: [
          IconButton(icon: const Icon(Icons.keyboard_alt_outlined, color: Colors.white), onPressed: _manualInput),
        ],
      ),
      body: Stack(
        children: [
          MobileScanner(
            controller: _controller,
            onDetect: _onDetect,
            // 摄像头不可用（如模拟器）：友好降级，引导手动输码
            errorBuilder: (context, error) => Center(
              child: Padding(
                padding: const EdgeInsets.all(32),
                child: Column(
                  mainAxisAlignment: MainAxisAlignment.center,
                  children: [
                    const Icon(Icons.no_photography_outlined, color: Colors.white54, size: 48),
                    const SizedBox(height: 16),
                    const Text('相机不可用', style: TextStyle(color: Colors.white, fontSize: 18, fontWeight: FontWeight.w700)),
                    const SizedBox(height: 8),
                    Text(
                      '模拟器没有摄像头，真机上扫码正常。\n现在可以手动输入商品编码。',
                      textAlign: TextAlign.center,
                      style: TextStyle(color: Colors.white.withValues(alpha: 0.7), fontSize: 13, height: 1.5),
                    ),
                    const SizedBox(height: 20),
                    FilledButton.icon(
                      onPressed: _manualInput,
                      icon: const Icon(Icons.keyboard_alt_outlined, size: 20),
                      label: const Text('手动输入编码'),
                    ),
                  ],
                ),
              ),
            ),
          ),
          // 取景框
          Center(
            child: Container(
              width: 260,
              height: 260,
              decoration: BoxDecoration(
                border: Border.all(color: AppColors.primaryContainer, width: 3),
                borderRadius: BorderRadius.circular(28),
              ),
            ),
          ),
          Positioned(
            bottom: 140,
            left: 0,
            right: 0,
            child: Text('对准商品二维码或条形码', textAlign: TextAlign.center, style: TextStyle(color: Colors.white.withValues(alpha: 0.85))),
          ),
        ],
      ),
    );
  }
}
