// Encodes the frame list from timeline.mjs into an H.264 MP4 (1920 × 1080, 30 fps).
//   swift video/encode.swift video/out/sequence.txt video/out/hk-mate-intro.mp4
// Optional: width height bitrate (for a smaller file), e.g. 1280 720 1500000.
import AVFoundation
import CoreGraphics
import Foundation
import ImageIO

let arguments = CommandLine.arguments
guard arguments.count == 3 || arguments.count == 6 else {
    print("usage: encode.swift <sequence.txt> <output.mp4>")
    exit(2)
}
let paths = try String(contentsOfFile: arguments[1], encoding: .utf8)
    .split(separator: "\n").map(String.init)
let output = URL(fileURLWithPath: arguments[2])
try? FileManager.default.removeItem(at: output)

let small = arguments.count == 6
let width = small ? Int(arguments[3])! : 1920
let height = small ? Int(arguments[4])! : 1080
let bitrate = small ? Int(arguments[5])! : 10_000_000
let fps: Int32 = 30
let writer = try AVAssetWriter(outputURL: output, fileType: .mp4)
let input = AVAssetWriterInput(mediaType: .video, outputSettings: [
    AVVideoCodecKey: AVVideoCodecType.h264,
    AVVideoWidthKey: width,
    AVVideoHeightKey: height,
    AVVideoCompressionPropertiesKey: [
        AVVideoAverageBitRateKey: bitrate,
        AVVideoProfileLevelKey: AVVideoProfileLevelH264HighAutoLevel,
        AVVideoMaxKeyFrameIntervalKey: 60,
    ],
])
input.expectsMediaDataInRealTime = false
let adaptor = AVAssetWriterInputPixelBufferAdaptor(
    assetWriterInput: input,
    sourcePixelBufferAttributes: [
        kCVPixelBufferPixelFormatTypeKey as String: kCVPixelFormatType_32BGRA,
        kCVPixelBufferWidthKey as String: width,
        kCVPixelBufferHeightKey as String: height,
    ])
writer.add(input)
guard writer.startWriting() else {
    print("cannot start: \(String(describing: writer.error))")
    exit(1)
}
writer.startSession(atSourceTime: .zero)

func buffer(for path: String) -> CVPixelBuffer? {
    guard let source = CGImageSourceCreateWithURL(URL(fileURLWithPath: path) as CFURL, nil),
          let image = CGImageSourceCreateImageAtIndex(source, 0, nil),
          let pool = adaptor.pixelBufferPool else { return nil }
    var made: CVPixelBuffer?
    CVPixelBufferPoolCreatePixelBuffer(nil, pool, &made)
    guard let pixels = made else { return nil }
    CVPixelBufferLockBaseAddress(pixels, [])
    defer { CVPixelBufferUnlockBaseAddress(pixels, []) }
    guard let context = CGContext(
        data: CVPixelBufferGetBaseAddress(pixels), width: width, height: height,
        bitsPerComponent: 8, bytesPerRow: CVPixelBufferGetBytesPerRow(pixels),
        space: CGColorSpaceCreateDeviceRGB(),
        bitmapInfo: CGImageAlphaInfo.noneSkipFirst.rawValue | CGBitmapInfo.byteOrder32Little.rawValue)
    else { return nil }
    context.interpolationQuality = .high
    context.draw(image, in: CGRect(x: 0, y: 0, width: width, height: height))
    return pixels
}

var lastPath = ""
var last: CVPixelBuffer?
for (index, path) in paths.enumerated() {
    if path != lastPath {
        last = buffer(for: path) ?? last
        lastPath = path
    }
    guard let pixels = last else { continue }
    while !input.isReadyForMoreMediaData { usleep(2000) }
    if !adaptor.append(pixels, withPresentationTime: CMTime(value: CMTimeValue(index), timescale: fps)) {
        print("append failed at frame \(index): \(String(describing: writer.error))")
        exit(1)
    }
}
input.markAsFinished()
let finished = DispatchSemaphore(value: 0)
writer.finishWriting { finished.signal() }
finished.wait()
print(writer.status == .completed ? "wrote \(paths.count) frames to \(output.lastPathComponent)" : "failed: \(String(describing: writer.error))")
exit(writer.status == .completed ? 0 : 1)
