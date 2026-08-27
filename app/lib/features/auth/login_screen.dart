import 'dart:io' show Platform;
import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:sign_in_with_apple/sign_in_with_apple.dart';
import 'package:url_launcher/url_launcher.dart';

import '../../core/celebration.dart';
import '../../core/legal.dart';
import '../../core/providers.dart';
import '../../core/theme.dart';

class LoginScreen extends ConsumerStatefulWidget {
  const LoginScreen({super.key});

  @override
  ConsumerState<LoginScreen> createState() => _LoginScreenState();
}

class _LoginScreenState extends ConsumerState<LoginScreen> {
  final _username = TextEditingController();
  final _password = TextEditingController();
  final _confirm = TextEditingController();
  final _realName = TextEditingController();
  bool _isRegister = false; // 登录 / 注册 模式切换
  bool _loading = false;

  void _toast(String msg) {
    if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(msg)));
  }

  Future<void> _submit() async {
    if (_loading) return;
    final username = _username.text.trim();
    if (username.isEmpty) return _toast('请填写用户名');
    if (_password.text.length < 6) return _toast('密码至少 6 位');
    if (_isRegister && _password.text != _confirm.text) return _toast('两次密码不一致');

    setState(() => _loading = true);
    try {
      if (_isRegister) {
        try {
          await ref.read(authProvider.notifier).register(username, _password.text, _realName.text.trim());
          ref.invalidate(profileProvider);
          // 开张仪式：不能当场弹——注册后路由整个重建，当场弹的对话框随旧树陪葬
          // （集成测试抓到的）。寄存给首页，新树第一帧播放，收场正好接三步开工
          final shopName = _realName.text.trim().isEmpty ? username : _realName.text.trim();
          PendingCelebration.set(
              icon: Icons.storefront_rounded,
              title: '开张大吉',
              subtitle: '「$shopName」建好了\n说一句话，第一笔账就记好了');
        } catch (e) {
          // 撞名兜底：如果这个名字+密码本来就是你的账号，直接登录进去
          if (e.toString().contains('已被注册')) {
            try {
              await ref.read(authProvider.notifier).login(username, _password.text);
              ref.invalidate(profileProvider);
              return;
            } catch (_) {
              _toast('用户名「$username」已被别人注册，换一个用户名（注意：是最上面的"用户名"，店名不用改）');
              return;
            }
          }
          rethrow;
        }
      } else {
        await ref.read(authProvider.notifier).login(username, _password.text);
        ref.invalidate(profileProvider);
      }
    } catch (e) {
      _toast(e.toString());
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  /// 忘记密码：这个 App 没有自助重置（没有短信/邮件通道），所以只能把三条路说清楚，
  /// 别让人在登录页反复试密码。文案与 Web 端一字不差。
  void _showForgotPassword() {
    showDialog<void>(
      context: context,
      builder: (dctx) => AlertDialog(
        title: const Text('忘记密码？'),
        content: Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.start, children: [
          const Text('① 员工账号', style: TextStyle(fontWeight: FontWeight.w700)),
          const SizedBox(height: 2),
          const Text('请店主在「设置→员工管理→重置密码」帮你重置（App 和网页后台都能操作）',
              style: TextStyle(fontSize: 13)),
          const SizedBox(height: 12),
          const Text('② 店主账号', style: TextStyle(fontWeight: FontWeight.w700)),
          const SizedBox(height: 2),
          const Text('通过帮助页 qxju.shop/stockmate/support 联系我们，附店名+注册用户名，人工核实后重置',
              style: TextStyle(fontSize: 13)),
          const SizedBox(height: 12),
          const Text('③ 用 Apple 登录的账号', style: TextStyle(fontWeight: FontWeight.w700)),
          const SizedBox(height: 2),
          const Text('不需要密码', style: TextStyle(fontSize: 13)),
        ]),
        actions: [
          TextButton(
            onPressed: () => launchUrl(Uri.parse(supportUrl), mode: LaunchMode.externalApplication),
            child: const Text('打开帮助页'),
          ),
          TextButton(onPressed: () => Navigator.pop(dctx), child: const Text('知道了')),
        ],
      ),
    );
  }

  /// Sign in with Apple（iOS 系统账号一键登录）
  Future<void> _appleLogin() async {
    if (_loading) return;
    setState(() => _loading = true);
    try {
      final credential = await SignInWithApple.getAppleIDCredential(
        scopes: [AppleIDAuthorizationScopes.fullName, AppleIDAuthorizationScopes.email],
      );
      final fullName = [credential.familyName, credential.givenName].whereType<String>().join('');
      await ref.read(authProvider.notifier).oauthLogin(
            provider: 'apple',
            identityToken: credential.identityToken,
            fullName: fullName,
          );
    } on SignInWithAppleAuthorizationException catch (e) {
      if (e.code != AuthorizationErrorCode.canceled && mounted) {
        ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text('Apple 登录失败：${e.message}')));
      }
    } catch (e) {
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text('$e')));
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final t = Theme.of(context).textTheme;
    return Scaffold(
      body: SafeArea(
        child: Padding(
          padding: const EdgeInsets.symmetric(horizontal: 28),
          child: Column(
            // 全列居中：原来品牌区左对齐、按钮和链接居中，两套对齐混在一页很不协调。
            // 登录页只有一件事（进来），经典的居中式最稳
            crossAxisAlignment: CrossAxisAlignment.center,
            children: [
              const Spacer(flex: 2),
              // 品牌区：用真实 App 图标资源——原来是代码画的星星方块，
              // 和桌面图标对不上号，用户装完点进来会觉得"这是同一个 App 吗"
              ClipRRect(
                borderRadius: BorderRadius.circular(22),
                child: Image.asset('assets/brand/icon.png', width: 88, height: 88),
              ),
              const SizedBox(height: 20),
              Text('智存', style: t.headlineLarge),
              const SizedBox(height: 8),
              // 副标题说人话。「AI 原生」是开发者黑话，摊主看不懂；
              // 顺带降低登录页的 AI 存在感（中国区生成式 AI 合规语境下没必要冲在脸上）
              Text('说一句话，账就记好了', style: t.bodyMedium),
              const Spacer(),
              TextField(
                controller: _username,
                decoration: const InputDecoration(labelText: '用户名'),
                textInputAction: TextInputAction.next,
              ),
              const SizedBox(height: 14),
              TextField(
                controller: _password,
                decoration: const InputDecoration(labelText: '密码（至少 6 位）'),
                obscureText: true,
                textInputAction: _isRegister ? TextInputAction.next : TextInputAction.done,
                onSubmitted: (_) => _isRegister ? null : _submit(),
              ),
              // 注册模式的额外字段
              if (_isRegister) ...[
                const SizedBox(height: 14),
                TextField(
                  controller: _confirm,
                  decoration: const InputDecoration(labelText: '确认密码'),
                  obscureText: true,
                  textInputAction: TextInputAction.next,
                ),
                const SizedBox(height: 14),
                TextField(
                  controller: _realName,
                  decoration: const InputDecoration(labelText: '店名/称呼（选填）'),
                  onSubmitted: (_) => _submit(),
                ),
              ],
              const SizedBox(height: 24),
              FilledButton(
                onPressed: _loading ? null : _submit,
                child: _loading
                    ? const SizedBox(width: 22, height: 22, child: CircularProgressIndicator(strokeWidth: 2.5, color: Colors.white))
                    : Text(_isRegister ? '注册并开始使用' : '登录'),
              ),
              const SizedBox(height: 10),
              Row(mainAxisAlignment: MainAxisAlignment.center, children: [
                TextButton(
                  onPressed: () => setState(() => _isRegister = !_isRegister),
                  child: Text(_isRegister ? '已有账号？去登录' : '没有账号？注册一个', style: const TextStyle(fontSize: 14)),
                ),
                // 登录模式才给：注册的时候问"忘记密码"没有意义
                if (!_isRegister)
                  TextButton(
                    onPressed: _showForgotPassword,
                    child: const Text('忘记密码？', style: TextStyle(fontSize: 14, color: AppColors.onSurfaceVariant)),
                  ),
              ]),
              // 平台账号登录：按系统显示对应入口
              if (!kIsWeb && Platform.isIOS) ...[
                const SizedBox(height: 14),
                Row(children: [
                  const Expanded(child: Divider()),
                  Padding(
                    padding: const EdgeInsets.symmetric(horizontal: 12),
                    child: Text('或', style: t.bodyMedium?.copyWith(fontSize: 12)),
                  ),
                  const Expanded(child: Divider()),
                ]),
                const SizedBox(height: 14),
                SignInWithAppleButton(
                  onPressed: _appleLogin,
                  text: '通过 Apple 登录',
                  height: 48,
                  style: SignInWithAppleButtonStyle.black,
                  borderRadius: const BorderRadius.all(Radius.circular(24)),
                ),
              ],
              // 安卓：微信登录待开放平台注册后接入；鸿蒙：华为账号（P2）
              const Spacer(flex: 3),
              // 合规：注册/登录必须带协议链接
              Center(
                child: Text.rich(
                  TextSpan(
                    style: const TextStyle(fontSize: 12, color: Colors.grey),
                    children: [const TextSpan(text: '登录/注册即代表同意 '), legalLinksSpan()],
                  ),
                  textAlign: TextAlign.center,
                ),
              ),
              // 工信部备案号：显著位置展示（关于页也有一处）
              if (icpFiling.isNotEmpty) ...[
                const SizedBox(height: 6),
                Center(
                  child: Text(icpFiling,
                      style: const TextStyle(fontSize: 11, color: Color(0xFFB9B9C6))),
                ),
              ],
              const SizedBox(height: 8),
            ],
          ),
        ),
      ),
    );
  }
}
