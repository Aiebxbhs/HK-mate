// Adds a soundtrack to a silent MP4 without re-encoding the picture.
//   swift video/mux.swift <video.mp4> <audio.m4a> <output.mp4> [seconds]
// With `seconds`, only the start of the film is kept (for short samples to listen to).
import AVFoundation
import Foundation

let arguments = CommandLine.arguments
guard arguments.count == 4 || arguments.count == 5 else {
    print("usage: mux.swift <video.mp4> <audio.m4a> <output.mp4>")
    exit(2)
}
let video = AVURLAsset(url: URL(fileURLWithPath: arguments[1]))
let audio = AVURLAsset(url: URL(fileURLWithPath: arguments[2]))
let output = URL(fileURLWithPath: arguments[3])
try? FileManager.default.removeItem(at: output)

let done = DispatchSemaphore(value: 0)
var failure: String?
Task {
    do {
        let composition = AVMutableComposition()
        var duration = try await video.load(.duration)
        if arguments.count == 5, let limit = Double(arguments[4]) {
            duration = CMTimeMinimum(duration, CMTime(seconds: limit, preferredTimescale: 600))
        }
        guard let picture = try await video.loadTracks(withMediaType: .video).first,
              let sound = try await audio.loadTracks(withMediaType: .audio).first,
              let pictureTrack = composition.addMutableTrack(
                withMediaType: .video, preferredTrackID: kCMPersistentTrackID_Invalid),
              let soundTrack = composition.addMutableTrack(
                withMediaType: .audio, preferredTrackID: kCMPersistentTrackID_Invalid)
        else { throw NSError(domain: "mux", code: 1) }
        let range = CMTimeRange(start: .zero, duration: duration)
        try pictureTrack.insertTimeRange(range, of: picture, at: .zero)
        let audioDuration = try await audio.load(.duration)
        try soundTrack.insertTimeRange(
            CMTimeRange(start: .zero, duration: CMTimeMinimum(duration, audioDuration)),
            of: sound, at: .zero)
        guard let export = AVAssetExportSession(
            asset: composition, presetName: AVAssetExportPresetPassthrough)
        else { throw NSError(domain: "mux", code: 2) }
        export.outputURL = output
        export.outputFileType = .mp4
        await export.export()
        if export.status != .completed { failure = String(describing: export.error) }
    } catch {
        failure = String(describing: error)
    }
    done.signal()
}
done.wait()
if let failure {
    print("failed: \(failure)")
    exit(1)
}
print("wrote \(output.lastPathComponent)")
