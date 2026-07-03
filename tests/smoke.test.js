#!/usr/bin/env node
"use strict";
// Smoke test: the MCP server boots over stdio and lists its tools.
// Runs with a sanitized environment — no wallet, no publisher key, no network calls.

const assert = require("assert");
const path = require("path");
const { spawn } = require("child_process");

const EXPECTED_TOOLS = [
  "get_network_counters",
  "preview_recommendations",
  "get_network_stats",
  "get_intent_trends",
  "get_category_demand",
  "get_intent_report",
  "get_terms",
];

const env = { ...process.env };
delete env.WALLET_PRIVATE_KEY;
delete env.X402_ADS_PUBLISHER_KEY;

const child = spawn(process.execPath, [path.join(__dirname, "..", "index.js")], {
  env,
  stdio: ["pipe", "pipe", "inherit"],
});

const timeout = setTimeout(() => {
  console.error("✗ timed out waiting for tools/list response");
  child.kill();
  process.exit(1);
}, 15000);

let buffer = "";
child.stdout.on("data", (chunk) => {
  buffer += chunk.toString();
  let idx;
  while ((idx = buffer.indexOf("\n")) >= 0) {
    const line = buffer.slice(0, idx).trim();
    buffer = buffer.slice(idx + 1);
    if (!line) continue;
    let msg;
    try {
      msg = JSON.parse(line);
    } catch (_) {
      continue;
    }
    if (msg.id === 1) {
      send({ jsonrpc: "2.0", method: "notifications/initialized" });
      send({ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} });
    }
    if (msg.id === 2) {
      const names = (msg.result?.tools || []).map((t) => t.name).sort();
      assert.deepStrictEqual(names, [...EXPECTED_TOOLS].sort(), "tool list mismatch");
      console.log(`✓ MCP boots over stdio and lists ${names.length} tools`);
      clearTimeout(timeout);
      child.kill();
      process.exit(0);
    }
  }
});

function send(msg) {
  child.stdin.write(JSON.stringify(msg) + "\n");
}

send({
  jsonrpc: "2.0",
  id: 1,
  method: "initialize",
  params: { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "smoke-test", version: "0.0.0" } },
});
