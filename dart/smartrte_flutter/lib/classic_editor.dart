import 'dart:convert';
import 'package:flutter/widgets.dart';
import 'package:webview_flutter/webview_flutter.dart';

class ClassicEditorController {
  ClassicEditorController(this._web);
  final WebViewController _web;

  Future<void> setHtml(String html) async {
    final js =
        "window.SmartBridge && window.SmartBridge.handle({type:'setHtml', html: ${jsonEncode(html)}});";
    await _web.runJavaScript(js);
  }

  Future<String> getHtml() async {
    final completerName =
        '__smart_rte_get_html_${DateTime.now().millisecondsSinceEpoch}';
    await _web.runJavaScript("""
      (function(){
        window.$completerName = '';
        if (window.SmartRTE && window.SmartRTE.__controller) {
          const html = window.SmartRTE.__controller.getHtml();
          window.$completerName = html || '';
        }
      })();
    """
        .replaceAll('\n', ' '));
    final res =
        await _web.runJavaScriptReturningResult('window.$completerName');
    if (res is String) return res;
    return (res.toString()).replaceAll('"', '');
  }

  Future<void> focus() async {
    await _web.runJavaScript(
        "window.SmartBridge && window.SmartBridge.handle({type:'focus'});");
  }

  Future<void> blur() async {
    await _web.runJavaScript(
        "window.SmartBridge && window.SmartBridge.handle({type:'blur'});");
  }
}

class ClassicEditor extends StatefulWidget {
  const ClassicEditor(
      {super.key, this.initialHtml, this.onHtmlChange, this.onReady});
  final String? initialHtml;
  final ValueChanged<String>? onHtmlChange;
  final VoidCallback? onReady;

  @override
  State<ClassicEditor> createState() => _ClassicEditorState();
}

class _ClassicEditorState extends State<ClassicEditor> {
  late final WebViewController _controller;
  ClassicEditorController? api;

  @override
  void initState() {
    super.initState();
    _controller = WebViewController()
      ..setJavaScriptMode(JavaScriptMode.unrestricted)
      ..addJavaScriptChannel('ToFlutter', onMessageReceived: (msg) {
        try {
          final data = jsonDecode(msg.message) as Map<String, dynamic>;
          final t = data['type'];
          if (t == 'ready') {
            api = ClassicEditorController(_controller);
            widget.onReady?.call();
            if (widget.initialHtml != null) {
              api!.setHtml(widget.initialHtml!);
            }
          } else if (t == 'change') {
            widget.onHtmlChange?.call((data['html'] as String?) ?? '');
          }
        } catch (_) {}
      })
      ..loadFlutterAsset('assets/editor/index.html');
  }

  @override
  Widget build(BuildContext context) {
    return WebViewWidget(controller: _controller);
  }
}
