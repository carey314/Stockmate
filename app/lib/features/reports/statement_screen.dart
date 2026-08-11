import 'dart:io';
import 'dart:ui' as ui;
import 'package:flutter/material.dart';
import 'package:flutter/rendering.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:intl/intl.dart';
import 'package:path_provider/path_provider.dart';
import 'package:share_plus/share_plus.dart';
import '../../core/share_util.dart';
import '../../core/api.dart';
import '../../core/providers.dart';
import '../../core/theme.dart';
import 'reports_screen.dart' show DateRange;

final _money = NumberFormat('#,##0.##');
final _df = DateFormat('yyyy-MM-dd');
final _dt = DateFormat('MM-dd HH:mm');

/// 客户对账单：期初欠款 + 期间往来（销售单/收款）+ 期末欠款，票据样式可分享
class StatementScreen extends ConsumerStatefulWidget {
  final int customerId;
  const StatementScreen({super.key, required this.customerId});

  @override
  ConsumerState<StatementScreen> createState() => _StatementScreenState();
}

class _StatementScreenState extends ConsumerState<StatementScreen> {
  final _key = GlobalKey();
  DateRange _range = DateRange.thisMonth();
  Map<String, dynamic>? _data;
  bool _loading = true;
  bool _sharing = false;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    setState(() => _loading = true);
    try {
      final d = await Api.I.get('/reports/customer-statement?customerId=${widget.customerId}&${_range.qs}');
      if (mounted) setState(() => _data = Map<String, dynamic>.from(d));
    } catch (e) {
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text('$e')));
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  Future<void> _share() async {
    if (_sharing || _data == null) return;
    setState(() => _sharing = true);
    try {
      final boundary = _key.currentContext!.findRenderObject() as RenderRepaintBoundary;
      final image = await boundary.toImage(pixelRatio: 3.0);
      final bytes = (await image.toByteData(format: ui.ImageByteFormat.png))!.buffer.asUint8List();
      final dir = await getTemporaryDirectory();
      final file = File('${dir.path}/对账单_${_data!['customer']['name']}.png');
      await file.writeAsBytes(bytes);
      if (mounted) await shareFiles(context, [XFile(file.path)], text: '${_data!['customer']['name']} 对账单');
    } catch (e) {
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text('分享失败：$e')));
    } finally {
      if (mounted) setState(() => _sharing = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final d = _data;
    return Scaffold(
      appBar: AppBar(title: Text(d == null ? '对账单' : '${d['customer']['name']} · 对账单')),
      bottomNavigationBar: d == null
          ? null
          : SafeArea(
              child: Padding(
                padding: const EdgeInsets.fromLTRB(20, 8, 20, 12),
                child: FilledButton.icon(
                  onPressed: _sharing ? null : _share,
                  icon: _sharing
                      ? const SizedBox(width: 18, height: 18, child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white))
                      : const Icon(Icons.ios_share_rounded, size: 20),
                  label: Text(_sharing ? '生成中…' : '分享对账单（发给客户）'),
                ),
              ),
            ),
      body: Column(children: [
        Padding(
          padding: const EdgeInsets.fromLTRB(kPagePadding, 8, kPagePadding, 0),
          child: Row(children: [
            for (final r in [DateRange.thisWeek(), DateRange.thisMonth(), DateRange.lastMonth()]) ...[
              ChoiceChip(
                label: Text(r.label),
                selected: _range.label == r.label,
                onSelected: (_) {
                  setState(() => _range = r);
                  _load();
                },
              ),
              const SizedBox(width: 8),
            ],
            ChoiceChip(
              label: Text(_range.label == '自定义' ? '${_df.format(_range.start)}~${_df.format(_range.end)}' : '自定义'),
              selected: _range.label == '自定义',
              onSelected: (_) async {
                final picked = await showDateRangePicker(
                  context: context,
                  firstDate: DateTime(2024),
                  lastDate: DateTime.now(),
                  initialDateRange: DateTimeRange(start: _range.start, end: _range.end),
                );
                if (picked != null) {
                  setState(() => _range = DateRange(picked.start, picked.end, '自定义'));
                  _load();
                }
              },
            ),
          ]),
        ),
        Expanded(
          child: _loading
              ? const Center(child: CircularProgressIndicator())
              : d == null
                  ? const Center(child: Text('加载失败，下拉重试'))
                  : SingleChildScrollView(
                      padding: const EdgeInsets.all(kPagePadding),
                      child: RepaintBoundary(key: _key, child: _StatementSheet(data: d, range: _range)),
                    ),
        ),
      ]),
    );
  }
}

class _StatementSheet extends ConsumerWidget {
  final Map<String, dynamic> data;
  final DateRange range;
  const _StatementSheet({required this.data, required this.range});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final d = data;
    final customer = d['customer'];
    final rows = List<Map<String, dynamic>>.from(d['rows'] ?? []);
    final closing = (d['closing'] ?? 0).toDouble();
    final shopName = ref.watch(profileProvider).valueOrNull?['shopName'] ?? '对账单';
    const label = TextStyle(fontSize: 11, color: Color(0xFF888888));
    const value = TextStyle(fontSize: 12, color: Color(0xFF222222));

    return Container(
      color: Colors.white,
      padding: const EdgeInsets.all(20),
      child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
        Center(
          child: Column(children: [
            Text(shopName, style: const TextStyle(fontSize: 20, fontWeight: FontWeight.w800, color: Colors.black)),
            const SizedBox(height: 2),
            const Text('对 账 单', style: TextStyle(fontSize: 13, letterSpacing: 6, color: Color(0xFF555555))),
          ]),
        ),
        const SizedBox(height: 12),
        Text('客户：${customer['name']}${(customer['phone'] ?? '') != '' && customer['phone'] != null ? '（${customer['phone']}）' : ''}', style: value),
        Text('账期：${_df.format(range.start)} 至 ${_df.format(range.end)}', style: value),
        const SizedBox(height: 10),
        const Divider(color: Colors.black, height: 1, thickness: 1),
        Padding(
          padding: const EdgeInsets.symmetric(vertical: 6),
          child: Row(children: const [
            Expanded(flex: 3, child: Text('日期/单号', style: label)),
            Expanded(flex: 3, child: Text('摘要', style: label)),
            Expanded(flex: 2, child: Text('应收', style: label, textAlign: TextAlign.right)),
            Expanded(flex: 2, child: Text('已收', style: label, textAlign: TextAlign.right)),
          ]),
        ),
        const Divider(color: Color(0xFFDDDDDD), height: 1),
        // 期初
        Padding(
          padding: const EdgeInsets.symmetric(vertical: 6),
          child: Row(children: [
            const Expanded(flex: 6, child: Text('期初欠款', style: value)),
            Expanded(flex: 4, child: Text('¥${_money.format(d['opening'])}', style: value, textAlign: TextAlign.right)),
          ]),
        ),
        if (rows.isEmpty)
          const Padding(padding: EdgeInsets.symmetric(vertical: 10), child: Text('本期无往来', style: label)),
        for (final x in rows)
          Padding(
            padding: const EdgeInsets.symmetric(vertical: 5),
            child: Row(children: [
              Expanded(flex: 3, child: Text('${_dt.format(DateTime.parse(x['at']).toLocal())}\n${x['ref'] ?? ''}', style: const TextStyle(fontSize: 10, color: Color(0xFF555555)))),
              Expanded(flex: 3, child: Text('${x['type']}${(x['note'] ?? '') != '' && x['note'] != null ? '\n${x['note']}' : ''}', style: const TextStyle(fontSize: 10, color: Color(0xFF555555)))),
              Expanded(flex: 2, child: Text((x['debit'] ?? 0) > 0 ? '¥${_money.format(x['debit'])}' : '-', style: value, textAlign: TextAlign.right)),
              Expanded(flex: 2, child: Text((x['credit'] ?? 0) > 0 ? '¥${_money.format(x['credit'])}' : '-', style: value, textAlign: TextAlign.right)),
            ]),
          ),
        const Divider(color: Colors.black, height: 1, thickness: 1),
        const SizedBox(height: 8),
        Align(
          alignment: Alignment.centerRight,
          child: Column(crossAxisAlignment: CrossAxisAlignment.end, children: [
            Text('本期应收：¥${_money.format(d['periodDebit'])}   本期已收：¥${_money.format(d['periodCredit'])}', style: value),
            const SizedBox(height: 4),
            Text('期末欠款：¥${_money.format(closing)}',
                style: TextStyle(fontSize: 16, fontWeight: FontWeight.w800, color: closing > 0 ? const Color(0xFFB25E00) : Colors.black)),
          ]),
        ),
        const SizedBox(height: 12),
        Row(children: [
          const Expanded(child: Text('如有疑问请及时核对', style: label)),
          Text('生成时间：${_dt.format(DateTime.now())}', style: label),
        ]),
      ]),
    );
  }
}
