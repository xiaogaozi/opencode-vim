import { describe, expect, test } from "bun:test"
import { DEFAULT_ENGLISH_PATTERN, DEFAULT_OTHER_PATTERN, detectContextLanguage } from "../../src/vim/context"

const patterns = {
    english: new RegExp(DEFAULT_ENGLISH_PATTERN),
    other: new RegExp(DEFAULT_OTHER_PATTERN),
    aggressiveLine: true,
}

describe("context detection", () => {
    test("detects the character before the cursor", () => {
        expect(detectContextLanguage("hello", 5, patterns)).toBe("english")
        expect(detectContextLanguage("中文", 2, patterns)).toBe("other")
        expect(detectContextLanguage("中文。", 3, patterns)).toBe("other")
    })

    test("skips trailing blanks on the same line", () => {
        expect(detectContextLanguage("hello ", 6, patterns)).toBe("english")
        expect(detectContextLanguage("中文  ", 4, patterns)).toBe("other")
    })

    test("detects the character after the cursor", () => {
        expect(detectContextLanguage("hello", 0, patterns)).toBe("english")
        expect(detectContextLanguage("中文", 0, patterns)).toBe("other")
        expect(detectContextLanguage("  hello", 0, patterns)).toBe("english")
    })

    test("uses the character immediately around the cursor", () => {
        expect(detectContextLanguage("a中", 1, patterns)).toBe("english")
        expect(detectContextLanguage("中a", 1, patterns)).toBe("english")
    })

    test("crosses blank lines to the previous non-blank character", () => {
        expect(detectContextLanguage("hello\n", 6, patterns)).toBe("english")
        expect(detectContextLanguage("中文\n", 3, patterns)).toBe("other")
        expect(detectContextLanguage("hello\n\n", 7, patterns)).toBe("english")
    })

    test("respects aggressiveLine=false", () => {
        expect(detectContextLanguage("hello\n\n", 7, { ...patterns, aggressiveLine: false })).toBeUndefined()
        expect(detectContextLanguage("hello\n", 6, { ...patterns, aggressiveLine: false })).toBe("english")
    })

    test("stays undecided for empty or ambiguous input", () => {
        expect(detectContextLanguage("", 0, patterns)).toBeUndefined()
        expect(detectContextLanguage("   ", 3, patterns)).toBeUndefined()
        expect(detectContextLanguage("()", 2, patterns)).toBeUndefined()
    })

    test("supports custom patterns", () => {
        const custom = { english: /[A-Za-z]/, other: /[\u0400-\u04FF]/, aggressiveLine: true }
        expect(detectContextLanguage("привет", 6, custom)).toBe("other")
        expect(detectContextLanguage("hello", 5, custom)).toBe("english")
    })
})
