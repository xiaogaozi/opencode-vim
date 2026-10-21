/** @jsxImportSource @opentui/solid */
import { onCleanup } from "solid-js"
import { createReaderSyntax, highlightCode } from "./syntax"
import { TextReader } from "./text"
import type { ReaderProps } from "./types"

export function DefaultReader(props: ReaderProps) {
  const syntax = createReaderSyntax(props.context)
  const controller = new AbortController()
  onCleanup(() => controller.abort())
  return (
    <TextReader
      {...props}
      title={props.message.author}
      text={props.message.text}
      highlight={(input) => {
        void highlightCode(input, syntax, "markdown", controller.signal, props.context.renderer.widthMethod)
      }}
    />
  )
}
