import Flutter
import UIKit
import Vision

@main
@objc class AppDelegate: FlutterAppDelegate, FlutterImplicitEngineDelegate {
  override func application(
    _ application: UIApplication,
    didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]?
  ) -> Bool {
    return super.application(application, didFinishLaunchingWithOptions: launchOptions)
  }

  func didInitializeImplicitFlutterEngine(_ engineBridge: FlutterImplicitEngineBridge) {
    GeneratedPluginRegistrant.register(with: engineBridge.pluginRegistry)

    // stockmate/ocr：苹果原生 Vision 文字识别（离线、中文、免第三方依赖）
    if let registrar = engineBridge.pluginRegistry.registrar(forPlugin: "StockmateOcr") {
      let channel = FlutterMethodChannel(name: "stockmate/ocr", binaryMessenger: registrar.messenger())
      channel.setMethodCallHandler { call, result in
        guard call.method == "recognizeText",
              let args = call.arguments as? [String: Any],
              let path = args["path"] as? String,
              let image = UIImage(contentsOfFile: path),
              let cgImage = image.cgImage
        else {
          result(FlutterError(code: "BAD_ARGS", message: "无法读取图片", details: nil))
          return
        }

        let request = VNRecognizeTextRequest { req, err in
          if let err = err {
            DispatchQueue.main.async {
              result(FlutterError(code: "OCR_FAILED", message: err.localizedDescription, details: nil))
            }
            return
          }
          let lines = (req.results as? [VNRecognizedTextObservation])?
            .compactMap { $0.topCandidates(1).first?.string } ?? []
          DispatchQueue.main.async { result(lines.joined(separator: "\n")) }
        }
        request.recognitionLevel = .accurate
        request.recognitionLanguages = ["zh-Hans", "en-US"]
        request.usesLanguageCorrection = true

        DispatchQueue.global(qos: .userInitiated).async {
          do {
            try VNImageRequestHandler(cgImage: cgImage, options: [:]).perform([request])
          } catch {
            DispatchQueue.main.async {
              result(FlutterError(code: "OCR_FAILED", message: error.localizedDescription, details: nil))
            }
          }
        }
      }
    }
  }
}
