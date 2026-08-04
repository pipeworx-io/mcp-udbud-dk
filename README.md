# mcp-udbud-dk

Udbud.dk MCP — Danish government public procurement notices (keyless).

Part of [Pipeworx](https://pipeworx.io) — an MCP gateway connecting AI agents to 1394+ live data sources.

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

Or connect to the full Pipeworx gateway for access to all 1394+ data sources:

```json
{
  "mcpServers": {
    "pipeworx": {
      "url": "https://gateway.pipeworx.io/mcp"
    }
  }
}
```

## Using with ask_pipeworx

Instead of calling tools directly, you can ask questions in plain English:

```
ask_pipeworx({ question: "your question about Udbud Dk data" })
```

The gateway picks the right tool and fills the arguments automatically.

## More

- [Docs and guides](https://pipeworx.io/docs)
- [pipeworx.io](https://pipeworx.io)

## License

MIT
