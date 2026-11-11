import Foundation

struct BubbleTheme {
    let ink: String
    let muted: String
    let surface: String
    let track: String
    let accents: [String]
    let flowingInk: [String]
}

extension CompanionProfile {
    var bubbleTheme: BubbleTheme {
        switch self {
        case .gpt:
            BubbleTheme(ink: "745A98", muted: "7D6B91", surface: "FFFFFF", track: "EAE4F3",
                        accents: ["745A98"], flowingInk: ["745A98", "9A79B7", "745A98"])
        case .gemini:
            BubbleTheme(ink: "5369A4", muted: "7281A2", surface: "F8FAFF", track: "E5ECF8",
                        accents: ["4C88DF", "8568CF", "BE79B4"], flowingInk: ["4466A4", "6D579E", "985D8F", "4466A4"])
        case .claude:
            BubbleTheme(ink: "98552F", muted: "9B735F", surface: "FFFAF4", track: "F1E3D7",
                        accents: ["CA7A4E"], flowingInk: ["98552F", "BF8053", "98552F"])
        case .deepseek:
            BubbleTheme(ink: "294A8D", muted: "6B7FA3", surface: "F8FAFF", track: "E4EBFA",
                        accents: ["4D6BDF"], flowingInk: ["294A8D", "5376BD", "294A8D"])
        }
    }
}
