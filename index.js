#!/usr/bin/env node
"use strict";

const { McpServer } = require("@modelcontextprotocol/sdk/server/mcp.js");
const { StdioServerTransport } = require("@modelcontextprotocol/sdk/server/stdio.js");
const { z } = require("zod");
const { x402Client, x402HTTPClient } = require("@x402/core/client");
const { ExactEvmScheme } = require("@x402/evm/exact/client");
const { toClientEvmSigner } = require("@x402/evm");
const { privateKeyToAccount } = require("viem/accounts");
const { createGuard } = require("./x402-guard");

const BASE_URL = "https://ads.forgemesh.io";
const ADS_PAY_TO = ["0x65E02cB7Fee27630bB7d1a3ADd02Ef7Aa2D21701"];
// Tool calls cap at the highest tool price ($0.05); the register CLI needs its own $0.10 cap.
const guard = createGuard({ baseUrl: BASE_URL, payTo: ADS_PAY_TO, maxPriceUsd: 0.05, sessionBudgetUsd: 10 });
const registerGuard = createGuard({ baseUrl: BASE_URL, payTo: ADS_PAY_TO, maxPriceUsd: 0.1, sessionBudgetUsd: 10 });
const WINDOWS = ["24h", "7d", "30d", "all"];
const ID_PATTERN = /^[A-Za-z0-9._:@-]+$/; // service ids and categories: no slashes, spaces or control chars

const TOOL_SCHEMAS = {
  list_tools: {},
  get_network_counters: {},
  preview_recommendations: {
    service: z.string().max(120).regex(ID_PATTERN).optional().describe("Your service identifier, used only for self-exclusion in results"),
    endpoint: z.string().max(300).regex(/^\/[A-Za-z0-9/._~%-]*$/).optional().describe("The probed endpoint path, e.g. /api/forecast"),
    category: z.string().max(60).regex(ID_PATTERN).optional().describe("Category to match recommendations against, e.g. finance, blockchain, images"),
  },
  get_network_stats: {},
  get_intent_trends: {
    window: z.enum(WINDOWS).optional().describe("Time window: 24h, 7d, 30d, or all (default 7d)"),
    limit: z.number().int().min(1).max(100).optional().describe("Max rows, 1-100 (default 20)"),
  },
  get_category_demand: {
    category: z.string().min(1).max(60).regex(ID_PATTERN).describe("Category to measure, e.g. finance, blockchain, images, tts"),
    window: z.enum(WINDOWS).optional().describe("Time window: 24h, 7d, 30d, or all (default 30d)"),
  },
  get_intent_report: {
    service: z.string().min(1).max(120).regex(ID_PATTERN).describe("Service identifier to report on"),
    window: z.enum(WINDOWS).optional().describe("Time window: 24h, 7d, 30d, or all (default 30d)"),
  },
  get_terms: {},
};

const TOOLS = [
  {
    name: "list_tools",
    title: "List Tools",
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: true,
    },
    description:
      "Free. Lists every x402 Ads tool with its live price, so an agent can pick before paying. Fetches GET /menu with no payment.",
  },
  {
    name: "get_network_counters",
    title: "Get Network Counters",
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: true,
    },
    description:
      "Free. Live totals for the ForgeMesh machine-commerce network: 402 responses observed, agent-class requests, recommendations served, services reporting, and x402 services indexed.",
  },
  {
    name: "preview_recommendations",
    title: "Preview Recommendations",
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: true,
    },
    description:
      "Free. See the exact typed recommendations block (sponsored + similar x402 services) that the @forgemeshlabs/x402-ads middleware would inject into a 402 response for a given endpoint and category.",
  },
  {
    name: "get_network_stats",
    title: "Get Network Stats",
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: true,
    },
    description:
      "Paid, $0.005 USDC on Base via x402. Network-wide intent stats: total events, services, monitor/indexer/agent traffic classification split, and ad activity. Without WALLET_PRIVATE_KEY, returns the x402 payment challenge instead of settling.",
  },
  {
    name: "get_intent_trends",
    title: "Get Intent Trends",
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: true,
    },
    description:
      "Paid, $0.01 USDC on Base via x402. Google-Trends-for-agents: top requested x402 endpoints and categories by autonomous agents, split by traffic class. Without WALLET_PRIVATE_KEY, returns the x402 payment challenge instead of settling.",
  },
  {
    name: "get_category_demand",
    title: "Get Category Demand",
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: true,
    },
    description:
      "Paid, $0.02 USDC on Base via x402. Demand depth for one category: probe volume, distinct sources, buyer-class share, price points probed, daily series. Without WALLET_PRIVATE_KEY, returns the x402 payment challenge instead of settling.",
  },
  {
    name: "get_intent_report",
    title: "Get Intent Report",
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: true,
    },
    description:
      "Why-agents-didn't-buy funnel for one service: bounce funnel, traffic classes, top abandoned endpoints, retry signals. FREE with X402_ADS_PUBLISHER_KEY for your registered services (the service id is bound to your key at registration); otherwise $0.05 USDC on Base via x402. Without a publisher key or WALLET_PRIVATE_KEY, returns the x402 payment challenge.",
  },
  {
    name: "get_terms",
    title: "Get Terms & Data Disclosure",
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: true,
    },
    description:
      "Free. The network's canonical terms of service and complete data-collection disclosure: exactly what the middleware sends and never sends.",
  },
];

function walletClient(g = guard) {
  const key = process.env.WALLET_PRIVATE_KEY;
  if (!key) return null;
  const pk = key.startsWith("0x") ? key : "0x" + key;
  const account = privateKeyToAccount(pk);
  const coreClient = new x402Client().register("eip155:*", new ExactEvmScheme(toClientEvmSigner(account)))
    .registerPolicy(g.policy);
  return new x402HTTPClient(coreClient);
}

// The full x402 challenge is base64 JSON in the payment-required header;
// the 402 body only carries a friendly summary (price, network, message).
function slimChallenge(res, body) {
  let decoded = null;
  try {
    const header = res.headers.get("payment-required");
    if (header) decoded = JSON.parse(Buffer.from(header, "base64").toString("utf8"));
  } catch (_) {}
  const accepts = Array.isArray(decoded?.accepts)
    ? decoded.accepts.map((a) => ({
        scheme: a.scheme,
        network: a.network,
        asset: a.asset,
        amount: a.amount ?? a.maxAmountRequired,
        payTo: a.payTo,
      }))
    : undefined;
  return {
    x402Version: decoded?.x402Version,
    price: body?.price,
    network: body?.network,
    accepts,
  };
}

// Challenge-first paid GET: publisher free lane → settle if wallet → structured 402 otherwise.
async function paidGet(path) {
  const headers = {};
  if (process.env.X402_ADS_PUBLISHER_KEY) headers["x-publisher-key"] = process.env.X402_ADS_PUBLISHER_KEY;

  const res = await guard.fetchBounded(path, { headers });
  if (res.ok) {
    const viaPublisherKey = !!process.env.X402_ADS_PUBLISHER_KEY;
    return { paid: false, ...(viaPublisherKey ? { free_via_publisher_key: true } : {}), data: JSON.parse(res.text) };
  }
  if (res.status !== 402) throw new Error(`GET ${path} failed: ${res.status} ${res.text.slice(0, 200)}`);

  const httpClient = walletClient();
  if (!httpClient) {
    let challengeBody;
    try {
      challengeBody = JSON.parse(res.text);
    } catch (_) {
      challengeBody = undefined; // header carries the full challenge; the body is only a summary
    }
    return {
      payment_required: true,
      challenge: slimChallenge(res, challengeBody),
      how_to_pay:
        "Set WALLET_PRIVATE_KEY (Base mainnet wallet holding USDC) to settle this x402 call automatically, or set X402_ADS_PUBLISHER_KEY to get reports on your own services free.",
    };
  }

  const { _payment, ...data } = await guard.callPaid(httpClient, path, { headers });
  return { paid: true, payment_response: _payment, data };
}

async function freeGet(path, asText = false) {
  const res = await guard.fetchBounded(path);
  if (!res.ok) throw new Error(`GET ${path} failed: ${res.status}`);
  return asText ? res.text : JSON.parse(res.text);
}

function qs(params) {
  const q = Object.entries(params)
    .filter(([, v]) => v !== undefined && v !== null && v !== "")
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
    .join("&");
  return q ? `?${q}` : "";
}

async function callTool(name, args = {}) {
  // list_tools is free: plain fetch of /menu, no wallet, never touches paidGet.
  // The server may attach a labeled `sponsored` data field; pass it through untouched.
  if (name === "list_tools") return freeGet("/menu");
  if (name === "get_network_counters") return freeGet("/v1/counters");

  if (name === "preview_recommendations") {
    const res = await guard.fetchBounded("/v1/decide", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        service: args.service || "mcp-preview",
        endpoint: args.endpoint || "/api/example",
        category: args.category,
      }),
    });
    if (!res.ok) throw new Error(`POST /v1/decide failed: ${res.status}`);
    return JSON.parse(res.text);
  }

  if (name === "get_network_stats") return paidGet("/api/network/stats");

  if (name === "get_intent_trends") return paidGet("/api/intent/trends" + qs({ window: args.window, limit: args.limit }));

  if (name === "get_category_demand")
    return paidGet("/api/intent/demand" + qs({ category: args.category, window: args.window }));

  if (name === "get_intent_report")
    return paidGet("/api/intent/report" + qs({ service: args.service, window: args.window }));

  if (name === "get_terms") return { terms: await freeGet("/terms", true) };

  throw new Error(`Unknown tool: ${name}`);
}

function textResult(value) {
  return { content: [{ type: "text", text: JSON.stringify(value, null, 2) }] };
}

const server = new McpServer({ name: "x402-ads-mcp", version: require("./package.json").version });
server.server.onerror = (error) => {
  console.error(error instanceof Error ? error.message : String(error));
};
for (const tool of TOOLS) {
  server.registerTool(
    tool.name,
    {
      title: tool.title,
      description: tool.description,
      inputSchema: TOOL_SCHEMAS[tool.name],
      annotations: tool.annotations,
    },
    async (args) => {
      try {
        return textResult(await callTool(tool.name, args || {}));
      } catch (error) {
        return {
          isError: true,
          content: [{ type: "text", text: error instanceof Error ? error.message : String(error) }],
        };
      }
    }
  );
}

async function main() {
  await server.connect(new StdioServerTransport());
  process.stdin.resume();
  const keepAlive = setInterval(() => {}, 2 ** 30);
  process.stdin.on("end", () => clearInterval(keepAlive));
}

// `npx -y @forgemeshlabs/x402-ads-mcp register` — one-command publisher signup.
async function registerCli(argv) {
  const args = { categories: [] };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--url") args.service_url = argv[++i];
    else if (argv[i] === "--name") args.name = argv[++i];
    else if (argv[i] === "--category") args.categories.push(argv[++i]);
    else if (argv[i] === "--contact") args.contact = argv[++i];
    else if (argv[i] === "--accept-terms") args.terms_accepted = true;
  }
  if (!args.service_url || !args.terms_accepted) {
    console.error("Usage: WALLET_PRIVATE_KEY=0x... x402-ads-mcp register --url https://api.your-service.com --accept-terms");
    console.error("       [--name \"My API\"] [--category weather] [--contact you@example.com]");
    console.error("");
    console.error("Registers you as a publisher for one $0.10 USDC x402 payment on Base.");
    console.error("The paying wallet becomes your identity; your key is printed once.");
    console.error("--accept-terms is required — read them first: " + BASE_URL + "/terms");
    process.exit(1);
  }
  const httpClient = walletClient(registerGuard);
  if (!httpClient) {
    console.error("WALLET_PRIVATE_KEY is required: a Base mainnet wallet holding at least $0.10 USDC.");
    process.exit(1);
  }
  if (!args.name) delete args.name;
  if (!args.contact) delete args.contact;
  if (!args.categories.length) delete args.categories;

  const path = "/v1/publishers/register";
  const body = JSON.stringify(args);
  // Pre-flight unpaid request so a rejected body is reported before any payment is attempted.
  const pre = await registerGuard.fetchBounded(path, { method: "POST", headers: { "content-type": "application/json" }, body });
  if (pre.status === 400) {
    let msg = pre.text.slice(0, 200);
    try { msg = JSON.parse(pre.text).error || msg; } catch (_) { /* keep raw text */ }
    console.error("Rejected before payment (nothing was charged): " + msg);
    process.exit(1);
  }
  if (pre.status !== 402) throw new Error(`expected x402 challenge, got ${pre.status}`);
  const { _payment, ...out } = await registerGuard.callPaid(httpClient, path, { method: "POST", body: args });
  console.log("Registered: " + out.publisher_id);
  console.log("");
  console.log("Your publisher key (shown once — store it now):");
  console.log("  " + out.publisher_key);
  console.log("");
  console.log("Next: set it as X402_ADS_PUBLISHER_KEY in your server env and mount the");
  console.log("@forgemeshlabs/x402-ads middleware. Your own traffic reports are free.");
}

if (require.main === module) {
  const run = process.argv[2] === "register" ? registerCli(process.argv.slice(3)) : main();
  run.catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}

module.exports = { TOOLS, TOOL_SCHEMAS, callTool };
