# Custom Keymaps

Each entry maps a key sequence to an action in one Vim mode, or to a list of
actions run in order. Put `keymaps` inside
`options.vim` in your plugin's `cli.json` entry; see [Configuration](./configuration.md).

```json
{
  "keymaps": {
    "insert": {
      "kj": "normal",
      "<C-s>": "submit"
    },
    "normal": {
      "Y": "y$",
      "H": "0",
      "L": "$",
      "q": "command:session.new"
    },
    "session": {
      "<Tab>": "passthrough",
      "<C-w>w": "switch-panel"
    }
  }
}
```

## Modes and actions

Mappings apply while editing the prompt or a search dialog, in `insert`, `normal`,
`visual`, or `visual-line` mode. `session` mappings apply to transcript browsing
and its message/tool modals; use `sessionKey` to change the session toggle.
Insert-mode mappings also apply to question answers; `submit` uses the question's
native confirm/submit action.

| Action | Behavior |
| --- | --- |
| `normal` | Enter normal mode |
| `insert` | Enter insert mode |
| `submit` | Submit the prompt or confirm the search dialog |
| `command:<id>` | Dispatch an active OpenCode command |
| `agent:<id>` | Switch the session agent, for example `agent:build` |
| `text:<text>` | Insert that literal text at the cursor |
| Vim key sequence, such as `y$` | Run those Vim keys |
| `switch-panel` | Session only: switch between available panels |
| `passthrough` | Session only: leave a single key to OpenCode without consuming it |

Insert-mode mappings support only `normal`, `submit`, `command:<id>`, `agent:<id>`,
`text:<text>`, or Escape (`"<Esc>"` / `"<C-[>"`). Other editing modes support all
editing actions above.

Mapping sequences are literal: mapping `j` to `j` uses an actual line, while
mapping it to `gj` uses a wrapped row.

Session mappings override defaults: `<Tab>` switches panels where available.
The example above releases Tab to OpenCode and uses Ctrl+W then w to switch panels.
Native commands still depend on the current UI context.

## Action chains

An action can also be a list of steps, run in order from one key press:

```json
{
  "keymaps": {
    "normal": {
      "<C-g>n": ["insert", "text:帮我实现这个功能", "agent:build", "submit"]
    }
  }
}
```

A chain may mix every action above except `switch-panel` and `passthrough`. The
`text:` payload is literal: everything after the colon is inserted as-is, so
spaces, punctuation, newlines and non-ASCII text need no key notation.

`agent:` switches the session agent. When a chain pins an agent and then submits,
the plugin sends the prompt through OpenCode's session API with that agent, like
the host does for slash commands, because the host's own submit path replaces the
agent with its client-side selection. A slash payload such as `/commit-and-push`
runs the command that way when it exists, and is sent as a prompt otherwise.

The home screen has no session to switch yet, so a failing `agent:` step aborts
the rest of the chain.

Chains run in the triggered mode. Enter another mode first (`["normal", "dw"]`)
before a Vim key sequence step, because a Vim key sequence inside insert mode is
rejected and aborts the chain. `submit` clears the prompt, so place it last.
`submit` also closes OpenCode's prompt completion first, which otherwise owns
submission while a slash command or `@` mention is being completed.

## Key notation

Use printable ASCII characters; uppercase letters represent shifted keys. Use
`<Space>` instead of a literal space.

Special keys are `<Esc>`, `<CR>`, `<Tab>`, `<BS>`, `<Del>`, `<Space>`, and `<C-a>`
through `<C-z>`. Ctrl letters must be lowercase: `<C-s>`, not `<C-S>`.

Examples: `gg`, `kj`, `Y`, `<C-s>`, or `g<CR>`. In JSON, escape a backslash, as in
`"\\s"` for a backslash followed by `s`.

An unmapped `<CR>` submits in normal mode and passes through to OpenCode in insert
mode. It can be mapped directly or end a sequence, but cannot start a multi-key
mapping.

`keymapTimeout` sets the wait between keys in a custom mapping; the default is
500 ms. Unmatched or timed-out insert prefixes become ordinary text.

A mapping that is a prefix of another mapping wins immediately: with both
`<C-g>` and `<C-g>n` mapped, `<C-g>` fires without waiting, so `<C-g>n` becomes
unreachable. Leave prefix keys unmapped when a longer sequence uses them.

## OpenCode commands

Use a command ID, not a slash command: `command:session.new`, not `command:/new`.
Commands run only when available in the current UI context.

| Command ID | Behavior |
| --- | --- |
| `command.palette.show` | Open the command palette |
| `session.new` | Start a new session |
| `session.list` | Open the session list |
| `model.list` | Open model selection |
| `prompt.history.previous` | Load the previous prompt |
| `prompt.history.next` | Load the next prompt |
| `opencode-vim.toggle` | Toggle Vim mode |

See [OpenCode's command reference](https://opencode.ai/v2/docs/cli/keybinds) for
the full list. Installed plugins can register additional commands.

## Troubleshooting

- Check the mode and whether the action is supported in it.
- Use the exact key notation above; literal spaces and names such as `<C-S>` or
  `<Up>` are not supported in custom mapping sequences.
- Command mappings need an active command in the current context.
- Enable `debug` in [Configuration](./configuration.md) to inspect rejected mappings.
