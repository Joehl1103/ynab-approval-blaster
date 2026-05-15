// macOS Vision-framework OCR helper. Reads a single image path from argv[1],
// runs VNRecognizeTextRequest with accurate recognition + language correction,
// prints one recognized line per stdout line, and exits non-zero on failure.
//
// Invoked from TypeScript via `swift <repo>/src/native/ocr.swift <jpg-path>`.
// Requires macOS 12+ and Xcode Command Line Tools (`xcode-select --install`).

import Foundation
import Vision
import AppKit

func die(_ msg: String, code: Int32 = 1) -> Never {
    FileHandle.standardError.write(Data((msg + "\n").utf8))
    exit(code)
}

guard CommandLine.arguments.count >= 2 else {
    die("usage: ocr.swift <image-path>", code: 2)
}

let path = CommandLine.arguments[1]
let url = URL(fileURLWithPath: path)

guard FileManager.default.fileExists(atPath: path) else {
    die("ocr: file not found: \(path)", code: 2)
}

guard let image = NSImage(contentsOf: url),
      let tiff = image.tiffRepresentation,
      let bitmap = NSBitmapImageRep(data: tiff),
      let cgImage = bitmap.cgImage else {
    die("ocr: could not decode image: \(path)", code: 3)
}

let request = VNRecognizeTextRequest()
request.recognitionLevel = .accurate
request.usesLanguageCorrection = true
request.recognitionLanguages = ["en-US"]

let handler = VNImageRequestHandler(cgImage: cgImage, options: [:])
do {
    try handler.perform([request])
} catch {
    die("ocr: \(error.localizedDescription)", code: 4)
}

guard let observations = request.results else {
    exit(0)
}

for obs in observations {
    if let line = obs.topCandidates(1).first?.string {
        print(line)
    }
}
