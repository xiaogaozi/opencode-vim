export type ContextLanguage = "english" | "other"

export type ContextPatterns = {
    english: RegExp
    other: RegExp
    aggressiveLine: boolean
}

export const DEFAULT_ENGLISH_PATTERN = "[a-zA-Z]"
// CJK unified ideographs (with extension A), CJK symbols and punctuation, and
// fullwidth forms, matching emacs-smart-input-source's default "other" set.
export const DEFAULT_OTHER_PATTERN = "[\\u4E00-\\u9FFF\\u3400-\\u4DBF\\u3000-\\u303F\\uFF00-\\uFFEF]"

type CharClass = ContextLanguage | "none"

export function compilePattern(source: string, fallback: string): RegExp {
    try {
        return new RegExp(source)
    } catch {
        return new RegExp(fallback)
    }
}

/**
 * Guess the language context at `position` in `text`, following
 * emacs-smart-input-source's context detectors. Returns undefined when the
 * context is ambiguous so callers can fall back to a remembered source.
 */
export function detectContextLanguage(text: string, position: number, patterns: ContextPatterns): ContextLanguage | undefined {
    const pos = Math.max(0, Math.min(position, text.length))
    const lineStart = text.lastIndexOf("\n", Math.max(0, pos - 1)) + 1

    let backTo = pos
    while (backTo > lineStart && isBlank(text[backTo - 1])) backTo--
    const backChar = backTo > 0 ? text[backTo - 1] : undefined

    let crossBackTo = backTo
    while (crossBackTo > 0 && isBlankOrControl(text[crossBackTo - 1])) crossBackTo--
    const crossBackChar = crossBackTo > 0 ? text[crossBackTo - 1] : undefined

    const lineEnd = text.indexOf("\n", pos)
    const end = lineEnd === -1 ? text.length : lineEnd
    let foreTo = pos
    while (foreTo < end && isBlank(text[foreTo])) foreTo++
    const foreChar = foreTo < text.length ? text[foreTo] : undefined

    const back = classify(backChar, patterns)
    const fore = classify(foreChar, patterns)
    const crossBack = classify(crossBackChar, patterns)
    const crossLine = crossBackTo < lineStart && (patterns.aggressiveLine || onPreviousLine(text, lineStart, crossBackTo))

    if (englishContext(backTo === pos, back, foreTo === pos, fore) || (crossLine && crossBack === "english")) return "english"
    if (otherContext(backTo === pos, back, foreTo === pos, fore) || (crossLine && crossBack === "other")) return "other"
    return undefined
}

function englishContext(backAt: boolean, back: CharClass, foreAt: boolean, fore: CharClass) {
    if (backAt && back === "english") return true
    if (foreAt && fore === "english") return true
    if (back === "english" && fore !== "other") return true
    if (back !== "other" && fore === "english") return true
    return false
}

function otherContext(backAt: boolean, back: CharClass, foreAt: boolean, fore: CharClass) {
    if (backAt && back === "other") return true
    if (foreAt && fore === "other") return true
    if (back === "other" && fore !== "english") return true
    if (back !== "english" && fore === "other") return true
    return false
}

function classify(char: string | undefined, patterns: ContextPatterns): CharClass {
    if (char === undefined) return "none"
    if (patterns.english.test(char)) return "english"
    if (patterns.other.test(char)) return "other"
    return "none"
}

function onPreviousLine(text: string, lineStart: number, position: number) {
    if (lineStart === 0) return false
    const previousLineStart = text.lastIndexOf("\n", lineStart - 2) + 1
    return position >= previousLineStart
}

function isBlank(char: string | undefined) {
    return char === " " || char === "\t"
}

function isBlankOrControl(char: string | undefined) {
    if (char === undefined) return false
    if (char === " " || char === "\t" || char === "\n" || char === "\r" || char === "\f" || char === "\v") return true
    const code = char.codePointAt(0) ?? 0
    return code < 0x20 || code === 0x7f
}
