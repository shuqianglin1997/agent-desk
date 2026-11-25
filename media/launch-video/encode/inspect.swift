// Reads back a finished mp4: prints what its tracks really are, and can save
// exact frames as PNG so the encoded picture can be compared with the drawing.
//
//   inspect <mp4> [<seconds> <out.png>]…

import AVFoundation
import CoreGraphics
import Foundation
import ImageIO
import UniformTypeIdentifiers

let arguments = Array(CommandLine.arguments.dropFirst())
guard let path = arguments.first else { print("usage: inspect <mp4> [<seconds> <out.png>]…"); exit(1) }
let asset = AVURLAsset(url: URL(fileURLWithPath: path))
let semaphore = DispatchSemaphore(value: 0)

Task {
    let duration = try await asset.load(.duration)
    print(String(format: "duration %.4f s", duration.seconds))
    for track in try await asset.load(.tracks) {
        let formats = try await track.load(.formatDescriptions)
        let range = try await track.load(.timeRange)
        if track.mediaType == .video {
            let size = try await track.load(.naturalSize), rate = try await track.load(.nominalFrameRate), bits = try await track.load(.estimatedDataRate)
            var frames = 0
            let reader = try AVAssetReader(asset: asset)
            let output = AVAssetReaderTrackOutput(track: track, outputSettings: nil)
            reader.add(output); reader.startReading()
            // Count pictures only: the reader also hands back empty marker buffers.
            while let sample = output.copyNextSampleBuffer() { if CMSampleBufferGetNumSamples(sample) > 0 && CMSampleBufferGetDataBuffer(sample) != nil { frames += CMSampleBufferGetNumSamples(sample) } }
            let extensions = formats.first.flatMap { CMFormatDescriptionGetExtensions($0) as? [String: Any] } ?? [:]
            let codec = formats.first.map { CMFormatDescriptionGetMediaSubType($0) } ?? 0
            let fourcc = String(bytes: [UInt8(codec >> 24 & 255), UInt8(codec >> 16 & 255), UInt8(codec >> 8 & 255), UInt8(codec & 255)], encoding: .ascii) ?? "?"
            print(String(format: "video %@ %.0f×%.0f, %.3f fps, %d frames, %.2f Mbit/s, %.4f s", fourcc, size.width, size.height, rate, frames, bits / 1_000_000, range.duration.seconds))
            print("  primaries \(extensions["CVImageBufferColorPrimaries"] ?? "?"), transfer \(extensions["CVImageBufferTransferFunction"] ?? "?"), matrix \(extensions["CVImageBufferYCbCrMatrix"] ?? "?")")
        } else if track.mediaType == .audio {
            let bits = try await track.load(.estimatedDataRate)
            let basic = formats.first.flatMap { CMAudioFormatDescriptionGetStreamBasicDescription($0)?.pointee }
            let id = basic?.mFormatID ?? 0
            let fourcc = String(bytes: [UInt8(id >> 24 & 255), UInt8(id >> 16 & 255), UInt8(id >> 8 & 255), UInt8(id & 255)], encoding: .ascii) ?? "?"
            print(String(format: "audio %@ %.0f Hz, %d channels, %.0f kbit/s, %.4f s", fourcc, basic?.mSampleRate ?? 0, basic?.mChannelsPerFrame ?? 0, bits / 1000, range.duration.seconds))
        }
    }
    let generator = AVAssetImageGenerator(asset: asset)
    generator.requestedTimeToleranceBefore = .zero
    generator.requestedTimeToleranceAfter = .zero
    var rest = Array(arguments.dropFirst())
    while rest.count >= 2 {
        let seconds = Double(rest.removeFirst()) ?? 0, out = rest.removeFirst()
        let image = try await generator.image(at: CMTime(seconds: seconds + 0.001, preferredTimescale: 60000)).image
        let destination = CGImageDestinationCreateWithURL(URL(fileURLWithPath: out) as CFURL, UTType.png.identifier as CFString, 1, nil)!
        CGImageDestinationAddImage(destination, image, nil)
        CGImageDestinationFinalize(destination)
        print("saved \(out)")
    }
    semaphore.signal()
}
semaphore.wait()
