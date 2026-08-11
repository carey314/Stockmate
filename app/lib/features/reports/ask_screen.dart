import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../core/api.dart';
import '../../core/theme.dart';

/// AI 问生意：自由问账本（"谁欠我钱""这个月赚了吗"）
class AskScreen extends ConsumerStatefulWidget {
  const AskScreen({super.key});

  @override
  ConsumerState<AskScreen> createState() => _AskScreenState();
}

class _Msg {
  final bool fromMe;
  final String text;
  _Msg(this.fromMe, this.text);
}

const _suggestions = ['现在谁欠我钱？', '这个月赚了多少？', '什么卖得最好？', '哪些货要补了？', '我欠供应商多少钱？'];

class _AskScreenState extends ConsumerState<AskScreen> {
  final _input = TextEditingController();
  final _scroll = ScrollController();
  final List<_Msg> _msgs = [];
  bool _asking = false;

  Future<void> _ask(String q) async {
    final question = q.trim();
    if (question.length < 2 || _asking) return;
    setState(() {
      _msgs.add(_Msg(true, question));
      _asking = true;
      _input.clear();
    });
    _scrollDown();
    try {
      // 多轮追问：带上最近 3 轮对话（后端上限 6 条），"那上个月呢？"这种省略主语的问题才答得对。
      // 只取问答成对的部分，出错消息不进上下文（免得 AI 学着道歉）
      final history = <Map<String, String>>[];
      for (final m in _msgs.where((m) => !m.text.startsWith('出错了：')).toList()) {
        if (m.text == question && m.fromMe) continue; // 当前这句由 question 字段单独传
        history.add({'role': m.fromMe ? 'user' : 'assistant', 'content': m.text});
      }
      final data = await Api.I.post('/ai/ask', data: {
        'question': question,
        if (history.isNotEmpty) 'history': history.length > 6 ? history.sublist(history.length - 6) : history,
      });
      setState(() => _msgs.add(_Msg(false, data['answer'] ?? '（没有回答）')));
    } catch (e) {
      setState(() => _msgs.add(_Msg(false, '出错了：$e')));
    } finally {
      setState(() => _asking = false);
      _scrollDown();
    }
  }

  void _scrollDown() {
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (_scroll.hasClients) _scroll.animateTo(_scroll.position.maxScrollExtent + 100, duration: const Duration(milliseconds: 250), curve: Curves.easeOut);
    });
  }

  @override
  Widget build(BuildContext context) {
    final t = Theme.of(context).textTheme;
    return Scaffold(
      appBar: AppBar(title: const Text('AI 问生意')),
      body: Column(children: [
        Expanded(
          child: _msgs.isEmpty
              ? ListView(
                  padding: const EdgeInsets.all(kPagePadding),
                  children: [
                    AiGradientCard(
                      child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                        Row(children: [
                          const Icon(Icons.auto_awesome, size: 18, color: AppColors.primary),
                          const SizedBox(width: 6),
                          Text('像问账房先生一样问你的账本', style: t.labelMedium?.copyWith(color: AppColors.primary)),
                        ]),
                        const SizedBox(height: 10),
                        Text('基于你的真实经营数据回答，只报账上有的数，不编。', style: t.bodyMedium),
                      ]),
                    ),
                    const SizedBox(height: 16),
                    Text('试试问：', style: t.titleMedium),
                    const SizedBox(height: 10),
                    Wrap(spacing: 10, runSpacing: 10, children: [
                      for (final s in _suggestions) ActionChip(label: Text(s), onPressed: () => _ask(s)),
                    ]),
                  ],
                )
              : ListView(
                  controller: _scroll,
                  padding: const EdgeInsets.all(kPagePadding),
                  children: [
                    for (final m in _msgs)
                      Align(
                        alignment: m.fromMe ? Alignment.centerRight : Alignment.centerLeft,
                        child: Container(
                          margin: const EdgeInsets.only(bottom: 10),
                          padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 10),
                          constraints: BoxConstraints(maxWidth: MediaQuery.of(context).size.width * 0.78),
                          decoration: BoxDecoration(
                            color: m.fromMe ? AppColors.primary : Colors.white,
                            borderRadius: BorderRadius.circular(18),
                            boxShadow: m.fromMe ? null : kCardShadow,
                          ),
                          child: Text(m.text, style: TextStyle(fontSize: 14, height: 1.5, color: m.fromMe ? Colors.white : AppColors.onSurface)),
                        ),
                      ),
                    if (_asking)
                      const Align(
                        alignment: Alignment.centerLeft,
                        child: Padding(
                          padding: EdgeInsets.all(10),
                          child: SizedBox(width: 18, height: 18, child: CircularProgressIndicator(strokeWidth: 2)),
                        ),
                      ),
                  ],
                ),
        ),
        SafeArea(
          child: Padding(
            padding: const EdgeInsets.fromLTRB(16, 8, 16, 12),
            child: Row(children: [
              Expanded(
                child: TextField(
                  controller: _input,
                  decoration: const InputDecoration(hintText: '问点生意上的事…'),
                  onSubmitted: _ask,
                ),
              ),
              const SizedBox(width: 10),
              GestureDetector(
                onTap: () => _ask(_input.text),
                child: Container(
                  width: 48,
                  height: 48,
                  decoration: const BoxDecoration(color: AppColors.primary, shape: BoxShape.circle),
                  child: const Icon(Icons.arrow_upward_rounded, color: Colors.white),
                ),
              ),
            ]),
          ),
        ),
      ]),
    );
  }
}
