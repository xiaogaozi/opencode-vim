import { expect, test } from "bun:test"
import { atTranscriptBottom, finalReplyAnchor, finalReplyMessage, replyScrollTarget } from "../../src/ui/reply-anchor"

function part(id: string, top: number, type = "text", text = "answer") {
  return { id: `session-part:${id}`, top, text, source: { type } }
}

function message(type: string, text?: string) {
  return { type, content: text === undefined ? [] : [{ type: "text", text }] }
}

test("finalReplyMessage selects only an assistant message from the current turn", () => {
  expect(finalReplyMessage([message("user"), message("assistant", "answer"), message("idle")])?.type).toBe("assistant")
  expect(finalReplyMessage([message("user"), message("assistant", "older"), message("user")])).toBeUndefined()
  expect(
    finalReplyMessage([message("user"), message("assistant", "older"), message("assistant", "  ")]),
  ).toBeUndefined()
  expect(finalReplyMessage([message("assistant", "answer")])?.type).toBe("assistant")
  expect(finalReplyMessage([message("user")])).toBeUndefined()
  expect(finalReplyMessage([])).toBeUndefined()
})

test("finalReplyAnchor selects the last text part of the finished message", () => {
  const ranges = [
    part("msg_1:text:0", 4, "text", "older reply"),
    part("msg_2:reasoning:0", 10, "reasoning", "thinking"),
    part("msg_2:text:0", 14, "text", "first answer part"),
    part("msg_2:tool:0", 20, "tool", ""),
    part("msg_2:text:1", 24, "text", "final answer"),
    part("msg_3:text:0", 30, "text", "next reply"),
  ]
  expect(finalReplyAnchor(ranges, "msg_2")?.top).toBe(24)
})

test("finalReplyAnchor ignores reasoning, tools, empty text and other messages", () => {
  const ranges = [
    part("msg_1:text:0", 4, "text", ""),
    part("msg_1:reasoning:0", 8, "reasoning", "thinking"),
    part("msg_1:tool:0", 12, "tool", "output"),
    part("msg_1:text:1", 16, "text", "   "),
  ]
  expect(finalReplyAnchor(ranges, "msg_1")).toBeUndefined()
  expect(finalReplyAnchor([], "msg_1")).toBeUndefined()
})

test("replyScrollTarget only scrolls up and leaves a top inset", () => {
  expect(replyScrollTarget({ top: 0, scrollTop: 100, viewportY: 2, maximum: 500 })).toBe(97)
  expect(replyScrollTarget({ top: -20, scrollTop: 5, viewportY: 2, maximum: 500 })).toBe(0)
  expect(replyScrollTarget({ top: 5, scrollTop: 100, viewportY: 2, maximum: 500 })).toBeUndefined()
  expect(replyScrollTarget({ top: 0, scrollTop: 100, viewportY: 0, maximum: 500 })).toBeUndefined()
})

test("atTranscriptBottom allows a one-row rounding difference", () => {
  expect(atTranscriptBottom({ scrollTop: 60, scrollHeight: 100, viewportHeight: 40 })).toBe(true)
  expect(atTranscriptBottom({ scrollTop: 59, scrollHeight: 100, viewportHeight: 40 })).toBe(true)
  expect(atTranscriptBottom({ scrollTop: 58, scrollHeight: 100, viewportHeight: 40 })).toBe(false)
  expect(atTranscriptBottom({ scrollTop: 0, scrollHeight: 20, viewportHeight: 40 })).toBe(true)
})
