#!/usr/bin/env node
"use strict";

const { McpServer } = require("@modelcontextprotocol/sdk/server/mcp.js");
const { StdioServerTransport } = require("@modelcontextprotocol/sdk/server/stdio.js");
const { z } = require("zod");
const { x402Client, x402HTTPClient } = require("@x402/core/client");
const { ExactEvmScheme } = require("@x402/evm/exact/client");
const { toClientEvmSigner } = require("@x402/evm");
const { privateKeyToAccount } = require("viem/accounts");
const { createPublicClient, http } = require("viem");
const { base } = require("viem/chains");

const BASE_URL = (process.env.X402_ADS_BASE_URL || "https://ads.forgemesh.io").replace(/\/+$/, "");
const BASE_RPC_URL = process.env.BASE_RPC_URL || "https://mainnet.base.org";
const WINDOWS = ["24h", "7d", "30d", "all"];

const TOOL_SCHEMAS = {
  get_network_counters: {},
  preview_recommendations: {
    service: z.string().max(120).optional().describe("Your service identifier, used only for self-exclusion in results"),
    endpoint: z.string().max(300).optional().describe("The probed endpoint path, e.g. /api/forecast"),
    category: z.string().max(60).optional().describe("Category to match recommendations against, e.g. finance, blockchain, images"),
  },
  get_network_stats: {},
  get_intent_trends: {
    window: z.enum(WINDOWS).optional().describe("Time window: 24h, 7d, 30d, or all (default 7d)"),
    limit: z.number().int().min(1).max(100).optional().describe("Max rows, 1-100 (default 20)"),
  },
  get_category_demand: {
    category: z.string().min(1).max(60).describe("Category to measure, e.g. finance, blockchain, images, tts"),
    window: z.enum(WINDOWS).optional().describe("Time window: 24h, 7d, 30d, or all (default 30d)"),
  },
  get_intent_report: {
    service: z.string().min(1).max(120).describe("Service identifier to report on"),
    window: z.enum(WINDOWS).optional().describe("Time window: 24h, 7d, 30d, or all (default 30d)"),
  },
  get_terms: {},
};

const TOOLS = [
  {
    name: "get_network_counters",
    title: "Get Network Counters",
    description:
      "Free. Live totals for the ForgeMesh machine-commerce network: 402 responses observed, agent-class requests, recommendations served, services reporting, and x402 services indexed.",
  },
  {
    name: "preview_recommendations",
    title: "Preview Recommendations",
    description:
      "Free. See the exact typed recommendations block (sponsored + similar x402 services) that the @forgemeshlabs/x402-ads middleware would inject into a 402 response for a given endpoint and category.",
  },
  {
    name: "get_network_stats",
    title: "Get Network Stats",
    description:
      "Paid, $0.005 USDC on Base via x402. Network-wide intent stats: total events, services, monitor/indexer/agent traffic classification split, and ad activity. Without WALLET_PRIVATE_KEY, returns the x402 payment challenge instead of settling.",
  },
  {
    name: "get_intent_trends",
    title: "Get Intent Trends",
    description:
      "Paid, $0.01 USDC on Base via x402. Google-Trends-for-agents: top requested x402 endpoints and categories by autonomous agents, split by traffic class. Without WALLET_PRIVATE_KEY, returns the x402 payment challenge instead of settling.",
  },
  {
    name: "get_category_demand",
    title: "Get Category Demand",
    description:
      "Paid, $0.02 USDC on Base via x402. Demand depth for one category: probe volume, distinct sources, buyer-class share, price points probed, daily series. Without WALLET_PRIVATE_KEY, returns the x402 payment challenge instead of settling.",
  },
  {
    name: "get_intent_report",
    title: "Get Intent Report",
    description:
      "Why-agents-didn't-buy funnel for one service: bounce funnel, traffic classes, top abandoned endpoints, retry signals. FREE with X402_ADS_PUBLISHER_KEY for services you contribute events to (the data co-op rule); otherwise $0.05 USDC on Base via x402. Without a publisher key or WALLET_PRIVATE_KEY, returns the x402 payment challenge.",
  },
  {
    name: "get_terms",
    title: "Get Terms & Data Disclosure",
    description:
      "Free. The network's canonical terms of service and complete data-collection disclosure: exactly what the middleware sends and never sends.",
  },
];

function walletClient() {
  const key = process.env.WALLET_PRIVATE_KEY;
  if (!key) return null;
  const pk = key.startsWith("0x") ? key : "0x" + key;
  const account = privateKeyToAccount(pk);
  const coreClient = new x402Client().register("eip155:*", new ExactEvmScheme(toClientEvmSigner(account)));
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

async function createChainTimedPaymentPayload(httpClient, paymentRequired) {
  try {
    const publicClient = createPublicClient({ chain: base, transport: http(BASE_RPC_URL) });
    const block = await publicClient.getBlock();
    const chainNow = Number(block.timestamp);
    const originalNow = Date.now;
    const localNow = Math.floor(originalNow() / 1000);
    const timeout = Number(paymentRequired.accepts?.[0]?.maxTimeoutSeconds || 300);
    const signingNow = Math.min(Math.max(chainNow, localNow + 30 - timeout), chainNow + 600);
    Date.now = () => signingNow * 1000;
    try {
      return await httpClient.createPaymentPayload(paymentRequired);
    } finally {
      Date.now = originalNow;
    }
  } catch (_) {
    return httpClient.createPaymentPayload(paymentRequired);
  }
}

// Challenge-first paid GET: publisher free lane → settle if wallet → structured 402 otherwise.
async function paidGet(path) {
  const headers = {};
  if (process.env.X402_ADS_PUBLISHER_KEY) headers["x-publisher-key"] = process.env.X402_ADS_PUBLISHER_KEY;
  const url = BASE_URL + path;

  const res = await fetch(url, { headers });
  if (res.ok) {
    const viaPublisherKey = !!process.env.X402_ADS_PUBLISHER_KEY;
    return { paid: false, ...(viaPublisherKey ? { free_via_publisher_key: true } : {}), data: await res.json() };
  }
  if (res.status !== 402) {
    const text = await res.text().catch(() => "");
    throw new Error(`GET ${path} failed: ${res.status} ${text.slice(0, 240)}`);
  }

  let challengeBody;
  try {
    challengeBody = await res.clone().json();
  } catch (_) {}

  const httpClient = walletClient();
  if (!httpClient) {
    return {
      payment_required: true,
      challenge: slimChallenge(res, challengeBody),
      how_to_pay:
        "Set WALLET_PRIVATE_KEY (Base mainnet wallet holding USDC) to settle this x402 call automatically, or set X402_ADS_PUBLISHER_KEY to get reports on your own services free.",
    };
  }

  const paymentRequired = httpClient.getPaymentRequiredResponse((name) => res.headers.get(name), challengeBody);
  const paymentPayload = await createChainTimedPaymentPayload(httpClient, paymentRequired);
  const paidRes = await fetch(url, {
    headers: { ...headers, ...httpClient.encodePaymentSignatureHeader(paymentPayload) },
  });
  if (!paidRes.ok) {
    const text = await paidRes.text().catch(() => paidRes.statusText);
    throw new Error(`Paid call failed: ${paidRes.status} ${text.slice(0, 240)}`);
  }
  return {
    paid: true,
    payment_response: paidRes.headers.get("payment-response"),
    data: await paidRes.json(),
  };
}

async function freeGet(path, asText = false) {
  const res = await fetch(BASE_URL + path);
  if (!res.ok) throw new Error(`GET ${path} failed: ${res.status}`);
  return asText ? res.text() : res.json();
}

function qs(params) {
  const q = Object.entries(params)
    .filter(([, v]) => v !== undefined && v !== null && v !== "")
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
    .join("&");
  return q ? `?${q}` : "";
}

async function callTool(name, args = {}) {
  if (name === "get_network_counters") return freeGet("/v1/counters");

  if (name === "preview_recommendations") {
    const res = await fetch(BASE_URL + "/v1/decide", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        service: args.service || "mcp-preview",
        endpoint: args.endpoint || "/api/example",
        category: args.category,
      }),
    });
    if (!res.ok) throw new Error(`POST /v1/decide failed: ${res.status}`);
    return res.json();
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

const server = new McpServer({ name: "x402-ads-mcp", version: "0.1.0" });
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

if (require.main === module) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}

module.exports = { TOOLS, TOOL_SCHEMAS, callTool };
