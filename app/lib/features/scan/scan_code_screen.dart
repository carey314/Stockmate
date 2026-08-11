import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import 'package:mobile_scanner/mobile_scanner.dart';
import '../../core/theme.dart';

/// 通用扫码页：扫到码直接返回（给开单/进货加行用）
class ScanCodeScreen extends StatefulWidget {
  const ScanCodeScreen({super.key});

  @override
  State<ScanCodeScreen> createState() => _ScanCodeScreenState();
}

class _ScanCodeScreenState extends State<ScanCodeScreen> {
  final _controller = MobileScannerController(formats: [BarcodeFormat.qrCode, BarcodeFormat.ean13, BarcodeFormat.code128]);
  bool _popped = false;

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  void _onDetect(BarcodeCapture capture) {
    if (_popped) return;
    final raw = capture.barcodes.firstOrNull?.rawValue;
    if (raw == null || raw.isEmpty) return;
    _popped = true;
    context.pop(raw);
  }

  Future<void> _manual() async {
    final c = TextEditingController();
    final code = await showModalBottomSheet<String>(
      context: context,
      isScrollControlled: true,
      builder: (ctx) => Padding(
        padding: EdgeInsets.fromLTRB(24, 24, 24, MediaQuery.of(ctx).viewInsets.bottom + 32),
        child: Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.start, children: [
          Text('输入商品编码', style: Theme.of(ctx).textTheme.headlineMedium),
          const SizedBox(height: 16),
          TextField(controller: c, autofocus: true, decoration: const InputDecoration(hintText: '商品编码或条形码')),
          const SizedBox(height: 16),
          FilledButton(onPressed: () => Navigator.pop(ctx, c.text.trim()), child: const Text('确定')),
        ]),
      ),
    );
    if (code != null && code.isNotEmpty && mounted && !_popped) {
      _popped = true;
      context.pop(code);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: Colors.black,
      appBar: AppBar(
        title: const Text('扫码加货', style: TextStyle(color: Colors.white)),
        iconTheme: const IconThemeData(color: Colors.white),
        actions: [IconButton(icon: const Icon(Icons.keyboard_alt_outlined, color: Colors.white), onPressed: _manual)],
      ),
      body: Stack(children: [
        MobileScanner(
          controller: _controller,
          onDetect: _onDetect,
          errorBuilder: (context, error) => Center(
            child: Padding(
              padding: const EdgeInsets.all(32),
              child: Column(mainAxisAlignment: MainAxisAlignment.center, children: [
                const Icon(Icons.no_photography_outlined, color: Colors.white54, size: 48),
                const SizedBox(height: 12),
                const Text('相机不可用', style: TextStyle(color: Colors.white, fontSize: 16, fontWeight: FontWeight.w700)),
                const SizedBox(height: 16),
                FilledButton.icon(onPressed: _manual, icon: const Icon(Icons.keyboard_alt_outlined, size: 18), label: const Text('手动输入编码')),
              ]),
            ),
          ),
        ),
        Center(
          child: Container(
            width: 260,
            height: 260,
            decoration: BoxDecoration(border: Border.all(color: AppColors.primaryContainer, width: 3), borderRadius: BorderRadius.circular(28)),
          ),
        ),
      ]),
    );
  }
}
