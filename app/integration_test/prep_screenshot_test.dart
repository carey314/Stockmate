// 截图前置：用 app 自己的偏好插件写入"已同意隐私"并清掉旧 token。
// 直接 defaults write 会被 cfprefsd 缓存覆盖，必须由 app 进程自己写。
import 'package:flutter_test/flutter_test.dart';
import 'package:integration_test/integration_test.dart';
import 'package:shared_preferences/shared_preferences.dart';

void main() {
  IntegrationTestWidgetsFlutterBinding.ensureInitialized();
  testWidgets('预置截图环境', (t) async {
    final sp = await SharedPreferences.getInstance();
    await sp.setBool('privacy_agreed_v1', true);
    await sp.remove('token');
    await sp.remove('sale_draft_v1');
    await sp.remove('po_draft_v1');
    expect(sp.getBool('privacy_agreed_v1'), true);
  });
}
