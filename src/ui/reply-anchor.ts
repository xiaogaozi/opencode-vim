export type ReplyRange = {
  id: string
  text: string
  top: number
  source?: { type: string }
}

export type ReplyMessage = {
  type: string
  content?: ReadonlyArray<{ type: string; text?: string }>
}

/** The assistant message of the turn that just ended, if it produced text. */
export function finalReplyMessage<Message extends ReplyMessage>(messages: readonly Message[]): Message | undefined {
  const assistantIndex = messages.findLastIndex((message) => message.type === "assistant")
  const userIndex = messages.findLastIndex((message) => message.type === "user")
  if (assistantIndex === -1 || assistantIndex < userIndex) return
  const message = messages[assistantIndex]
  if (!message?.content?.some((part) => part.type === "text" && part.text?.trim())) return
  return message
}

/** The last non-empty text part of a message, in transcript order. */
export function finalReplyAnchor<Range extends ReplyRange>(
  ranges: readonly Range[],
  messageID: string,
): Range | undefined {
  const prefix = `session-part:${messageID}:`
  let anchor: Range | undefined
  for (const range of ranges) {
    if (!range.id.startsWith(prefix)) continue
    if (range.source?.type !== "text") continue
    if (!range.text.trim()) continue
    anchor = range
  }
  return anchor
}

/** Content offset that puts a reply above the viewport at its top, or undefined when it is already visible. */
export function replyScrollTarget(input: {
  top: number
  scrollTop: number
  viewportY: number
  maximum: number
}): number | undefined {
  const top = input.scrollTop + input.top - input.viewportY
  if (top >= input.scrollTop) return undefined
  return Math.max(0, Math.min(input.maximum, Math.floor(top) - 1))
}

export function atTranscriptBottom(input: {
  scrollTop: number
  scrollHeight: number
  viewportHeight: number
}): boolean {
  return input.scrollTop >= Math.max(0, input.scrollHeight - input.viewportHeight) - 1
}
