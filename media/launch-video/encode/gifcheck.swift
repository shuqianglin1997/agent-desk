// Reads a GIF back through macOS's own ImageIO — the decoder Safari and Preview use — and says what it finds:
// the size, the number of frames, how long each is held, whether it loops for ever. Given the frames it was made
// from, it also compares every pixel of every frame with its source.
//
//   gifcheck <file.gif> [<frames dir>]
//
// (The GIF is written by encode/gif.js; this is the independent check on it.)

import Foundation
import ImageIO
import CoreGraphics

func fail(_ message: String) -> Never { FileHandle.standardError.write((message + "\n").data(using: .utf8)!); exit(1) }
let arguments = Array(CommandLine.arguments.dropFirst())
guard let file = arguments.first else { fail("usage: gifcheck <file.gif> [<frames dir>]") }
guard let source = CGImageSourceCreateWithURL(URL(fileURLWithPath: file) as CFURL, nil) else { fail("cannot read \(file)") }
let count = CGImageSourceGetCount(source)
let whole = CGImageSourceCopyProperties(source, nil) as? [CFString: Any]
let loop = (whole?[kCGImagePropertyGIFDictionary] as? [CFString: Any])?[kCGImagePropertyGIFLoopCount] as? Int

func bitmap(_ image: CGImage) -> [UInt8] {
  var bytes = [UInt8](repeating: 0, count: image.width * image.height * 4)
  let space = CGColorSpace(name: CGColorSpace.sRGB)!
  bytes.withUnsafeMutableBytes { raw in
    let context = CGContext(data: raw.baseAddress, width: image.width, height: image.height, bitsPerComponent: 8, bytesPerRow: image.width * 4, space: space, bitmapInfo: CGImageAlphaInfo.noneSkipLast.rawValue)!
    context.interpolationQuality = .none
    context.draw(image, in: CGRect(x: 0, y: 0, width: image.width, height: image.height))
  }
  return bytes
}

var names: [String] = []
if arguments.count > 1 {
  guard let listing = try? String(contentsOfFile: arguments[1] + "/manifest.txt", encoding: .utf8) else { fail("no manifest in \(arguments[1])") }
  for name in listing.split(separator: "\n").map(String.init) where names.last != name { names.append(name) }
  if names.count > 1, names.last == names.first { names.removeLast() }
}

var total = 0.0, shortest = Double.infinity, width = 0, height = 0, wrongFrames = 0, wrongPixels = 0, worst = 0
for index in 0..<count {
  let properties = CGImageSourceCopyPropertiesAtIndex(source, index, nil) as? [CFString: Any]
  let gif = properties?[kCGImagePropertyGIFDictionary] as? [CFString: Any]
  let delay = (gif?[kCGImagePropertyGIFUnclampedDelayTime] as? Double) ?? (gif?[kCGImagePropertyGIFDelayTime] as? Double) ?? 0
  total += delay; shortest = min(shortest, delay)
  guard let image = CGImageSourceCreateImageAtIndex(source, index, nil) else { fail("ImageIO cannot decode frame \(index)") }
  width = image.width; height = image.height
  if index < names.count {
    guard let reference = CGImageSourceCreateWithURL(URL(fileURLWithPath: arguments[1]).appendingPathComponent(names[index]) as CFURL, nil), let expected = CGImageSourceCreateImageAtIndex(reference, 0, nil) else { fail("cannot read \(names[index])") }
    let a = bitmap(image), b = bitmap(expected)
    if a.count != b.count { fail("frame \(index) is not the size of its source") }
    var differing = 0
    var i = 0
    while i < a.count {
      let d = max(abs(Int(a[i]) - Int(b[i])), abs(Int(a[i + 1]) - Int(b[i + 1])), abs(Int(a[i + 2]) - Int(b[i + 2])))
      if d > 0 { differing += 1; worst = max(worst, d) }
      i += 4
    }
    if differing > 0 { wrongFrames += 1; wrongPixels += differing }
  }
}
let looping = loop == nil ? "no loop block (plays once)" : loop == 0 ? "loops for ever" : "loops \(loop!) times"
print("ImageIO reads \(file): \(width)×\(height), \(count) frames, \(String(format: "%.2f", total)) s, shortest hold \(String(format: "%.2f", shortest)) s, \(looping)")
if !names.isEmpty {
  if names.count != count { print("  ✗ \(count) frames but \(names.count) source pictures") }
  print(wrongFrames == 0 ? "  every pixel of every frame is the same as its source" : "  ✗ \(wrongFrames) frames differ from their source: \(wrongPixels) pixels, by at most \(worst) of 255 in a channel")
}
if wrongFrames > 0 || (!names.isEmpty && names.count != count) { exit(1) }
