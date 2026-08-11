import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:print_bluetooth_thermal/print_bluetooth_thermal.dart';
import '../../core/printer_service.dart';
import '../../core/providers.dart';
import '../../core/theme.dart';

/// 小票打印机设置：扫描 → 连接 → 记住 → 测试打印
/// 支持 58mm 蓝牙热敏打印机（BLE）。买回打印机开机后进这里连一次即可。
class PrinterScreen extends ConsumerStatefulWidget {
  const PrinterScreen({super.key});

  @override
  ConsumerState<PrinterScreen> createState() => _PrinterScreenState();
}

class _PrinterScreenState extends ConsumerState<PrinterScreen> {
  List<BluetoothInfo> _devices = [];
  (String, String)? _saved;
  bool _connected = false;
  bool _scanning = false;
  String? _busyAddr; // 正在连接的设备

  @override
  void initState() {
    super.initState();
    _refresh();
  }

  Future<void> _refresh() async {
    final saved = await PrinterService.I.savedPrinter();
    final connected = await PrinterService.I.isConnected;
    if (mounted) {
      setState(() {
        _saved = saved;
        _connected = connected;
      });
    }
  }

  Future<void> _scan() async {
    setState(() => _scanning = true);
    try {
      if (!await PrinterService.I.bluetoothOn) {
        if (mounted) {
          ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('请先在系统设置里打开蓝牙')));
        }
        return;
      }
      final list = await PrinterService.I.scan();
      if (mounted) setState(() => _devices = list);
      if (list.isEmpty && mounted) {
        ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('没扫到设备：确认打印机已开机，且离手机近一点')));
      }
    } catch (e) {
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text('扫描失败：$e')));
    } finally {
      if (mounted) setState(() => _scanning = false);
    }
  }

  Future<void> _connect(BluetoothInfo d) async {
    setState(() => _busyAddr = d.macAdress);
    try {
      final ok = await PrinterService.I.connect(d);
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(ok ? '✓ 已连接「${d.name}」，以后打印会自动用它' : '连接失败，重试一下或换台设备')));
      }
      await _refresh();
    } finally {
      if (mounted) setState(() => _busyAddr = null);
    }
  }

  Future<void> _testPrint() async {
    final shopName = ref.read(profileProvider).valueOrNull?['shopName'] ?? 'StockMate';
    final ok = await PrinterService.I.printTest(shopName);
    if (mounted) {
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(ok ? '✓ 测试小票已发送，看打印机出纸' : '打印失败：打印机未连接或已断开')));
    }
    _refresh();
  }

  @override
  Widget build(BuildContext context) {
    final t = Theme.of(context).textTheme;
    return Scaffold(
      appBar: AppBar(title: const Text('小票打印机')),
      body: ListView(
        padding: const EdgeInsets.fromLTRB(kPagePadding, 8, kPagePadding, 120),
        children: [
          // 当前打印机
          SoftCard(
            child: _saved == null
                ? Row(children: [
                    const Icon(Icons.print_disabled_outlined, color: AppColors.onSurfaceVariant),
                    const SizedBox(width: 12),
                    Expanded(
                      child: Text('还没连接过打印机\n支持 58mm 蓝牙热敏小票打印机（几十块的通用款即可）',
                          style: t.bodyMedium?.copyWith(fontSize: 12, height: 1.5)),
                    ),
                  ])
                : Column(children: [
                    Row(children: [
                      Icon(Icons.print_rounded, color: _connected ? const Color(0xFF2E9E5B) : AppColors.onSurfaceVariant),
                      const SizedBox(width: 12),
                      Expanded(
                        child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                          Text(_saved!.$1, style: t.titleMedium),
                          Text(_connected ? '已连接' : '未连接（打印时会自动重连）',
                              style: TextStyle(fontSize: 12, color: _connected ? const Color(0xFF2E9E5B) : AppColors.onSurfaceVariant)),
                        ]),
                      ),
                    ]),
                    const SizedBox(height: 12),
                    Row(children: [
                      Expanded(
                        child: OutlinedButton.icon(
                          onPressed: _testPrint,
                          icon: const Icon(Icons.receipt_long_rounded, size: 16),
                          label: const Text('测试打印', style: TextStyle(fontSize: 13)),
                        ),
                      ),
                      const SizedBox(width: 10),
                      Expanded(
                        child: OutlinedButton.icon(
                          onPressed: () async {
                            await PrinterService.I.forget();
                            _refresh();
                          },
                          icon: const Icon(Icons.link_off_rounded, size: 16, color: AppColors.error),
                          label: const Text('忘记打印机', style: TextStyle(fontSize: 13, color: AppColors.error)),
                        ),
                      ),
                    ]),
                  ]),
          ),
          const SizedBox(height: 16),
          Row(children: [
            Expanded(child: Text('附近的设备', style: t.titleMedium)),
            TextButton.icon(
              onPressed: _scanning ? null : _scan,
              icon: _scanning
                  ? const SizedBox(width: 14, height: 14, child: CircularProgressIndicator(strokeWidth: 2))
                  : const Icon(Icons.bluetooth_searching_rounded, size: 18),
              label: Text(_scanning ? '扫描中…' : '扫描'),
            ),
          ]),
          if (_devices.isEmpty && !_scanning)
            SoftCard(
              child: Text('点右上角「扫描」查找打印机。\n找不到时：①打印机开机 ②手机蓝牙已开 ③打印机没被别的手机连着。',
                  style: t.bodyMedium?.copyWith(fontSize: 12, height: 1.6)),
            ),
          for (final d in _devices)
            Padding(
              padding: const EdgeInsets.only(bottom: 8),
              child: SoftCard(
                onTap: _busyAddr == null ? () => _connect(d) : null,
                child: Row(children: [
                  const Icon(Icons.print_outlined, color: AppColors.primary),
                  const SizedBox(width: 12),
                  Expanded(
                    child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                      Text(d.name.isEmpty ? '未命名设备' : d.name, style: t.titleMedium),
                      Text(d.macAdress, style: t.bodyMedium?.copyWith(fontSize: 11)),
                    ]),
                  ),
                  if (_busyAddr == d.macAdress)
                    const SizedBox(width: 18, height: 18, child: CircularProgressIndicator(strokeWidth: 2))
                  else if (_saved?.$2 == d.macAdress)
                    const Text('当前', style: TextStyle(fontSize: 12, color: AppColors.primary, fontWeight: FontWeight.w600))
                  else
                    const Text('连接', style: TextStyle(fontSize: 13, color: AppColors.primary, fontWeight: FontWeight.w600)),
                ]),
              ),
            ),
        ],
      ),
    );
  }
}
