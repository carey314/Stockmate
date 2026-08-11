import 'dart:typed_data';
import 'dart:ui' as ui;
import 'package:esc_pos_utils_plus/esc_pos_utils_plus.dart';
import 'package:flutter/material.dart';
import 'package:flutter/rendering.dart';
import 'package:go_router/go_router.dart';
import 'package:image/image.dart' as img;
import 'package:print_bluetooth_thermal/print_bluetooth_thermal.dart';
import 'package:shared_preferences/shared_preferences.dart';

/// 蓝牙小票打印（iOS 走 BLE，58mm 热敏打印机=384 点宽）
/// 思路：把 App 里已有的"票据卡片"截图 → 转黑白光栅 → ESC/POS 指令发给打印机，
/// 所见即所得，不用为每种单据单独排版打印模板。
class PrinterService {
  PrinterService._();
  static final PrinterService I = PrinterService._();

  static const _kAddr = 'printer_addr';
  static const _kName = 'printer_name';
  static const _dots = 384; // 58mm 打印宽度

  /// 记住的打印机（name, address），没配置过返回 null
  Future<(String, String)?> savedPrinter() async {
    final sp = await SharedPreferences.getInstance();
    final addr = sp.getString(_kAddr);
    final name = sp.getString(_kName);
    if (addr == null || addr.isEmpty) return null;
    return (name ?? '打印机', addr);
  }

  Future<bool> get bluetoothOn => PrintBluetoothThermal.bluetoothEnabled;

  Future<bool> get isConnected => PrintBluetoothThermal.connectionStatus;

  /// 扫描附近打印机（iOS=BLE 扫描，Android=已配对列表）
  Future<List<BluetoothInfo>> scan() => PrintBluetoothThermal.pairedBluetooths;

  Future<bool> connect(BluetoothInfo device) async {
    final ok = await PrintBluetoothThermal.connect(macPrinterAddress: device.macAdress);
    if (ok) {
      final sp = await SharedPreferences.getInstance();
      await sp.setString(_kAddr, device.macAdress);
      await sp.setString(_kName, device.name);
    }
    return ok;
  }

  /// 复连记住的打印机（打印前自动调用）
  Future<bool> ensureConnected() async {
    if (await isConnected) return true;
    final saved = await savedPrinter();
    if (saved == null) return false;
    return PrintBluetoothThermal.connect(macPrinterAddress: saved.$2);
  }

  Future<void> forget() async {
    await PrintBluetoothThermal.disconnect;
    final sp = await SharedPreferences.getInstance();
    await sp.remove(_kAddr);
    await sp.remove(_kName);
  }

  /// 打印一张 PNG 截图（票据卡片）：缩到384点宽 → 灰度 → 光栅指令
  Future<bool> printImage(Uint8List png) async {
    if (!await ensureConnected()) return false;
    final decoded = img.decodeImage(png);
    if (decoded == null) return false;
    final resized = img.copyResize(decoded, width: _dots);
    final gray = img.grayscale(resized);

    final profile = await CapabilityProfile.load();
    final gen = Generator(PaperSize.mm58, profile);
    final bytes = <int>[
      ...gen.reset(),
      ...gen.imageRaster(gray),
      ...gen.feed(3),
      ...gen.cut(),
    ];
    return PrintBluetoothThermal.writeBytes(bytes);
  }

  /// 打印票据卡片（单据详情页的 RepaintBoundary）
  /// 没配置过打印机时弹引导去设置页，不打断当前页面
  Future<void> printReceipt(BuildContext context, GlobalKey boundaryKey) async {
    final saved = await savedPrinter();
    if (!context.mounted) return;
    if (saved == null) {
      final go = await showDialog<bool>(
        context: context,
        builder: (dctx) => AlertDialog(
          title: const Text('还没连接打印机'),
          content: const Text('连接一台 58mm 蓝牙热敏小票打印机后，这里就能一键出纸。\n没有打印机也可以用「分享单据图片」发给对方。'),
          actions: [
            TextButton(onPressed: () => Navigator.pop(dctx, false), child: const Text('取消')),
            TextButton(onPressed: () => Navigator.pop(dctx, true), child: const Text('去连接')),
          ],
        ),
      );
      if (go == true && context.mounted) context.push('/printer');
      return;
    }

    final messenger = ScaffoldMessenger.of(context);
    messenger.showSnackBar(const SnackBar(content: Text('正在打印…')));
    try {
      final boundary = boundaryKey.currentContext!.findRenderObject() as RenderRepaintBoundary;
      final image = await boundary.toImage(pixelRatio: 2.0);
      final bytes = (await image.toByteData(format: ui.ImageByteFormat.png))!.buffer.asUint8List();
      final ok = await printImage(bytes);
      messenger.showSnackBar(SnackBar(content: Text(ok ? '✓ 已发送到「${saved.$1}」' : '打印失败：打印机未连接，去「我的 → 小票打印机」重连')));
    } catch (e) {
      messenger.showSnackBar(SnackBar(content: Text('打印失败：$e')));
    }
  }

  /// 测试打印（纯文本，验证连接和出纸）
  Future<bool> printTest(String shopName) async {
    if (!await ensureConnected()) return false;
    final profile = await CapabilityProfile.load();
    final gen = Generator(PaperSize.mm58, profile);
    final bytes = <int>[
      ...gen.reset(),
      ...gen.text(shopName, styles: const PosStyles(align: PosAlign.center, height: PosTextSize.size2, width: PosTextSize.size2)),
      ...gen.text('打印机连接正常', styles: const PosStyles(align: PosAlign.center)),
      ...gen.hr(),
      ...gen.text('StockMate 智存', styles: const PosStyles(align: PosAlign.center)),
      ...gen.feed(3),
      ...gen.cut(),
    ];
    return PrintBluetoothThermal.writeBytes(bytes);
  }
}
