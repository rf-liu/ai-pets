import AppKit
import XCTest
@testable import GPTNiangMac

final class ClickExpressionTests: XCTestCase {
    @MainActor func testConfigurableThresholdPersistsAndChangingItResetsTheSequence() throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: root) }
        let resources = try prepareResources(root)
        for profile in CompanionProfile.allCases {
            let data = root.appendingPathComponent(profile.rawValue)
            let model = WidgetModel(dataDirectory: data, resources: resources, profile: profile)
            defer { model.stop() }
            model.soundOn = false
            XCTAssertEqual(model.randomExpressionStartTap, 3)
            for threshold in [1, 3, 5, 10] {
                model.setRandomExpressionStartTap(threshold)
                model.reloadCharacter()
                var choices = 0
                let now = ProcessInfo.processInfo.systemUptime
                for tap in 1...threshold {
                    model.characterClick(now: now + Double(tap) * 0.05,
                        choosingDSExpression: { pool in choices += 1; return pool[0] },
                        choosingExpression: { pool in choices += 1; return pool[0] })
                    XCTAssertEqual(choices, tap == threshold ? 1 : 0)
                }
                let reloaded = WidgetModel(dataDirectory: data, resources: resources, profile: profile)
                XCTAssertEqual(reloaded.randomExpressionStartTap, threshold)
                reloaded.stop()
            }
            model.setRandomExpressionStartTap(5)
            let now = ProcessInfo.processInfo.systemUptime
            model.characterClick(now: now)
            model.characterClick(now: now + 0.1)
            model.setRandomExpressionStartTap(3)
            var choices = 0
            for tap in 1...3 {
                model.characterClick(now: now + 0.2 + Double(tap) * 0.05,
                    choosingDSExpression: { pool in choices += 1; return pool[0] },
                    choosingExpression: { pool in choices += 1; return pool[0] })
                XCTAssertEqual(choices, tap == 3 ? 1 : 0)
            }
            model.setRandomExpressionStartTap(0)
            XCTAssertEqual(model.randomExpressionStartTap, 1)
            model.setRandomExpressionStartTap(20)
            XCTAssertEqual(model.randomExpressionStartTap, 10)
        }
    }

    private func writeImage(_ url: URL, color: UInt8) throws {
        try FileManager.default.createDirectory(at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
        let bitmap = NSBitmapImageRep(bitmapDataPlanes: nil, pixelsWide: 8, pixelsHigh: 8,
            bitsPerSample: 8, samplesPerPixel: 4, hasAlpha: true, isPlanar: false,
            colorSpaceName: .deviceRGB, bytesPerRow: 32, bitsPerPixel: 32)!
        let pixels = bitmap.bitmapData!
        for index in 0..<64 {
            pixels[index * 4] = color; pixels[index * 4 + 1] = 100
            pixels[index * 4 + 2] = 200; pixels[index * 4 + 3] = 255
        }
        try XCTUnwrap(bitmap.representation(using: .png, properties: [:])).write(to: url)
    }

    private func prepareResources(_ root: URL, includeExpressions: Bool = true) throws -> URL {
        let resources = root.appendingPathComponent("Resources")
        var paths = ["gpt-dragon-niang-bust.png", "gemini-original.png", "claude-bust.png", "deepseek-original.png"]
        // The fixture uses PNG data under the normal HD filename; AppKit detects its format.
        paths.append("gemini-catgirl-hd.webp")
        paths += ["gpt-smile.png", "gemini-hd-smile.png", "gemini-original-smile.png", "claude-smile.png", "deepseek-smile.png", "deepseek-smile-playful.png"].map { "completion-smiles/" + $0 }
        paths += CompanionProfile.dsExpressions.map { "ds-restored/" + $0.id + ".png" }
        if includeExpressions {
            paths += CompanionProfile.allCases.flatMap { $0.clickExpressionFiles(skin: $0.defaultSkin) }.map { "click-expressions/" + $0 }
        }
        for (index, path) in paths.enumerated() { try writeImage(resources.appendingPathComponent(path), color: UInt8(index + 1)) }
        return resources
    }

    @MainActor private func makeModel(_ profile: CompanionProfile, root: URL, resources: URL) -> WidgetModel {
        let model = WidgetModel(dataDirectory: root.appendingPathComponent("data/" + profile.rawValue), resources: resources, profile: profile)
        model.soundOn = false
        model.setRandomExpressionStartTap(4) // Explicitly exercise the legacy fourth-tap scenario.
        model.reloadCharacter()
        return model
    }

    @MainActor private func assertArtwork(_ model: WidgetModel, _ url: URL, file: StaticString = #filePath, line: UInt = #line) {
        XCTAssertNotNil(model.characterImage, file: file, line: line)
        XCTAssertEqual(model.characterImage?.tiffRepresentation, NSImage(contentsOf: url)?.tiffRepresentation, file: file, line: line)
    }

    @MainActor func testFourthTapUsesOwnNewArtworkAndAvoidsVisibleSmileAndImmediateRepeat() async throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: root) }
        let resources = try prepareResources(root)
        let now = ProcessInfo.processInfo.systemUptime
        for profile in [CompanionProfile.gpt, .gemini, .claude] {
            let model = makeModel(profile, root: root, resources: resources)
            defer { model.stop() }
            let files = profile.clickExpressionFiles(skin: model.selectedSkin)
            let expectedFiles: [String]
            switch profile {
            case .gpt: expectedFiles = ["gpt-closed-eyes.png", "gpt-pout.png", "gpt-surprised.png"]
            case .gemini: expectedFiles = ["gemini-hd-sleepy.png", "gemini-hd-wink.png", "gemini-hd-pout.png"]
            case .claude: expectedFiles = ["claude-thoughtful.png", "claude-closed-eyes.png", "claude-wink.png"]
            case .deepseek: return XCTFail("DS uses its separate expression pool")
            }
            XCTAssertEqual(files, expectedFiles, "Each character must expose exactly its own three new expressions")
            let smile = resources.appendingPathComponent("completion-smiles/" + profile.completionImageFile(skin: model.selectedSkin))
            for tap in 0..<3 {
                model.characterClick(now: now + Double(tap) * 0.1, choosingExpression: { _ in XCTFail("random before tap four"); return files[0] })
                assertArtwork(model, smile)
            }
            var choices = 0
            model.characterClick(now: now + 0.3, choosingExpression: { pool in
                choices += 1
                XCTAssertEqual(Set(pool), Set(files)) // Tap three is visibly smiling.
                return files[0]
            })
            assertArtwork(model, resources.appendingPathComponent("click-expressions/" + files[0]))
            model.characterClick(now: now + 0.4, choosingExpression: { pool in
                choices += 1; XCTAssertFalse(pool.contains(files[0])); XCTAssertTrue(pool.contains("smile"))
                return files[1]
            })
            XCTAssertEqual(choices, 2)
            assertArtwork(model, resources.appendingPathComponent("click-expressions/" + files[1]))
            model.characterClick(now: now + 0.5, choosingExpression: { pool in
                choices += 1
                XCTAssertEqual(Set(pool), Set(["smile", files[0], files[2]]))
                return files[2]
            })
            XCTAssertEqual(choices, 3)
            assertArtwork(model, resources.appendingPathComponent("click-expressions/" + files[2]))
            model.updateCharacterExpression(now: now + 1.99)
            assertArtwork(model, resources.appendingPathComponent("click-expressions/" + files[2]))
            model.updateCharacterExpression(now: now + 2.01)
            XCTAssertTrue(model.characterImage === model.artwork(for: model.selectedSkin))
        }
    }

    @MainActor func testOneSecondBoundaryAndIndependentCharacters() async throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: root) }
        let resources = try prepareResources(root)
        let gpt = makeModel(.gpt, root: root, resources: resources)
        let claude = makeModel(.claude, root: root, resources: resources)
        defer { gpt.stop(); claude.stop() }
        let now = ProcessInfo.processInfo.systemUptime
        for tap in 0..<3 { gpt.characterClick(now: now + Double(tap)) }
        var fourth = false
        gpt.characterClick(now: now + 3, choosingExpression: { pool in fourth = true; return pool[0] })
        XCTAssertTrue(fourth, "exactly one second remains in the click chain")
        claude.characterClick(now: now + 3, choosingExpression: { _ in XCTFail("another character inherited GPT clicks"); return "claude-thoughtful.png" })
        gpt.characterClick(now: now + 4.01, choosingExpression: { _ in XCTFail("gap over one second did not reset"); return "gpt-pout.png" })
        assertArtwork(gpt, resources.appendingPathComponent("completion-smiles/gpt-smile.png"))
        XCTAssertNotNil(claude.message, "Claude ordinary clicks must go directly to a quote")
        XCTAssertFalse(FileManager.default.fileExists(atPath: claude.dataDirectory.appendingPathComponent("refresh.flag").path))
    }

    @MainActor func testLegacyGeminiNeverUsesHDSpritesAndSkinSwitchClearsPendingExpression() async throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: root) }
        let resources = try prepareResources(root)
        let model = makeModel(.gemini, root: root, resources: resources)
        defer { model.stop() }
        let now = ProcessInfo.processInfo.systemUptime
        for tap in 0..<4 { model.characterClick(now: now + Double(tap) * 0.1, choosingExpression: { _ in "gemini-hd-wink.png" }) }
        assertArtwork(model, resources.appendingPathComponent("click-expressions/gemini-hd-wink.png"))
        model.selectedSkin = "default"; model.reloadCharacter()
        assertArtwork(model, resources.appendingPathComponent("gemini-original.png"))
        for tap in 0..<6 {
            model.characterClick(now: now + 0.5 + Double(tap) * 0.1, choosingExpression: { _ in XCTFail("legacy Gemini entered HD pool"); return "gemini-hd-wink.png" })
            assertArtwork(model, resources.appendingPathComponent("completion-smiles/gemini-original-smile.png"))
        }
        model.updateCharacterExpression(now: now + 3)
        assertArtwork(model, resources.appendingPathComponent("gemini-original.png"))
        model.selectedSkin = "gemini-hd"; model.reloadCharacter()
        model.characterClick(now: now + 4, choosingExpression: { _ in XCTFail("skin change retained old chain"); return "gemini-hd-wink.png" })
        assertArtwork(model, resources.appendingPathComponent("completion-smiles/gemini-hd-smile.png"))
    }

    @MainActor func testMissingOptionalAssetsAndInvalidSelectionFallBackWithoutCrossCharacterArt() async throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: root) }
        let resources = try prepareResources(root, includeExpressions: false)
        let model = makeModel(.gpt, root: root, resources: resources)
        defer { model.stop() }
        let now = ProcessInfo.processInfo.systemUptime
        for tap in 0..<5 { model.characterClick(now: now + Double(tap) * 0.1) }
        assertArtwork(model, resources.appendingPathComponent("completion-smiles/gpt-smile.png"))
        try writeImage(resources.appendingPathComponent("click-expressions/gpt-pout.png"), color: 99)
        model.characterClick(now: now + 0.5, choosingExpression: { _ in "claude-thoughtful.png" })
        assertArtwork(model, resources.appendingPathComponent("click-expressions/gpt-pout.png"))
    }

    @MainActor func testCompletionWinsAndReturnSmileSurvivesFurtherRapidTaps() async throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: root) }
        let resources = try prepareResources(root)
        let now = ProcessInfo.processInfo.systemUptime
        for profile in CompanionProfile.allCases {
            let model = makeModel(profile, root: root, resources: resources)
            defer { model.stop() }
            for tap in 0..<4 { model.characterClick(now: now + Double(tap) * 0.1) }
            model.showCompletion(title: "Bound conversation")
            let smile = resources.appendingPathComponent("completion-smiles/" + profile.completionImageFile(skin: model.selectedSkin))
            assertArtwork(model, smile)
            var navigationCount = 0
            model.onCompletionClick = { navigationCount += 1; model.hideCompletion() }
            model.characterClick(now: now + 0.4)
            XCTAssertEqual(navigationCount, 1); XCTAssertFalse(model.isCompletionMessage)
            for tap in 0..<6 {
                model.characterClick(now: now + 0.5 + Double(tap) * 0.1,
                    choosingDSExpression: { _ in XCTFail("DS replaced return smile"); return "angry" },
                    choosingExpression: { _ in XCTFail("click pool replaced return smile"); return "gpt-pout.png" })
                assertArtwork(model, smile)
            }
            model.updateCharacterExpression(now: now + 1.89); assertArtwork(model, smile)
            model.updateCharacterExpression(now: now + 1.91)
            assertArtwork(model, profile.artworkURL(skin: model.selectedSkin, resources: resources, data: model.dataDirectory))
            XCTAssertEqual(navigationCount, 1)
        }
    }

    @MainActor func testOlderExpiryCallbackDoesNotClearNewReaction() async throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: root) }
        let resources = try prepareResources(root)
        let model = makeModel(.gpt, root: root, resources: resources)
        defer { model.stop() }
        model.characterClick()
        try await Task.sleep(nanoseconds: 900_000_000)
        model.characterClick()
        try await Task.sleep(nanoseconds: 750_000_000)
        assertArtwork(model, resources.appendingPathComponent("completion-smiles/gpt-smile.png"))
        try await Task.sleep(nanoseconds: 900_000_000)
        XCTAssertTrue(model.characterImage === model.artwork(for: model.selectedSkin))
    }

    @MainActor func testDSRetainsTenChoicesAndRestoresFixedOriginalAppearance() async throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: root) }
        let resources = try prepareResources(root)
        let model = makeModel(.deepseek, root: root, resources: resources)
        defer { model.stop() }
        let original = root.appendingPathComponent("data/artwork/ds-desktop/angry.png")
        try writeImage(original, color: 120)
        model.selectedSkin = "ds-desktop-angry"; model.dsUseOriginalArtwork = true; model.reloadCharacter()
        assertArtwork(model, original)
        XCTAssertEqual(WidgetModel.dsRapidExpressions.count, 10)
        XCTAssertFalse(WidgetModel.dsRapidExpressions.contains("shy"))
        let now = ProcessInfo.processInfo.systemUptime
        for tap in 0..<3 { model.characterClick(now: now + Double(tap) * 0.1) }
        model.characterClick(now: now + 0.3, choosingDSExpression: { pool in
            XCTAssertTrue(pool.contains("smile-playful")); return "smile-playful"
        })
        assertArtwork(model, resources.appendingPathComponent("completion-smiles/deepseek-smile-playful.png"))
        model.updateCharacterExpression(now: now + 1.81)
        assertArtwork(model, original)
        model.showCompletion()
        assertArtwork(model, resources.appendingPathComponent("completion-smiles/deepseek-smile.png"))
    }
}
