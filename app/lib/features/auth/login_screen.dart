import 'dart:io' show Platform;
import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:sign_in_with_apple/sign_in_with_apple.dart';

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
    // 提前拿 messenger：登录成功后本页会被路由替换，但提示条挂在更上层，依然能弹出来
    final messenger = ScaffoldMessenger.of(context);
    try {
      if (_isRegister) {
        try {
          await ref.read(authProvider.notifier).register(username, _password.text, _realName.text.trim());
          ref.invalidate(profileProvider);
          messenger.showSnackBar(SnackBar(content: Text('🎉 注册成功，欢迎「${_realName.text.trim().isEmpty ? username : _realName.text.trim()}」开张！')));
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
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              const Spacer(flex: 2),
              // 品牌区
              Container(
                width: 64,
                height: 64,
                decoration: BoxDecoration(
                  gradient: const LinearGradient(colors: [AppColors.primary, Color(0xFF6A5AE0)]),
                  borderRadius: BorderRadius.circular(20),
                ),
                child: const Icon(Icons.auto_awesome, color: Colors.white, size: 30),
              ),
              const SizedBox(height: 24),
              Text('StockMate 智存', style: t.headlineLarge),
              const SizedBox(height: 8),
              Text('AI 原生 · 什么生意都能管的进销存', style: t.bodyMedium),
              const Spacer(),
              TextField(
                controller: _username,
                decoration: const InputDecoration(hintText: '用户名'),
                textInputAction: TextInputAction.next,
              ),
              const SizedBox(height: 14),
              TextField(
                controller: _password,
                decoration: const InputDecoration(hintText: '密码（至少 6 位）'),
                obscureText: true,
                textInputAction: _isRegister ? TextInputAction.next : TextInputAction.done,
                onSubmitted: (_) => _isRegister ? null : _submit(),
              ),
              // 注册模式的额外字段
              if (_isRegister) ...[
                const SizedBox(height: 14),
                TextField(
                  controller: _confirm,
                  decoration: const InputDecoration(hintText: '确认密码'),
                  obscureText: true,
                  textInputAction: TextInputAction.next,
                ),
                const SizedBox(height: 14),
                TextField(
                  controller: _realName,
                  decoration: const InputDecoration(hintText: '店名/称呼（选填）'),
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
              Center(
                child: TextButton(
                  onPressed: () => setState(() => _isRegister = !_isRegister),
                  child: Text(_isRegister ? '已有账号？去登录' : '没有账号？注册一个', style: const TextStyle(fontSize: 14)),
                ),
              ),
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
              const SizedBox(height: 8),
            ],
          ),
        ),
      ),
    );
  }
}
