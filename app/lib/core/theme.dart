import 'package:flutter/material.dart';
import 'api.dart';

/// Aetheric Modern 设计令牌（来自 UI 参考包 DESIGN.md）
/// 靛蓝紫主色 / 超浅底 / 24px 大圆角 / 无边框软阴影 / 大字重标题 / 药丸按钮
class AppColors {
  static const primary = Color(0xFF4648D4);
  static const primaryContainer = Color(0xFF6063EE);
  static const primaryFixed = Color(0xFFE1E0FF);
  static const surface = Color(0xFFFAF8FF);
  static const surfaceLowest = Color(0xFFFFFFFF);
  static const surfaceLow = Color(0xFFF2F3FF);
  static const surfaceContainer = Color(0xFFEAEDFF);
  static const surfaceHigh = Color(0xFFE2E7FF);
  static const onSurface = Color(0xFF131B2E);
  static const onSurfaceVariant = Color(0xFF464554);
  static const outlineVariant = Color(0xFFC7C4D7);
  static const error = Color(0xFFBA1A1A);
  static const errorContainer = Color(0xFFFFDAD6);
  static const success = Color(0xFF1B873F);
  static const warning = Color(0xFFB25E00);
}

/// 卡片软阴影（低海拔）
const kCardShadow = [
  BoxShadow(color: Color(0x0D000000), offset: Offset(0, 4), blurRadius: 6, spreadRadius: -1),
  BoxShadow(color: Color(0x0D000000), offset: Offset(0, 2), blurRadius: 4, spreadRadius: -2),
];

const kRadiusCard = 24.0;
const kRadiusSm = 12.0;
const kPagePadding = 20.0;

ThemeData buildTheme() {
  final base = ThemeData(
    useMaterial3: true,
    colorScheme: ColorScheme.fromSeed(
      seedColor: AppColors.primary,
      primary: AppColors.primary,
      surface: AppColors.surface,
      error: AppColors.error,
    ),
    scaffoldBackgroundColor: AppColors.surface,
  );

  // 中文显式回退到苹方，避免超粗字重下个别汉字被系统丢给奇怪字体（如"管"渲染异常）
  const zhFallback = ['PingFang SC', 'Heiti SC'];
  return base.copyWith(
    textTheme: base.textTheme
        .copyWith(
          // 大字重标题（苹方最高稳定合成到 w700，不用 w800）
          headlineLarge: const TextStyle(fontSize: 28, fontWeight: FontWeight.w700, height: 1.28, letterSpacing: -0.3, color: AppColors.onSurface),
          headlineMedium: const TextStyle(fontSize: 24, fontWeight: FontWeight.w700, height: 1.33, color: AppColors.onSurface),
          titleLarge: const TextStyle(fontSize: 20, fontWeight: FontWeight.w700, color: AppColors.onSurface),
          titleMedium: const TextStyle(fontSize: 16, fontWeight: FontWeight.w600, color: AppColors.onSurface),
          bodyLarge: const TextStyle(fontSize: 16, height: 1.5, color: AppColors.onSurface),
          bodyMedium: const TextStyle(fontSize: 14, height: 1.45, color: AppColors.onSurfaceVariant),
          labelMedium: const TextStyle(fontSize: 13, fontWeight: FontWeight.w600, letterSpacing: 0.5, color: AppColors.onSurfaceVariant),
        )
        .apply(fontFamilyFallback: zhFallback),
    appBarTheme: const AppBarTheme(
      backgroundColor: Colors.transparent,
      surfaceTintColor: Colors.transparent,
      elevation: 0,
      centerTitle: true,
      titleTextStyle: TextStyle(fontSize: 17, fontWeight: FontWeight.w700, color: AppColors.primary),
      iconTheme: IconThemeData(color: AppColors.onSurface),
    ),
    // 药丸主按钮
    filledButtonTheme: FilledButtonThemeData(
      style: FilledButton.styleFrom(
        backgroundColor: AppColors.primary,
        foregroundColor: Colors.white,
        minimumSize: const Size.fromHeight(52),
        shape: const StadiumBorder(),
        textStyle: const TextStyle(fontSize: 16, fontWeight: FontWeight.w700),
      ),
    ),
    outlinedButtonTheme: OutlinedButtonThemeData(
      style: OutlinedButton.styleFrom(
        foregroundColor: AppColors.primary,
        side: const BorderSide(color: AppColors.outlineVariant),
        minimumSize: const Size.fromHeight(48),
        shape: const StadiumBorder(),
        textStyle: const TextStyle(fontSize: 15, fontWeight: FontWeight.w600),
      ),
    ),
    // 无边框输入框：浅灰底 + 聚焦时靛蓝光晕
    inputDecorationTheme: InputDecorationTheme(
      filled: true,
      fillColor: const Color(0xFFF1F5F9),
      contentPadding: const EdgeInsets.symmetric(horizontal: 18, vertical: 15),
      border: OutlineInputBorder(borderRadius: BorderRadius.circular(16), borderSide: BorderSide.none),
      enabledBorder: OutlineInputBorder(borderRadius: BorderRadius.circular(16), borderSide: BorderSide.none),
      focusedBorder: OutlineInputBorder(
        borderRadius: BorderRadius.circular(16),
        borderSide: const BorderSide(color: AppColors.primary, width: 1.5),
      ),
      hintStyle: const TextStyle(color: Color(0xFF9AA0AE), fontSize: 15),
    ),
    chipTheme: base.chipTheme.copyWith(
      backgroundColor: AppColors.primary.withValues(alpha: 0.08),
      labelStyle: const TextStyle(fontSize: 12, fontWeight: FontWeight.w600, color: AppColors.primary),
      side: BorderSide.none,
      shape: const StadiumBorder(),
      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 2),
    ),
    dividerTheme: const DividerThemeData(color: Color(0x0D000000), thickness: 1),
    // 浮动圆角提示条（替代全宽黑条）
    snackBarTheme: SnackBarThemeData(
      behavior: SnackBarBehavior.floating,
      backgroundColor: const Color(0xFF283044),
      contentTextStyle: const TextStyle(fontSize: 14, fontWeight: FontWeight.w600, color: Colors.white),
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
      insetPadding: const EdgeInsets.fromLTRB(20, 0, 20, 16),
      elevation: 4,
    ),
    bottomSheetTheme: const BottomSheetThemeData(
      backgroundColor: AppColors.surfaceLowest,
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.vertical(top: Radius.circular(28))),
    ),
  );
}

/// 通用软阴影白卡
class SoftCard extends StatelessWidget {
  final Widget child;
  final EdgeInsetsGeometry padding;
  final Color? color;
  final VoidCallback? onTap;
  const SoftCard({super.key, required this.child, this.padding = const EdgeInsets.all(20), this.color, this.onTap});

  @override
  Widget build(BuildContext context) {
    final card = Container(
      decoration: BoxDecoration(
        color: color ?? AppColors.surfaceLowest,
        borderRadius: BorderRadius.circular(kRadiusCard),
        boxShadow: kCardShadow,
      ),
      padding: padding,
      // 卡内自带一层透明 Material：卡里的 ListTile/InkWell 才有地方画水波纹。
      // 少了它，点击涟漪会被画在卡片背景「下面」——用户点了菜单行看不到任何反馈
      child: Material(
        type: MaterialType.transparency,
        borderRadius: BorderRadius.circular(kRadiusCard),
        child: child,
      ),
    );
    if (onTap == null) return card;
    return GestureDetector(onTap: onTap, child: card);
  }
}

/// 商品缩略图：有图显示图，没图显示首字色块。
/// 绝不显示灰色破图占位——大部分小店不会给每个商品拍照，破图会让整屏很脏。
class ProductThumb extends StatelessWidget {
  final String? imageUrl;
  final String name;
  final double size;
  const ProductThumb({super.key, required this.imageUrl, required this.name, this.size = 44});

  @override
  Widget build(BuildContext context) {
    final fallback = Container(
      width: size,
      height: size,
      decoration: BoxDecoration(color: AppColors.primaryFixed, borderRadius: BorderRadius.circular(size * 0.24)),
      alignment: Alignment.center,
      child: Text(
        name.isEmpty ? '?' : name.characters.first,
        style: TextStyle(fontSize: size * 0.42, fontWeight: FontWeight.w700, color: AppColors.primary),
      ),
    );
    if (imageUrl == null || imageUrl!.isEmpty) return fallback;
    return ClipRRect(
      borderRadius: BorderRadius.circular(size * 0.24),
      child: Image.network(
        Api.imageUrl(imageUrl),
        width: size,
        height: size,
        fit: BoxFit.cover,
        errorBuilder: (_, __, ___) => fallback,
        loadingBuilder: (ctx, child, progress) => progress == null ? child : fallback,
      ),
    );
  }
}

/// AI 功能强调卡（✨ 渐变，参考图里的 AI 智能辅助卡）
class AiGradientCard extends StatelessWidget {
  final Widget child;
  const AiGradientCard({super.key, required this.child});

  @override
  Widget build(BuildContext context) {
    return Container(
      decoration: BoxDecoration(
        gradient: const LinearGradient(
          begin: Alignment.topLeft,
          end: Alignment.bottomRight,
          colors: [Color(0xFFEAEDFF), Color(0xFFF6F1FF)],
        ),
        borderRadius: BorderRadius.circular(kRadiusCard),
        boxShadow: kCardShadow,
      ),
      padding: const EdgeInsets.all(20),
      child: child,
    );
  }
}
