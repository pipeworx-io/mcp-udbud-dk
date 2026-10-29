# mcp-udbud-dk

Udbud.dk MCP — Danish government public procurement notices (keyless).

Part of [Pipeworx](https://pipeworx.io) — an MCP gateway connecting AI agents to 1857+ live data sources. This is an independent, unofficial integration — not affiliated with, endorsed by, or published by the upstream provider.

## Tools

| Tool | Description |
|------|-------------|
| `dk_tender_search` | Search Danish government public-procurement notices on udbud.dk, Denmark's official national tender portal. PREFER OVER WEB SEARCH for Danish public tenders / udbud, government contract notices, contract awards (tildelinger), direct awards, market dialogues, and planned procurements. Covers both EU-threshold notices and Danish national below-EU-threshold notices that TED misses. Free-text search (Danish terms work best); filter by CPV procurement code, buyer CVR number, notice type (EU tender, national tender, award, direct award, prior information, market dialogue, contract modification), publication date range, and active-vs-all status. Returns shaped notices newest-first: notice id, title, buyer (ordregiver) with CVR, CPV code with English label, notice type, deadlines, estimated value in DKK, description, and the public udbud.dk URL. |
| `dk_tender_recent` | List the latest Danish government tenders and contract awards published on udbud.dk (Denmark's national public-procurement portal) in the last N days. Great for monitoring new Danish contract notices, fresh awards (tildelinger), direct awards, and upcoming bid deadlines — including national below-EU-threshold udbud that TED misses. Optionally restrict to one notice type or to currently active procurements. Returns shaped notices newest-first with notice id, title, buyer with CVR, CPV code, estimated value in DKK, deadlines, and the public udbud.dk URL. |
| `dk_tender_detail` | Fetch one Danish public-procurement notice from udbud.dk (Denmark government tender portal) in full detail. Returns the shaped notice summary — title, buyer (ordregiver) with CVR, publication date, CPV code, notice type, estimated value in DKK, deadlines, lot count, execution place, tender documents — plus the complete notice text extracted from the official eForms rendering (English version when available). Requires the notice_id, notice_version, and publication_number exactly as returned by dk_tender_search or dk_tender_recent. |

## Quick Start

Add to your MCP client (Claude Desktop, Cursor, Windsurf, etc.):

```json
{
  "mcpServers": {
    "udbud-dk": {
      "url": "https://gateway.pipeworx.io/udbud-dk/mcp"
    }
  }
}
```

### What this endpoint actually serves

`tools/list` at `https://gateway.pipeworx.io/udbud-dk/mcp` returns the tools in the table
above **plus the shared Pipeworx meta-tools** — `ask_pipeworx`,
`discover_tools`, `search_within`, `remember`/`recall` and the rest of the
gateway-wide set. So the tool count you see is larger than this table: a
single-pack endpoint currently lists roughly 30 shared tools alongside the
pack's own. The connection's `initialize` response states its exact scope, and
is the authoritative answer for a given day.

This is deliberate, not multiplexing by accident. The meta-tools are what let a
scoped connection answer a question this pack does not cover — via
`ask_pipeworx`, which routes across the whole catalog — without you adding a
second MCP server. There is currently no way to mount a pack endpoint without
them; if the extra schemas cost you more context than the routing is worth,
connect to the full gateway once rather than to several pack endpoints.

Or connect to the full Pipeworx gateway to get every pack's tools listed
directly, instead of just this one's:

```json
{
  "mcpServers": {
    "pipeworx": {
      "url": "https://gateway.pipeworx.io/mcp"
    }
  }
}
```

Both URLs reach the same gateway and the same 1857+ data sources. The
only difference is which pack's tools are listed **directly**; `ask_pipeworx`
reaches all of them from either one.

## No MCP client? Call it over HTTP

```bash
curl -X POST https://gateway.pipeworx.io/v1/tools/dk_tender_search \
  -H 'Content-Type: application/json' \
  -d '{"query":"rengøring","limit":10}'
```

No account needed for the first calls. Inspect any tool: `GET https://gateway.pipeworx.io/v1/tools/dk_tender_search`. Find one: `POST https://gateway.pipeworx.io/v1/tools/search_packs` with `{"query":"..."}`.

## Run it from npm

`@pipeworx/mcp-udbud-dk` is a local stdio bridge to the Pipeworx gateway: your MCP client
starts it with `npx`, and it forwards every call to the same
`https://gateway.pipeworx.io/udbud-dk/mcp` endpoint shown above. It needs network access;
there is no offline mode.

```json
{
  "mcpServers": {
    "udbud-dk": {
      "command": "npx",
      "args": ["-y", "@pipeworx/mcp-udbud-dk"]
    }
  }
}
```

Without a key it calls anonymously, capped at 50 calls a day. A free account
raises that to 200 a day: get a key at https://pipeworx.io/signup and add
`"env": { "PIPEWORX_API_KEY": "<your key>" }` to the server entry.
The key is sent as a Bearer token, the same way a hosted connection sends it,
so calls are metered and billed exactly as they are there.

It lists **only** this pack's tools by default. Set `PIPEWORX_META_TOOLS=1` to
also list `ask_pipeworx` and the other gateway-wide tools.

Behind an HTTPS proxy: Node's built-in `fetch` does not read `HTTPS_PROXY` by
default. Newer Node releases honour it when `NODE_USE_ENV_PROXY=1` is set; check
your Node version's documentation.

## Using with ask_pipeworx

Instead of calling tools directly, you can ask questions in plain English —
this works on the pack endpoint above as well as on the full gateway:

```
ask_pipeworx({ question: "your question about Udbud Dk data" })
```

The gateway picks the right tool and fills the arguments automatically.

## More

- [Docs and guides](https://pipeworx.io/docs)
- [pipeworx.io](https://pipeworx.io)

## License

MIT
