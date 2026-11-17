// Prints a media file's duration in seconds.
import AVFoundation
import Foundation

let asset = AVURLAsset(url: URL(fileURLWithPath: CommandLine.arguments[1]))
let done = DispatchSemaphore(value: 0)
Task {
    let duration = (try? await asset.load(.duration)) ?? .zero
    print(String(format: "%.2f", CMTimeGetSeconds(duration)))
    done.signal()
}
done.wait()
