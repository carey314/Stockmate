import 'dart:io';

import 'package:flutter/gestures.dart';
import 'package:flutter/material.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:url_launcher/url_launcher.dart';

/// 法务三件套：隐私政策 / 用户协议 / 首启同意页
/// 中国区合规（工信部 + 个保法）：首次启动必须弹隐私同意，注册页必须带协议链接
const privacyUrl = 'https://qxju.shop/stockmate/privacy';
const termsUrl = 'https://qxju.shop/stockmate/terms';
const supportUrl = 'https://qxju.shop/stockmate/support';
const _agreedKey = 'privacy_agreed_v1';

/// 工信部 App 备案号。备案通过后把号填在这里即可（工信部要求 App 内显著位置展示）。
/// 例：'京ICP备2026XXXXXX号-2A'
const icpFiling = '';

Future<void> openLegal(String url) async {
  await launchUrl(Uri.parse(url), mode: LaunchMode.externalApplication);
}

/// 「《用户协议》和《隐私政策》」富文本片段（登录页/同意页共用）
TextSpan legalLinksSpan({Color? linkColor}) {
  final style = TextStyle(color: linkColor ?? const Color(0xFF5B5BD6), fontWeight: FontWeight.w600);
  return TextSpan(children: [
    TextSpan(text: '《用户协议》', style: style, recognizer: TapGestureRecognizer()..onTap = () => openLegal(termsUrl)),
    const TextSpan(text: ' 和 '),
    TextSpan(text: '《隐私政策》', style: style, recognizer: TapGestureRecognizer()..onTap = () => openLegal(privacyUrl)),
  ]);
}

/// 首启隐私同意门：没同意过就整屏盖住 app，同意才放行，不同意退出。
/// 不用 showDialog（MaterialApp.builder 层拿不到 Navigator），直接条件渲染。
class PrivacyGate extends StatefulWidget {
  final Widget child;
  const PrivacyGate({super.key, required this.child});

  @override
  State<PrivacyGate> createState() => _PrivacyGateState();
}

class _PrivacyGateState extends State<PrivacyGate> {
  bool? _agreed; // null = 读取中（读取极快，不闪屏）

  @override
  void initState() {
    super.initState();
    SharedPreferences.getInstance().then((p) {
      if (mounted) setState(() => _agreed = p.getBool(_agreedKey) ?? false);
    });
  }

  Future<void> _agree() async {
    (await SharedPreferences.getInstance()).setBool(_agreedKey, true);
    if (mounted) setState(() => _agreed = true);
  }

  @override
  Widget build(BuildContext context) {
    if (_agreed != false) return widget.child; // 已同意或读取中：直接放行
    final t = Theme.of(context).textTheme;
    return Material(
      color: Theme.of(context).scaffoldBackgroundColor,
      child: SafeArea(
        child: Padding(
          padding: const EdgeInsets.all(28),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              const Spacer(),
              Text('欢迎使用智存', style: t.headlineMedium?.copyWith(fontWeight: FontWeight.w800)),
              const SizedBox(height: 16),
              Text('在使用前，请了解我们如何对待你的数据：', style: t.bodyLarge),
              const SizedBox(height: 12),
              Text(
                '· 你录入的经营数据只用于为你提供进销存功能，存储在中国境内服务器，加密传输\n'
                '· 记账文字会发送给第三方 AI（DeepSeek）做解析；语音由 iOS 系统转成文字（可能经苹果服务器），录音不会传到我们的服务器\n'
                '· 不投广告、不做画像追踪、不出售数据\n'
                '· 可随时在 App 内导出全部数据或删除账号',
                style: t.bodyMedium?.copyWith(height: 1.9),
              ),
              const SizedBox(height: 16),
              Text.rich(
                TextSpan(style: t.bodyMedium, children: [const TextSpan(text: '详细内容请阅读 '), legalLinksSpan()]),
              ),
              const Spacer(),
              SizedBox(
                width: double.infinity,
                child: FilledButton(onPressed: _agree, child: const Text('同意并继续')),
              ),
              const SizedBox(height: 8),
              SizedBox(
                width: double.infinity,
                child: TextButton(onPressed: () => exit(0), child: const Text('不同意并退出')),
              ),
            ],
          ),
        ),
      ),
    );
  }
}
