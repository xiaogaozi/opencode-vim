import type { Message } from "../support/fixture"

export const searchMessages: Message[] = [
  {
    id: "msg_search_1",
    type: "user",
    text: "Before 中文 搜索 session after",
    time: { created: 1 },
  },
  {
    id: "msg_search_2",
    type: "user",
    text: "Second line\nMore 中文 text session tail",
    time: { created: 2 },
  },
  {
    id: "msg_search_3",
    type: "user",
    text: "Tab\tbefore 👩‍💻 session end",
    time: { created: 3 },
  },
]

export const markdownSearchMessages: Message[] = [
  {
    id: "msg_markdown_search",
    type: "assistant",
    agent: "build",
    model: { providerID: "test", id: "fixture" },
    time: { created: 1, completed: 2 },
    content: [{ type: "text", text: "See **session** and _session_ plus `session`." }],
  },
]
