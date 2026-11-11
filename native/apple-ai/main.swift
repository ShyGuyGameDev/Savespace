// savespace-apple-ai: tiny bridge to Apple's ON-DEVICE foundation model (Apple Intelligence).
// Only SystemLanguageModel (runs on this Mac) is used, never PrivateCloudComputeLanguageModel.
//   savespace-apple-ai status                            -> {"available":true} | {"available":false,"reason":"..."}
//   savespace-apple-ai summarize <instructions> <prompt> -> {"text":"..."} | {"error":"..."}
import Foundation
import FoundationModels

func emit(_ obj: [String: Any]) -> Never {
  let data = (try? JSONSerialization.data(withJSONObject: obj)) ?? Data("{}".utf8)
  FileHandle.standardOutput.write(data)
  exit(0)
}

@available(macOS 26.0, *)
func reasonText(_ r: SystemLanguageModel.Availability.UnavailableReason) -> String {
  switch r {
  case .deviceNotEligible: return "deviceNotEligible"
  case .appleIntelligenceNotEnabled: return "appleIntelligenceNotEnabled"
  case .modelNotReady: return "modelNotReady"
  @unknown default: return "unavailable"
  }
}

@available(macOS 26.0, *)
func run(_ args: [String]) async -> [String: Any] {
  let model = SystemLanguageModel.default
  switch args[1] {
  case "status":
    switch model.availability {
    case .available: return ["available": true]
    case .unavailable(let r): return ["available": false, "reason": reasonText(r)]
    }
  case "summarize":
    guard args.count == 4 else { return ["error": "summarize needs <instructions> <prompt>"] }
    guard model.isAvailable else { return ["error": "model unavailable"] }
    let session = LanguageModelSession(model: model, instructions: args[2])
    do {
      let r = try await session.respond(to: args[3], options: GenerationOptions(temperature: 0.2, maximumResponseTokens: 200))
      return ["text": r.content]
    } catch {
      return ["error": String(String(describing: error).prefix(300))]
    }
  default:
    return ["error": "unknown command"]
  }
}

@main
struct SavespaceAppleAI {
  static func main() async {
    let args = CommandLine.arguments
    guard args.count >= 2 else { emit(["error": "usage: status | summarize <instructions> <prompt>"]) }
    guard #available(macOS 26.0, *) else {
      emit(args[1] == "status" ? ["available": false, "reason": "osTooOld"] : ["error": "macOS 26 or later is required"])
    }
    emit(await run(args))
  }
}
