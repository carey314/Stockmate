import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:intl/intl.dart';

import '../../core/api.dart';
import '../../core/theme.dart';

/// 收益日历：按天看钱的进出（现金口径，和资金流水报表同一套数）。
///
/// 两个视图（参考 Todoist 日历的形态，按手机竖屏改造）：
///   月 —— 格子里直接标每天的净额；点某天，下面给 日/月/年 三级汇总卡
///   周 —— 7 列排开，每一笔收支是一张小卡直接铺在当天的列里（打开就能看见，不用逐日点）；
///         点哪天，下面像待办清单一样列出这天每一笔钱因为什么进出
/// 仅老板可见（后端 adminOnly 硬拦，入口在「我的」菜单，与报表中心同级）。
class CalendarScreen extends ConsumerStatefulWidget {
  const CalendarScreen({super.key});

  @override
  ConsumerState<CalendarScreen> createState() => _CalendarScreenState();
}

final _money = NumberFormat('#,##0.##');
final _df = DateFormat('yyyy-MM-dd');
const _weekdays = ['一', '二', '三', '四', '五', '六', '日'];

/// 日历格子里的紧凑金额：格子只有几十个点宽，"¥12,345.67"必然溢出
String _compact(double v) {
  final a = v.abs();
  final sign = v > 0 ? '+' : (v < 0 ? '-' : '');
  if (a >= 10000) return '$sign${(a / 10000).toStringAsFixed(1)}万';
  if (a >= 1000) return '$sign${(a / 1000).toStringAsFixed(1)}k';
  return '$sign${a.round()}';
}

class _CalendarScreenState extends ConsumerState<CalendarScreen> {
  int _mode = 0; // 0=月 1=周
  late DateTime _month; // 月视图当前显示的月（取每月1号）
  late DateTime _selected; // 选中的日
  late DateTime _weekStart; // 周视图当前周的周一
  Map<String, dynamic> _days = {}; // 月格子 date -> {income, expense, net}
  Map<String, dynamic>? _day; // 选中日的 日/月/年 汇总（月视图概览用）
  Map<String, dynamic> _week = {}; // 周数据 date -> {income, expense, net, count, events[前8笔]}
  bool _loadingDay = false;
  bool _loadingWeek = false;
  bool _showAllEvents = false; // 几百笔的日子先出前30笔，点"展开"再全量渲染

  static DateTime _mondayOf(DateTime d) => DateTime(d.year, d.month, d.day - (d.weekday - 1));

  @override
  void initState() {
    super.initState();
    final now = DateTime.now();
    _month = DateTime(now.year, now.month, 1);
    _selected = DateTime(now.year, now.month, now.day);
    _weekStart = _mondayOf(_selected);
    _loadMonth();
    _loadDay();
  }

  Future<void> _loadMonth() async {
    try {
      final m = '${_month.year}-${_month.month.toString().padLeft(2, '0')}';
      final data = await Api.I.get('/calendar/month', query: {'month': m});
      if (mounted) setState(() => _days = Map<String, dynamic>.from(data['days'] ?? {}));
    } catch (_) {
      if (mounted) setState(() => _days = {});
    }
  }

  Future<void> _loadDay() async {
    setState(() {
      _loadingDay = true;
      _showAllEvents = false;
    });
    try {
      final data = await Api.I.get('/calendar/day', query: {'date': _df.format(_selected)});
      if (mounted) setState(() => _day = Map<String, dynamic>.from(data));
    } catch (_) {
      if (mounted) setState(() => _day = null);
    } finally {
      if (mounted) setState(() => _loadingDay = false);
    }
  }

  Future<void> _loadWeek() async {
    setState(() => _loadingWeek = true);
    try {
      final data = await Api.I.get('/calendar/week', query: {'start': _df.format(_weekStart)});
      if (mounted) setState(() => _week = Map<String, dynamic>.from(data['days'] ?? {}));
    } catch (_) {
      if (mounted) setState(() => _week = {});
    } finally {
      if (mounted) setState(() => _loadingWeek = false);
    }
  }

  void _shiftMonth(int delta) {
    setState(() {
      _month = DateTime(_month.year, _month.month + delta, 1);
      _days = {};
    });
    _loadMonth();
  }

  void _shiftWeek(int delta) {
    setState(() {
      _weekStart = DateTime(_weekStart.year, _weekStart.month, _weekStart.day + 7 * delta);
      // 选中日跟着周走（保持同一个星期几），不然下面的清单还停在上一周
      _selected = DateTime(_weekStart.year, _weekStart.month, _weekStart.day + (_selected.weekday - 1));
      _week = {};
    });
    _loadWeek();
    _loadDay();
  }

  void _pickInMonth(DateTime d) {
    setState(() => _selected = d);
    _loadDay();
  }

  /// 月视图跳周视图，锚在选中那天——"想看这天每一笔"的自然去处
  void _gotoWeekOf(DateTime d) {
    setState(() {
      _mode = 1;
      _selected = d;
      _weekStart = _mondayOf(d);
    });
    _loadWeek();
  }

  @override
  Widget build(BuildContext context) {
    final t = Theme.of(context).textTheme;
    return Scaffold(
      appBar: AppBar(title: const Text('收益日历')),
      body: RefreshIndicator(
        onRefresh: () async {
          if (_mode == 0) {
            await _loadMonth();
            await _loadDay();
          } else {
            await _loadWeek();
          }
        },
        child: ListView(
          padding: const EdgeInsets.fromLTRB(kPagePadding, 8, kPagePadding, 32),
          children: [
            Row(children: [
              Expanded(
                child: SegmentedButton<int>(
                  segments: const [
                    ButtonSegment(value: 0, label: Text('月'), icon: Icon(Icons.calendar_view_month_rounded, size: 16)),
                    ButtonSegment(value: 1, label: Text('周'), icon: Icon(Icons.view_week_rounded, size: 16)),
                  ],
                  selected: {_mode},
                  onSelectionChanged: (s) {
                    setState(() => _mode = s.first);
                    if (_mode == 1) {
                      _weekStart = _mondayOf(_selected);
                      _loadWeek();
                      if (_day == null || _day!['date'] != _df.format(_selected)) _loadDay();
                    }
                  },
                  style: const ButtonStyle(visualDensity: VisualDensity.compact),
                ),
              ),
            ]),
            const SizedBox(height: 8),
            if (_mode == 0) ..._monthView(t) else ..._weekView(t),
          ],
        ),
      ),
    );
  }

  // ===== 月视图：格子 + 日/月/年概览 =====

  List<Widget> _monthView(TextTheme t) {
    return [
      _monthHeader(t),
      // 口径必须写在界面上，不能只写在代码注释里。用户拿这页的数字去对首页毛利/销售额时，
      // 对不上只会觉得"软件算错了"——先告诉他这页算的是真金白银的进出。web 端也是这么标的。
      Padding(
        padding: const EdgeInsets.only(bottom: 6),
        child: Text('现金口径 · 只算真金白银的进出，与资金流水一致（毛利在报表中心）',
            style: t.bodyMedium?.copyWith(fontSize: 11)),
      ),
      _grid(t),
      const SizedBox(height: 14),
      if (_loadingDay)
        const Padding(padding: EdgeInsets.all(32), child: Center(child: CircularProgressIndicator()))
      else if (_day == null)
        SoftCard(child: Text('加载失败，下拉重试', style: t.bodyMedium))
      else
        ..._overview(t),
    ];
  }

  Widget _monthHeader(TextTheme t) {
    final now = DateTime.now();
    final isThisMonth = _month.year == now.year && _month.month == now.month;
    return Row(children: [
      IconButton(onPressed: () => _shiftMonth(-1), icon: const Icon(Icons.chevron_left_rounded)),
      Expanded(
        child: Center(child: Text('${_month.year}年${_month.month}月', style: t.titleLarge)),
      ),
      IconButton(onPressed: () => _shiftMonth(1), icon: const Icon(Icons.chevron_right_rounded)),
      if (!isThisMonth)
        TextButton(
          onPressed: () {
            setState(() {
              _month = DateTime(now.year, now.month, 1);
              _selected = DateTime(now.year, now.month, now.day);
            });
            _loadMonth();
            _loadDay();
          },
          child: const Text('回今天', style: TextStyle(fontSize: 12)),
        ),
    ]);
  }

  Widget _grid(TextTheme t) {
    final firstWeekday = _month.weekday; // 1=周一
    final daysInMonth = DateTime(_month.year, _month.month + 1, 0).day;
    final today = DateTime.now();
    final cells = <Widget>[];

    for (final w in _weekdays) {
      cells.add(Center(child: Text(w, style: t.bodyMedium?.copyWith(fontSize: 11))));
    }
    for (var i = 1; i < firstWeekday; i++) {
      cells.add(const SizedBox.shrink());
    }
    for (var d = 1; d <= daysInMonth; d++) {
      final date = DateTime(_month.year, _month.month, d);
      final key = _df.format(date);
      final cell = _days[key];
      final net = (cell?['net'] as num?)?.toDouble();
      final isToday = date.year == today.year && date.month == today.month && date.day == today.day;
      final isSelected = date.year == _selected.year && date.month == _selected.month && date.day == _selected.day;
      final isFuture = date.isAfter(today);

      cells.add(InkWell(
        onTap: isFuture ? null : () => _pickInMonth(date),
        borderRadius: BorderRadius.circular(10),
        child: Container(
          decoration: BoxDecoration(
            color: isSelected ? AppColors.primary : null,
            border: isToday && !isSelected ? Border.all(color: AppColors.primary, width: 1.2) : null,
            borderRadius: BorderRadius.circular(10),
          ),
          padding: const EdgeInsets.symmetric(vertical: 4),
          child: Column(mainAxisAlignment: MainAxisAlignment.center, children: [
            Text(
              '$d',
              style: TextStyle(
                fontSize: 14,
                fontWeight: isToday || isSelected ? FontWeight.w700 : FontWeight.w500,
                color: isSelected ? Colors.white : (isFuture ? AppColors.outlineVariant : AppColors.onSurface),
              ),
            ),
            SizedBox(
              height: 12,
              child: net == null || net == 0
                  ? null
                  : Text(
                      _compact(net),
                      maxLines: 1,
                      style: TextStyle(
                        fontSize: 9,
                        fontWeight: FontWeight.w600,
                        color: isSelected ? Colors.white : (net > 0 ? AppColors.success : AppColors.error),
                      ),
                    ),
            ),
          ]),
        ),
      ));
    }

    return SoftCard(
      padding: const EdgeInsets.fromLTRB(10, 12, 10, 10),
      child: GridView.count(
        crossAxisCount: 7,
        shrinkWrap: true,
        physics: const NeverScrollableScrollPhysics(),
        childAspectRatio: 0.92,
        children: cells,
      ),
    );
  }

  List<Widget> _overview(TextTheme t) {
    final d = _day!;
    Widget bigCard(String label, Map<String, dynamic> v, {bool hero = false}) {
      final net = (v['net'] as num).toDouble();
      return SoftCard(
        child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          Row(children: [
            Text(label, style: t.labelMedium?.copyWith(color: AppColors.primary)),
            const Spacer(),
            if (hero)
              // 想看这天每一笔？去周视图，那里逐笔铺开
              InkWell(
                onTap: () => _gotoWeekOf(_selected),
                borderRadius: BorderRadius.circular(8),
                child: Padding(
                  padding: const EdgeInsets.symmetric(horizontal: 4, vertical: 2),
                  child: Row(mainAxisSize: MainAxisSize.min, children: [
                    Text('看每一笔', style: t.bodyMedium?.copyWith(fontSize: 12, color: AppColors.primary)),
                    const Icon(Icons.chevron_right_rounded, size: 16, color: AppColors.primary),
                  ]),
                ),
              ),
          ]),
          const SizedBox(height: 8),
          if (hero) ...[
            Text(
              '${net >= 0 ? '+' : ''}¥${_money.format(net)}',
              style: TextStyle(fontSize: 32, fontWeight: FontWeight.w800, color: net >= 0 ? AppColors.onSurface : AppColors.error),
            ),
            const SizedBox(height: 6),
          ],
          Row(children: [
            Expanded(child: _kv(t, '收入', (v['income'] as num).toDouble(), AppColors.success)),
            Expanded(child: _kv(t, '支出', (v['expense'] as num).toDouble(), AppColors.error)),
            if (!hero) Expanded(child: _kv(t, '净', net, net >= 0 ? AppColors.onSurface : AppColors.error)),
          ]),
        ]),
      );
    }

    final sel = _selected;
    final isToday = _df.format(sel) == _df.format(DateTime.now());
    return [
      bigCard(isToday ? '今天' : '${sel.month}月${sel.day}日', Map<String, dynamic>.from(d['day']), hero: true),
      const SizedBox(height: 10),
      bigCard('${sel.month}月累计', Map<String, dynamic>.from(d['month'])),
      const SizedBox(height: 10),
      bigCard('${sel.year}年累计', Map<String, dynamic>.from(d['year'])),
    ];
  }

  Widget _kv(TextTheme t, String k, double v, Color c) {
    return Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
      Text(k, style: t.bodyMedium?.copyWith(fontSize: 11)),
      const SizedBox(height: 2),
      Text('¥${_money.format(v)}', style: TextStyle(fontSize: 15, fontWeight: FontWeight.w700, color: c)),
    ]);
  }

  // ===== 周视图：7 列事件小卡（Todoist 式）+ 选中日清单 =====

  List<Widget> _weekView(TextTheme t) {
    final selKey = _df.format(_selected);
    final selDay = _week[selKey] as Map<String, dynamic>?;
    final selCount = (selDay?['count'] as num?)?.toInt() ?? ((selDay?['events'] as List?)?.length ?? 0);
    final selNet = (selDay?['net'] as num?)?.toDouble() ?? 0;
    final isToday = selKey == _df.format(DateTime.now());
    // 逐笔清单走 /calendar/day 全量（周接口每天只带前8笔喂看板小卡）
    final dayReady = _day != null && _day!['date'] == selKey;
    final selEvents = dayReady ? List<Map<String, dynamic>>.from(_day!['events'] ?? []) : <Map<String, dynamic>>[];

    return [
      _weekHeader(t),
      const SizedBox(height: 8),
      if (_loadingWeek)
        const Padding(padding: EdgeInsets.all(48), child: Center(child: CircularProgressIndicator()))
      else ...[
        _weekBoard(t),
        const SizedBox(height: 16),
        Row(children: [
          Text(
            isToday ? '今天' : '${_selected.month}月${_selected.day}日 · 周${_weekdays[_selected.weekday - 1]}',
            style: t.titleMedium,
          ),
          const Spacer(),
          if (selCount > 0)
            Text(
              '$selCount 笔 · 净 ${_compact(selNet)}',
              style: TextStyle(
                fontSize: 14,
                fontWeight: FontWeight.w700,
                color: selNet >= 0 ? AppColors.success : AppColors.error,
              ),
            ),
        ]),
        const SizedBox(height: 8),
        if (!dayReady || _loadingDay)
          const Padding(padding: EdgeInsets.all(24), child: Center(child: CircularProgressIndicator()))
        else
          ..._eventList(t, selEvents),
      ],
    ];
  }

  Widget _weekHeader(TextTheme t) {
    final end = DateTime(_weekStart.year, _weekStart.month, _weekStart.day + 6);
    final now = DateTime.now();
    final isThisWeek = _df.format(_weekStart) == _df.format(_mondayOf(now));
    final yearPrefix = _weekStart.year == now.year ? '' : '${_weekStart.year}年';
    return Row(children: [
      IconButton(onPressed: () => _shiftWeek(-1), icon: const Icon(Icons.chevron_left_rounded)),
      Expanded(
        child: Center(
          child: Text('$yearPrefix${_weekStart.month}月${_weekStart.day}日 – ${end.month}月${end.day}日', style: t.titleMedium),
        ),
      ),
      IconButton(onPressed: () => _shiftWeek(1), icon: const Icon(Icons.chevron_right_rounded)),
      if (!isThisWeek)
        TextButton(
          onPressed: () {
            setState(() {
              _weekStart = _mondayOf(now);
              _selected = DateTime(now.year, now.month, now.day);
              _week = {};
            });
            _loadWeek();
          },
          child: const Text('回本周', style: TextStyle(fontSize: 12)),
        ),
    ]);
  }

  /// 7 列看板：每天一列，这天的每一笔钱是一张小卡贴在列里。
  /// 列宽只有 ~46pt，小卡上只放得下"色点+金额"；标题、时间、跳单据都在下面的清单里。
  Widget _weekBoard(TextTheme t) {
    final today = DateTime.now();
    final todayKey = _df.format(DateTime(today.year, today.month, today.day));
    const maxChips = 8; // 一列最多铺 8 张，再多折叠成 "+n"

    final columns = <Widget>[];
    for (var i = 0; i < 7; i++) {
      final date = DateTime(_weekStart.year, _weekStart.month, _weekStart.day + i);
      final key = _df.format(date);
      final events = List<Map<String, dynamic>>.from(((_week[key] as Map?)?['events'] as List?) ?? []);
      // 折叠数按总笔数算（接口只带前8笔，几百笔的日子 events.length 恒为8）
      final count = ((_week[key] as Map?)?['count'] as num?)?.toInt() ?? events.length;
      final isSelected = key == _df.format(_selected);
      final isToday = key == todayKey;
      final isFuture = date.isAfter(today);

      final chips = <Widget>[];
      final overflow = count > maxChips ? count - (maxChips - 1) : 0;
      final shown = overflow > 0 ? events.take(maxChips - 1) : events;
      for (final e in shown) {
        final isIn = e['direction'] == 'in';
        final c = isIn ? AppColors.success : AppColors.error;
        final amt = (e['amount'] as num).toDouble();
        chips.add(Container(
          margin: const EdgeInsets.only(top: 3),
          padding: const EdgeInsets.symmetric(vertical: 4, horizontal: 2),
          decoration: BoxDecoration(
            color: c.withValues(alpha: 0.12),
            borderRadius: BorderRadius.circular(6),
          ),
          child: FittedBox(
            fit: BoxFit.scaleDown,
            child: Text(
              _compact(isIn ? amt : -amt),
              maxLines: 1,
              style: TextStyle(fontSize: 10, fontWeight: FontWeight.w700, color: c),
            ),
          ),
        ));
      }
      if (overflow > 0) {
        chips.add(Container(
          margin: const EdgeInsets.only(top: 3),
          padding: const EdgeInsets.symmetric(vertical: 4, horizontal: 2),
          decoration: BoxDecoration(
            color: AppColors.outlineVariant.withValues(alpha: 0.25),
            borderRadius: BorderRadius.circular(6),
          ),
          child: Center(
            child: Text('+$overflow', maxLines: 1, style: t.bodyMedium?.copyWith(fontSize: 10, fontWeight: FontWeight.w600)),
          ),
        ));
      }

      columns.add(Expanded(
        child: InkWell(
          onTap: () {
            if (key == _df.format(_selected)) return;
            setState(() => _selected = date);
            _loadDay();
          },
          borderRadius: BorderRadius.circular(10),
          child: Container(
            decoration: BoxDecoration(
              color: isSelected ? AppColors.primary.withValues(alpha: 0.06) : null,
              borderRadius: BorderRadius.circular(10),
            ),
            padding: const EdgeInsets.symmetric(horizontal: 2, vertical: 6),
            child: Column(children: [
              Text(_weekdays[i], style: t.bodyMedium?.copyWith(fontSize: 10)),
              const SizedBox(height: 4),
              Container(
                width: 26,
                height: 26,
                decoration: BoxDecoration(
                  color: isSelected ? AppColors.primary : null,
                  border: isToday && !isSelected ? Border.all(color: AppColors.primary, width: 1.2) : null,
                  shape: BoxShape.circle,
                ),
                alignment: Alignment.center,
                child: Text(
                  '${date.day}',
                  style: TextStyle(
                    fontSize: 13,
                    fontWeight: isToday || isSelected ? FontWeight.w700 : FontWeight.w500,
                    color: isSelected ? Colors.white : (isFuture ? AppColors.outlineVariant : AppColors.onSurface),
                  ),
                ),
              ),
              ...chips,
              // 没有收支的列留一点高度，整行不至于塌成一条线
              if (chips.isEmpty) const SizedBox(height: 20),
            ]),
          ),
        ),
      ));
    }

    return SoftCard(
      padding: const EdgeInsets.fromLTRB(6, 8, 6, 8),
      child: Row(crossAxisAlignment: CrossAxisAlignment.start, children: columns),
    );
  }

  static const _kindIcon = {
    'sale': (Icons.point_of_sale_rounded, '卖货收款'),
    'receive': (Icons.account_balance_wallet_rounded, '收回欠款'),
    'purchase': (Icons.local_shipping_outlined, '进货付款'),
    'refundOut': (Icons.u_turn_left_rounded, '退款给客户'),
    'refundIn': (Icons.replay_rounded, '供应商退回'),
    'dailyIncome': (Icons.savings_outlined, '其他收入'),
    'expense': (Icons.receipt_outlined, '开销'),
    'otherIn': (Icons.south_west_rounded, '收入'),
    'otherOut': (Icons.north_east_rounded, '支出'),
  };

  /// 选中日的逐笔清单（todolist 式）：图标+标题+时间+账户，右侧红绿金额，点开单据
  List<Widget> _eventList(TextTheme t, List<Map<String, dynamic>> events) {
    if (events.isEmpty) {
      return [
        SoftCard(
          child: Column(children: [
            const SizedBox(height: 8),
            const Icon(Icons.free_breakfast_outlined, size: 36, color: AppColors.outlineVariant),
            const SizedBox(height: 8),
            Text('这天没有收支', style: t.titleMedium),
            const SizedBox(height: 4),
            Text('有进出账的日子，这里会像清单一样列出每一笔', style: t.bodyMedium?.copyWith(fontSize: 12)),
            const SizedBox(height: 8),
          ]),
        ),
      ];
    }
    final tf = DateFormat('HH:mm');
    // 几百笔一口气渲染会卡首帧：超过40笔先出前30，点一下再全量（用户主动要的卡顿才不算卡顿）
    final capped = !_showAllEvents && events.length > 40;
    final visible = capped ? events.sublist(0, 30) : events;
    return [
      SoftCard(
        padding: EdgeInsets.zero,
        child: Column(children: [
          for (var i = 0; i < visible.length; i++) ...[
            if (i > 0) const Divider(height: 1, indent: 56),
            Builder(builder: (context) {
              final e = visible[i];
              final isIn = e['direction'] == 'in';
              final (icon, fallback) = _kindIcon[e['kind']] ?? (Icons.swap_vert_rounded, '收支');
              final orderId = e['orderId'];
              return ListTile(
                dense: true,
                leading: Container(
                  width: 34,
                  height: 34,
                  decoration: BoxDecoration(
                    color: (isIn ? AppColors.success : AppColors.error).withValues(alpha: 0.10),
                    borderRadius: BorderRadius.circular(10),
                  ),
                  child: Icon(icon, size: 18, color: isIn ? AppColors.success : AppColors.error),
                ),
                title: Text(e['title'] ?? fallback, style: const TextStyle(fontSize: 14), maxLines: 1, overflow: TextOverflow.ellipsis),
                subtitle: Text(
                  tf.format(DateTime.parse(e['at']).toLocal()) + (e['account'] != null ? ' · ${e['account']}' : ''),
                  style: const TextStyle(fontSize: 11),
                ),
                trailing: Text(
                  '${isIn ? '+' : '-'}¥${_money.format(e['amount'])}',
                  style: TextStyle(fontSize: 15, fontWeight: FontWeight.w700, color: isIn ? AppColors.success : AppColors.error),
                ),
                onTap: orderId != null ? () => context.push('/orders/$orderId') : null,
              );
            }),
          ],
          if (capped) ...[
            const Divider(height: 1),
            InkWell(
              onTap: () => setState(() => _showAllEvents = true),
              child: Padding(
                padding: const EdgeInsets.symmetric(vertical: 12),
                child: Row(mainAxisAlignment: MainAxisAlignment.center, children: [
                  Text('展开剩余 ${events.length - visible.length} 笔',
                      style: const TextStyle(fontSize: 13, fontWeight: FontWeight.w600, color: AppColors.primary)),
                  const Icon(Icons.expand_more_rounded, size: 18, color: AppColors.primary),
                ]),
              ),
            ),
          ],
        ]),
      ),
    ];
  }
}
