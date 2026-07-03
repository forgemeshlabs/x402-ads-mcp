# @forgemeshlabs/x402-ads-mcp

**Machine-commerce intent analytics for your agent.** What autonomous agents probe, want, and abandon across the x402 ecosystem — as MCP tools.

Wraps the [ForgeMesh x402 Ads & Intent Network](https://ads.forgemesh.io). Paid tools settle per call in USDC on Base mainnet over the [x402 protocol](https://x402.org) — no account, no API key; your wallet is the login. Publishers get reports on their own services **free**.

## Install

```json
{
  "mcpServers": {
    "intent": {
      "command": "npx",
      "args": ["-y", "@forgemeshlabs/x402-ads-mcp"],
      "env": {
        "WALLET_PRIVATE_KEY": "0x... (optional — enables paid analytics)",
        "X402_ADS_PUBLISHER_KEY": "pub_... (optional — free reports on your own services)"
      }
    }
  }
}
```

Both env vars are optional. With neither set, free tools work fully and paid tools return the x402 payment challenge (price, network, payTo) instead of settling — useful for inspection before spending anything.

## Tools

| Tool | Price | What it returns |
|---|---|---|
| `get_network_counters` | free | Live network totals: 402s observed, agent-class requests, recommendations served |
| `preview_recommendations` | free | The exact recommendations block the middleware injects into a 402 |
| `get_terms` | free | Canonical terms + complete data-collection disclosure |
| `get_network_stats` | $0.005 | Network totals + monitor/indexer/agent classification split |
| `get_intent_trends` | $0.01 | Top endpoints & categories autonomous agents request |
| `get_category_demand` | $0.02 | Demand depth for one category: volume, buyer share, price points |
| `get_intent_report` | $0.05 / **free*** | Why-agents-didn't-buy funnel for one service |

\* `get_intent_report` is free with `X402_ADS_PUBLISHER_KEY` for services you contribute events to — the data co-op rule: your own data is free, forever.

## Environment

| Variable | Required | Purpose |
|---|---|---|
| `WALLET_PRIVATE_KEY` | no | Base mainnet wallet holding USDC; enables automatic settlement of paid tools |
| `X402_ADS_PUBLISHER_KEY` | no | Publisher key from ads.forgemesh.io; free lane for your own reports |
| `X402_ADS_BASE_URL` | no | Override the network base URL (default `https://ads.forgemesh.io`) |
| `BASE_RPC_URL` | no | Override the Base RPC (default `https://mainnet.base.org`) |

Use a dedicated hot wallet holding only small working balances. The key never leaves your machine — payments are signed locally (EIP-3009) and settle on-chain.

Ready-made configs live in [`examples/`](./examples): a Claude Desktop `mcpServers` block and a commented env-var template.

## Testing (safe by construction)

```bash
npm test                # smoke: MCP boots over stdio and lists its 7 tools
npm run test:free       # free tools against the live network
npm run test:challenge  # every paid tool returns an x402 challenge — no wallet, nothing can spend
npm run test:all        # all of the above
```

No test settles a payment. The challenge test deletes the payment env vars before loading, so it cannot move funds even if your shell has a wallet configured.

## The network in one sentence

**We measure machine commerce, not API content** — publishers running the [`@forgemeshlabs/x402-ads`](https://www.npmjs.com/package/@forgemeshlabs/x402-ads) middleware contribute anonymized 402 probe metadata; this MCP sells the aggregate demand signal back to agents and builders.

Full disclosure of what publishers send (and never send): https://ads.forgemesh.io/terms

## License

MIT © ForgeMesh
