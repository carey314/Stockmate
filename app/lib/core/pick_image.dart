import 'package:flutter/material.dart';
import 'package:image_picker/image_picker.dart';

/// 统一的取图入口：先问「拍照 / 从相册选」，再取图。
/// 送货单、账单小票这些东西就在手上，直接拍是最自然的动作；
/// 只给相册等于逼用户先退出 App 拍一张再回来找——四处取图都走这里。
Future<XFile?> pickImageWithChoice(
  BuildContext context, {
  double maxWidth = 2400,
  int? imageQuality,
  String cameraLabel = '拍照',
  String galleryLabel = '从相册选',
}) async {
  final source = await showModalBottomSheet<ImageSource>(
    context: context,
    builder: (ctx) => SafeArea(
      child: Column(mainAxisSize: MainAxisSize.min, children: [
        ListTile(
          leading: const Icon(Icons.photo_camera_rounded),
          title: Text(cameraLabel),
          onTap: () => Navigator.pop(ctx, ImageSource.camera),
        ),
        ListTile(
          leading: const Icon(Icons.photo_library_rounded),
          title: Text(galleryLabel),
          onTap: () => Navigator.pop(ctx, ImageSource.gallery),
        ),
        ListTile(
          leading: const Icon(Icons.close_rounded),
          title: const Text('取消'),
          onTap: () => Navigator.pop(ctx),
        ),
      ]),
    ),
  );
  if (source == null) return null;
  return ImagePicker().pickImage(source: source, maxWidth: maxWidth, imageQuality: imageQuality);
}
