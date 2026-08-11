import 'package:flutter/material.dart';
import 'package:share_plus/share_plus.dart';

/// 统一分享入口：iPad/大屏 iPhone 的分享弹窗必须有锚点(sharePositionOrigin)，否则 PlatformException
Future<void> shareFiles(BuildContext context, List<XFile> files, {String? text}) {
  final box = context.findRenderObject() as RenderBox?;
  final size = MediaQuery.of(context).size;
  // 优先用当前控件位置，兜底用屏幕上半区（非零且在视图内即可）
  final origin = (box != null && box.hasSize && box.size != Size.zero)
      ? box.localToGlobal(Offset.zero) & box.size
      : Rect.fromLTWH(0, 0, size.width, size.height / 2);
  return Share.shareXFiles(files, text: text, sharePositionOrigin: origin);
}
