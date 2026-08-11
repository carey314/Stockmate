import 'package:dio/dio.dart';
import 'package:shared_preferences/shared_preferences.dart';

/// API 客户端：统一 baseUrl / Token 注入 / 错误信息提取
class Api {
  // iOS 模拟器直连宿主机 localhost；真机联调用 --dart-define=API_BASE=http://<Mac局域网IP>:3100/api/v1
  static const baseUrl = String.fromEnvironment('API_BASE', defaultValue: 'http://localhost:3100/api/v1');

  static final Api I = Api._();
  late final Dio dio;
  String? _token;

  Api._() {
    dio = Dio(BaseOptions(
      baseUrl: baseUrl,
      connectTimeout: const Duration(seconds: 10),
      receiveTimeout: const Duration(seconds: 90), // AI 接口较慢
    ));
    dio.interceptors.add(InterceptorsWrapper(
      onRequest: (options, handler) {
        if (_token != null) options.headers['Authorization'] = 'Bearer $_token';
        handler.next(options);
      },
    ));
  }

  Future<void> loadToken() async {
    final sp = await SharedPreferences.getInstance();
    _token = sp.getString('token');
  }

  bool get hasToken => _token != null;

  Future<void> setToken(String? token) async {
    _token = token;
    final sp = await SharedPreferences.getInstance();
    if (token == null) {
      await sp.remove('token');
    } else {
      await sp.setString('token', token);
    }
  }

  /// 请求并取出 data 字段；后端返回 { code, message, data }
  Future<dynamic> request(String method, String path, {Object? data, Map<String, dynamic>? query}) async {
    try {
      final resp = await dio.request(path, data: data, queryParameters: query, options: Options(method: method));
      return resp.data['data'];
    } on DioException catch (e) {
      final body = e.response?.data;
      final msg = body is Map
          ? [body['message'], if (body['errors'] is List) (body['errors'] as List).map((x) => x['message']).join('；')]
              .whereType<String>()
              .where((s) => s.isNotEmpty)
              .join('：')
          : (e.message ?? '网络错误');
      throw ApiError(msg, e.response?.statusCode);
    }
  }

  /// 上传图片，返回可访问 url（相对路径，拼 host 用 imageUrl()）
  Future<String> uploadImage(String filePath) async {
    final form = FormData.fromMap({'file': await MultipartFile.fromFile(filePath)});
    final resp = await dio.post('/upload', data: form);
    return resp.data['data']['url'] as String;
  }

  /// 相对图片路径 → 完整 URL
  static String imageUrl(String? path) {
    if (path == null || path.isEmpty) return '';
    if (path.startsWith('http')) return path;
    return baseUrl.replaceAll('/api/v1', '') + path;
  }

  Future<dynamic> get(String path, {Map<String, dynamic>? query}) => request('GET', path, query: query);
  Future<dynamic> post(String path, {Object? data}) => request('POST', path, data: data);
  Future<dynamic> put(String path, {Object? data}) => request('PUT', path, data: data);
  Future<dynamic> delete(String path) => request('DELETE', path);
}

class ApiError implements Exception {
  final String message;
  final int? status;
  ApiError(this.message, this.status);
  @override
  String toString() => message;
}
