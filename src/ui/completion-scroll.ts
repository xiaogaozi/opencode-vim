import type { Context } from "@opencode/plugin/tui/context"
import { ScrollBoxRenderable, type Renderable } from "@opentui/core"
import { onCleanup } from "solid-js"
import { transcriptItems } from "../transcript-items"
import type { VimConfig } from "../vim/config"
import type { VimLog } from "../vim/log"
import { atTranscriptBottom, finalReplyAnchor, finalReplyMessage, replyScrollTarget } from "./reply-anchor"

const SETTLE_FRAMES = 40
const STABLE_FRAMES = 2

type CompletionScrollOptions = {
  enabled: () => boolean
  blocked: () => boolean
  log: VimLog
}

/**
 * Aligns the start of a finished reply with the top of the transcript when the
 * reader was following the bottom. Session mode, dialogs and host prompts own
 * the viewport and keep it where they put it.
 */
export function createCompletionScroll(context: Context, config: VimConfig, options: CompletionScrollOptions) {
  let generation = 0
  let disposed = false
  const unsubscribe = [
    context.data.on("session.execution.succeeded", (event) => schedule(event.data.sessionID)),
    context.data.on("session.execution.failed", (event) => schedule(event.data.sessionID)),
  ]

  onCleanup(() => {
    disposed = true
    generation++
    for (const off of unsubscribe) off()
  })

  function schedule(sessionID: string) {
    if (disposed || !config.completionScroll.enabled) return
    options.log("completion.schedule", { sessionID })
    const current = ++generation
    void align(current, sessionID)
  }

  function active(token: number, sessionID: string) {
    if (disposed || token !== generation) return false
    if (!options.enabled() || options.blocked()) return false
    const route = context.ui.router.current()
    if (route.type !== "session" || route.sessionID !== sessionID) return false
    if ((context.data.session.permission.list(sessionID)?.length ?? 0) > 0) return false
    if ((context.data.session.form.list(sessionID)?.length ?? 0) > 0) return false
    return true
  }

  async function align(token: number, sessionID: string) {
    const messageIDs = new Set(context.data.session.message.list(sessionID).map((item) => item.id))
    let height = -1
    let stable = 0
    for (let frame = 0; frame < SETTLE_FRAMES; frame++) {
      await nextFrame()
      if (!active(token, sessionID)) {
        options.log("completion.inactive", { frame })
        return
      }
      const scroll = findScroll(messageIDs)
      if (!scroll) {
        if (frame === 0) options.log("completion.scroll.missing")
        continue
      }
      if (
        !atTranscriptBottom({
          scrollTop: scroll.scrollTop,
          scrollHeight: scroll.scrollHeight,
          viewportHeight: scroll.viewport.height,
        })
      ) {
        options.log("completion.away", {
          frame,
          scrollTop: scroll.scrollTop,
          scrollHeight: scroll.scrollHeight,
          viewportHeight: scroll.viewport.height,
        })
        return
      }
      if (scroll.scrollHeight === height) stable++
      else {
        stable = 0
        height = scroll.scrollHeight
      }
      if (stable < STABLE_FRAMES) continue
      if (context.data.session.status(sessionID) !== "idle") {
        options.log("completion.running", { frame })
        return
      }
      if (scrollToReply(scroll, sessionID)) return
    }
    options.log("completion.settle.timeout")
  }

  function scrollToReply(scroll: ScrollBoxRenderable, sessionID: string) {
    const messages = context.data.session.message.list(sessionID)
    const message = finalReplyMessage(messages)
    if (!message) return false
    const pending = new Set<string>()
    for (const request of context.data.session.permission.list(sessionID) ?? []) {
      if (request.source?.type === "tool") pending.add(request.source.id)
    }
    const { ranges } = transcriptItems(scroll.getChildren(), messages, pending)
    const anchor = finalReplyAnchor(ranges, message.id)
    if (!anchor) return false
    const slack = scroll.getRenderable("session-navigation-slack")?.height ?? 0
    const target = replyScrollTarget({
      top: anchor.top,
      scrollTop: scroll.scrollTop,
      viewportY: scroll.viewport.y,
      maximum: Math.max(0, scroll.scrollHeight - slack - scroll.viewport.height),
    })
    options.log("completion.target", {
      messageID: message.id,
      anchorTop: anchor.top,
      scrollTop: scroll.scrollTop,
      viewportY: scroll.viewport.y,
      scrollHeight: scroll.scrollHeight,
      target,
    })
    if (target === undefined) return true
    scroll.stickyScroll = false
    scroll.scrollTo(target)
    context.renderer.requestRender()
    return true
  }

  function findScroll(messageIDs: ReadonlySet<string>) {
    function visit(node: Renderable): ScrollBoxRenderable | undefined {
      if (!node.visible) return
      if (
        node instanceof ScrollBoxRenderable &&
        node.getChildren().some((row) => row.id?.startsWith("session-part:") || messageIDs.has(row.id))
      )
        return node
      for (const child of node.getChildren()) {
        const found = visit(child)
        if (found) return found
      }
    }
    return visit(context.renderer.root)
  }

  async function nextFrame() {
    await new Promise<void>((resolve) => {
      const start = context.renderer.frameId
      const deadline = Date.now() + 500
      const tick = () => {
        if (context.renderer.frameId > start || context.renderer.isDestroyed || Date.now() >= deadline) resolve()
        else setTimeout(tick, 8)
      }
      context.renderer.requestRender()
      setTimeout(tick, 8)
    })
  }
}
