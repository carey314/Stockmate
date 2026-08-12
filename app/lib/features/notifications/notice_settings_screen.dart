import 'package:flutter/material.dart';
import '../../core/local_notice.dart';
import '../../core/theme.dart';

/// 提醒设置：收摊提醒开关 + 时间。入口在通知中心右上角齿轮。
/// 用 Navigator.push 进入（不占 go_router 路由表）。
class NoticeSettingsScreen extends StatefulWidget {
  const NoticeSettingsScreen({super.key});

  @override
  State<NoticeSettingsScreen> createState() => _NoticeSettingsScreenState();
}

class _NoticeSettingsScreenState extends State<NoticeSettingsScreen> {
  bool _enabled = false;
  TimeOfDay _time = const TimeOfDay(hour: 21, minute: 0);
  bool _loading = true;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    final on = await LocalNotice.I.enabled;
    final (h, m) = await LocalNotice.I.time;
    if (!mounted) return;
    setState(() {
      _enabled = on;
      _time = TimeOfDay(hour: h, minute: m);
      _loading = false;
    });
  }

  Future<void> _toggle(bool on) async {
    final ok = await LocalNotice.I.setEnabled(on);
    if (!mounted) return;
    if (on && !ok) {
      // iOS 拒绝过一次后系统不会再弹权限框，只能去系统设置里开
      ScaffoldMessenger.of(context).showSnackBar(const SnackBar(
        content: Text('通知权限没开。去 系统设置 → 智存 → 通知 里打开后，回来再试'),
        duration: Duration(seconds: 4),
      ));
      setState(() => _enabled = false);
      return;
    }
    setState(() => _enabled = on && ok);
    if (on && ok) {
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(
        content: Text('✓ 已开启，每天 ${_fmt(_time)} 提醒你收摊记账'),
      ));
    }
  }

  Future<void> _pickTime() async {
    final picked = await showTimePicker(context: context, initialTime: _time);
    if (picked == null || !mounted) return;
    setState(() => _time = picked);
    await LocalNotice.I.setTime(picked.hour, picked.minute);
    if (_enabled && mounted) {
      ScaffoldMessenger.of(context)
          .showSnackBar(SnackBar(content: Text('✓ 改好了，每天 ${_fmt(picked)} 提醒')));
    }
  }

  String _fmt(TimeOfDay t) =>
      '${t.hour.toString().padLeft(2, '0')}:${t.minute.toString().padLeft(2, '0')}';

  @override
  Widget build(BuildContext context) {
    final t = Theme.of(context).textTheme;
    return Scaffold(
      appBar: AppBar(title: const Text('提醒设置')),
      body: _loading
          ? const Center(child: CircularProgressIndicator())
          : ListView(
              padding: const EdgeInsets.all(16),
              children: [
                SoftCard(
                  child: Column(
                    children: [
                      SwitchListTile(
                        title: const Text('每日收摊提醒'),
                        subtitle: const Text('到点提醒记账、看今天卖了多少'),
                        value: _enabled,
                        onChanged: _toggle,
                      ),
                      if (_enabled)
                        ListTile(
                          title: const Text('提醒时间'),
                          subtitle: const Text('一般设在收摊前后'),
                          trailing: Text(_fmt(_time),
                              style: t.titleMedium?.copyWith(fontWeight: FontWeight.w700)),
                          onTap: _pickTime,
                        ),
                    ],
                  ),
                ),
                const SizedBox(height: 12),
                Padding(
                  padding: const EdgeInsets.symmetric(horizontal: 8),
                  child: Text(
                    '提醒由手机本地发出，不经过服务器，关掉后不会再响。'
                    '超过 3 天没打开 App 时会额外提醒一次，打开过就不会响。',
                    style: t.bodySmall?.copyWith(color: Colors.grey),
                  ),
                ),
              ],
            ),
    );
  }
}
