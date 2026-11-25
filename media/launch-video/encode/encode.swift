// Writes the film: PNG frames and a WAV into an mp4 (H.264 + AAC) through AVFoundation.
//
//   encode --frames <dir> --manifest <file> --audio <wav> --out <mp4>
//          [--fps 60] [--width 1920] [--height 1080] [--bitrate 16000000]
//
// The manifest names, for every frame in order, the PNG that holds it (a frame
// identical to the one before repeats the name). Frame n is shown at n/fps
// seconds exactly; the sound starts at 0. Colours are written as sRGB with
// BT.709 primaries and matrix, so players show the values that were drawn.

import AVFoundation
import CoreGraphics
import CoreVideo
import Foundation
import ImageIO

func fail(_ message: String) -> Never {
    FileHandle.standardError.write("encode: \(message)\n".data(using: .utf8)!)
    exit(1)
}

var options: [String: String] = [:]
var arguments = Array(CommandLine.arguments.dropFirst())
while arguments.count >= 2 {
    let key = arguments.removeFirst()
    guard key.hasPrefix("--") else { fail("unexpected argument \(key)") }
    options[String(key.dropFirst(2))] = arguments.removeFirst()
}
guard let framesDir = options["frames"], let manifestPath = options["manifest"], let outPath = options["out"] else {
    fail("usage: encode --frames <dir> --manifest <file> --audio <wav> --out <mp4>")
}
let fps = Int32(options["fps"] ?? "60") ?? 60
let width = Int(options["width"] ?? "1920") ?? 1920
let height = Int(options["height"] ?? "1080") ?? 1080
let bitrate = Int(options["bitrate"] ?? "16000000") ?? 16_000_000

guard let manifestText = try? String(contentsOfFile: manifestPath, encoding: .utf8) else { fail("cannot read \(manifestPath)") }
let names = manifestText.split(separator: "\n").map(String.init).filter { !$0.isEmpty }
guard !names.isEmpty else { fail("the manifest lists no frames") }

let outURL = URL(fileURLWithPath: outPath)
try? FileManager.default.removeItem(at: outURL)
guard let writer = try? AVAssetWriter(outputURL: outURL, fileType: .mp4) else { fail("cannot create \(outPath)") }
writer.shouldOptimizeForNetworkUse = true

let videoSettings: [String: Any] = [
    AVVideoCodecKey: AVVideoCodecType.h264,
    AVVideoWidthKey: width,
    AVVideoHeightKey: height,
    AVVideoColorPropertiesKey: [
        AVVideoColorPrimariesKey: AVVideoColorPrimaries_ITU_R_709_2,
        AVVideoTransferFunctionKey: AVVideoTransferFunction_IEC_sRGB,
        AVVideoYCbCrMatrixKey: AVVideoYCbCrMatrix_ITU_R_709_2
    ],
    AVVideoCompressionPropertiesKey: [
        AVVideoAverageBitRateKey: bitrate,
        AVVideoProfileLevelKey: AVVideoProfileLevelH264HighAutoLevel,
        AVVideoH264EntropyModeKey: AVVideoH264EntropyModeCABAC,
        AVVideoMaxKeyFrameIntervalKey: Int(fps),
        AVVideoExpectedSourceFrameRateKey: Int(fps),
        AVVideoAllowFrameReorderingKey: true
    ]
]
let videoInput = AVAssetWriterInput(mediaType: .video, outputSettings: videoSettings)
videoInput.expectsMediaDataInRealTime = false
let adaptor = AVAssetWriterInputPixelBufferAdaptor(assetWriterInput: videoInput, sourcePixelBufferAttributes: [
    kCVPixelBufferPixelFormatTypeKey as String: kCVPixelFormatType_32BGRA,
    kCVPixelBufferWidthKey as String: width,
    kCVPixelBufferHeightKey as String: height
])
guard writer.canAdd(videoInput) else { fail("the writer refuses the video settings") }
writer.add(videoInput)

// Sound: decoded from the WAV as PCM, encoded as AAC.
var audioInput: AVAssetWriterInput? = nil
var audioOutput: AVAssetReaderTrackOutput? = nil
var audioReader: AVAssetReader? = nil
if let audioPath = options["audio"] {
    let asset = AVURLAsset(url: URL(fileURLWithPath: audioPath))
    let semaphore = DispatchSemaphore(value: 0)
    var tracks: [AVAssetTrack] = []
    asset.loadTracks(withMediaType: .audio) { loaded, _ in tracks = loaded ?? []; semaphore.signal() }
    semaphore.wait()
    guard let track = tracks.first, let reader = try? AVAssetReader(asset: asset) else { fail("cannot read \(audioPath)") }
    let output = AVAssetReaderTrackOutput(track: track, outputSettings: [
        AVFormatIDKey: kAudioFormatLinearPCM, AVLinearPCMBitDepthKey: 16, AVLinearPCMIsFloatKey: false,
        AVLinearPCMIsBigEndianKey: false, AVLinearPCMIsNonInterleaved: false
    ])
    reader.add(output)
    let input = AVAssetWriterInput(mediaType: .audio, outputSettings: [
        AVFormatIDKey: kAudioFormatMPEG4AAC, AVSampleRateKey: 48000, AVNumberOfChannelsKey: 2, AVEncoderBitRateKey: 192_000
    ])
    input.expectsMediaDataInRealTime = false
    guard writer.canAdd(input) else { fail("the writer refuses the audio settings") }
    writer.add(input)
    audioInput = input; audioOutput = output; audioReader = reader
}

guard writer.startWriting() else { fail("cannot start writing: \(writer.error?.localizedDescription ?? "unknown")") }
writer.startSession(atSourceTime: .zero)
audioReader?.startReading()

let colourSpace = CGColorSpace(name: CGColorSpace.sRGB)!
func pixelBuffer(for name: String) -> CVPixelBuffer {
    let url = URL(fileURLWithPath: framesDir).appendingPathComponent(name)
    guard let source = CGImageSourceCreateWithURL(url as CFURL, nil), let image = CGImageSourceCreateImageAtIndex(source, 0, nil) else { fail("cannot read frame \(url.path)") }
    guard image.width == width, image.height == height else { fail("frame \(name) is \(image.width)×\(image.height), not \(width)×\(height)") }
    var buffer: CVPixelBuffer? = nil
    guard let pool = adaptor.pixelBufferPool, CVPixelBufferPoolCreatePixelBuffer(nil, pool, &buffer) == kCVReturnSuccess, let pixels = buffer else { fail("no pixel buffer") }
    CVPixelBufferLockBaseAddress(pixels, [])
    let context = CGContext(data: CVPixelBufferGetBaseAddress(pixels), width: width, height: height, bitsPerComponent: 8,
                            bytesPerRow: CVPixelBufferGetBytesPerRow(pixels), space: colourSpace,
                            bitmapInfo: CGImageAlphaInfo.noneSkipFirst.rawValue | CGBitmapInfo.byteOrder32Little.rawValue)!
    context.interpolationQuality = .none
    // The frames are sRGB values; draw them as such whatever profile the PNG carries.
    let tagged = image.copy(colorSpace: colourSpace) ?? image
    context.draw(tagged, in: CGRect(x: 0, y: 0, width: width, height: height))
    CVPixelBufferUnlockBaseAddress(pixels, [])
    CVBufferSetAttachment(pixels, kCVImageBufferColorPrimariesKey, kCVImageBufferColorPrimaries_ITU_R_709_2, .shouldPropagate)
    CVBufferSetAttachment(pixels, kCVImageBufferTransferFunctionKey, kCVImageBufferTransferFunction_sRGB, .shouldPropagate)
    CVBufferSetAttachment(pixels, kCVImageBufferYCbCrMatrixKey, kCVImageBufferYCbCrMatrix_ITU_R_709_2, .shouldPropagate)
    return pixels
}

let group = DispatchGroup()
group.enter()
var frame = 0
var lastName = ""
var lastBuffer: CVPixelBuffer? = nil
videoInput.requestMediaDataWhenReady(on: DispatchQueue(label: "film.video")) {
    while videoInput.isReadyForMoreMediaData {
        if frame >= names.count { videoInput.markAsFinished(); group.leave(); return }
        autoreleasepool {
            let name = names[frame]
            if name != lastName || lastBuffer == nil { lastBuffer = pixelBuffer(for: name); lastName = name }
            if !adaptor.append(lastBuffer!, withPresentationTime: CMTime(value: CMTimeValue(frame), timescale: fps)) {
                fail("frame \(frame) was refused: \(writer.error?.localizedDescription ?? "unknown")")
            }
            frame += 1
        }
    }
}
if let input = audioInput, let output = audioOutput {
    group.enter()
    input.requestMediaDataWhenReady(on: DispatchQueue(label: "film.audio")) {
        while input.isReadyForMoreMediaData {
            guard let sample = output.copyNextSampleBuffer() else { input.markAsFinished(); group.leave(); return }
            if !input.append(sample) { fail("sound was refused: \(writer.error?.localizedDescription ?? "unknown")") }
        }
    }
}
group.wait()
writer.endSession(atSourceTime: CMTime(value: CMTimeValue(names.count), timescale: fps))
let done = DispatchSemaphore(value: 0)
writer.finishWriting { done.signal() }
done.wait()
guard writer.status == .completed else { fail("writing failed: \(writer.error?.localizedDescription ?? "unknown")") }
let size = (try? FileManager.default.attributesOfItem(atPath: outPath)[.size] as? Int) ?? 0
print("\(outPath): \(names.count) frames, \(String(format: "%.3f", Double(names.count) / Double(fps))) s, \(size) bytes")
