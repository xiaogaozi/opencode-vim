import type { Context, Route } from "@opencode/plugin/tui/context"
import { ScrollBoxRenderable, type Renderable } from "@opentui/core"
import { createEffect, onCleanup } from "solid-js"
import { transcriptItems } from "../transcript-items"
import type { VimConfig } from "../vim/config"
import type { VimLog } from "../vim/log"
import { atTranscriptBottom, finalReplyAnchor, finalReplyMessage, replyScrollTarget } from "./reply-anchor"

const SETTLE_FRAMES = 40
const STABLE_FRAMES = 2
const RESTORE_WAIT_MS = 1500
const RESTORE_TIMEOUT_MS = 3000

type AlignMode = "completion" | "restore"

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
  const pending = new Set<string>()
  let routed = routeSession(context.ui.router.current())
  const unsubscribe = [
    context.data.on("session.execution.succeeded", (event) => schedule(event.data.sessionID)),
    context.data.on("session.execution.failed", (event) => schedule(event.data.sessionID)),
    context.data.on("session.execution.started", (event) => pending.delete(event.data.sessionID)),
    context.data.on("session.deleted", (event) => pending.delete(event.data.sessionID)),
  ]

  onCleanup(() => {
    disposed = true
    generation++
    for (const off of unsubscribe) off()
  })

  createEffect(() => {
    const sessionID = routeSession(context.ui.router.current())
    if (sessionID === routed) return
    routed = sessionID
    if (!sessionID || !pending.has(sessionID)) return
    const current = ++generation
    void align(current, sessionID, "restore")
  })

  function schedule(sessionID: string) {
    if (disposed || !config.completionScroll.enabled || !options.enabled()) return
    const route = context.ui.router.current()
    if (route.type === "session" && route.sessionID === sessionID) {
      pending.delete(sessionID)
      options.log("completion.schedule", { sessionID })
      const current = ++generation
      void align(current, sessionID, "completion")
      return
    }
    if (pending.has(sessionID)) return
    pending.add(sessionID)
    options.log("completion.pending", { sessionID })
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

  async function align(token: number, sessionID: string, mode: AlignMode) {
    let messageIDs = new Set<string>()
    let messageCount = -1
    const deadline = Date.now() + (mode === "restore" ? RESTORE_TIMEOUT_MS : 0)
    let height = -1
    let stable = 0
    let seenAt: number | undefined
    let runningLogged = false
    for (let frame = 0; frame < SETTLE_FRAMES || Date.now() < deadline; frame++) {
      await nextFrame()
      if (!active(token, sessionID) || (mode === "restore" && !pending.has(sessionID))) {
        options.log("completion.inactive", { frame, mode })
        return
      }
      const messages = context.data.session.message.list(sessionID)
      if (messages.length !== messageCount) {
        messageCount = messages.length
        messageIDs = new Set(messages.map((item) => item.id))
      }
      const scroll = findScroll(messageIDs)
      if (!scroll) {
        if (frame === 0) options.log("completion.scroll.missing", { mode })
        continue
      }
      seenAt ??= Date.now()
      if (
        !atTranscriptBottom({
          scrollTop: scroll.scrollTop,
          scrollHeight: scroll.scrollHeight,
          viewportHeight: scroll.viewport.height,
        })
      ) {
        if (mode === "completion") {
          options.log("completion.away", {
            frame,
            scrollTop: scroll.scrollTop,
            scrollHeight: scroll.scrollHeight,
            viewportHeight: scroll.viewport.height,
          })
          return
        }
        if (Date.now() - seenAt >= RESTORE_WAIT_MS) {
          options.log("completion.restore.away", {
            frame,
            scrollTop: scroll.scrollTop,
            scrollHeight: scroll.scrollHeight,
            viewportHeight: scroll.viewport.height,
          })
          pending.delete(sessionID)
          return
        }
        continue
      }
      if (scroll.scrollHeight === height) stable++
      else {
        stable = 0
        height = scroll.scrollHeight
      }
      if (stable < STABLE_FRAMES) continue
      if (context.data.session.status(sessionID) !== "idle") {
        if (!runningLogged) {
          options.log("completion.running", { frame, mode })
          runningLogged = true
        }
        if (mode === "restore") continue
        return
      }
      if (scrollToReply(scroll, sessionID)) {
        if (mode === "restore") pending.delete(sessionID)
        return
      }
    }
    options.log("completion.settle.timeout", { mode })
    if (mode === "restore") pending.delete(sessionID)
  }

  function scrollToReply(scroll: ScrollBoxRenderable, sessionID: string) {
    const messages = context.data.session.message.list(sessionID)
    const message = finalReplyMessage(messages)
    if (!message) return false
    const pendingTools = new Set<string>()
    for (const request of context.data.session.permission.list(sessionID) ?? []) {
      if (request.source?.type === "tool") pendingTools.add(request.source.id)
    }
    const { ranges } = transcriptItems(scroll.getChildren(), messages, pendingTools)
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

function routeSession(route: Route) {
  return route.type === "session" ? route.sessionID : undefined
}
