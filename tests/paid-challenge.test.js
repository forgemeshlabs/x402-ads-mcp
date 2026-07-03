#!/usr/bin/env node
"use strict";
// Challenge-first test: with NO wallet configured, every paid tool returns a
// structured x402 payment challenge instead of settling. This test cannot
// spend funds by construction — it deletes the payment env vars before loading.

const assert = require("assert");
delete process.env.WALLET_PRIVATE_KEY;
delete process.env.X402_ADS_PUBLISHER_KEY;

const { callTool } = require("../index.js");

const PAID_CALLS = [
  ["get_network_stats", {}],
  ["get_intent_trends", { window: "7d", limit: 5 }],
  ["get_category_demand", { category: "finance" }],
  ["get_intent_report", { service: "example-service" }],
];

(async () => {
  for (const [name, args] of PAID_CALLS) {
    const out = await callTool(name, args);
    assert.strictEqual(out.payment_required, true, `${name} should require payment, not settle`);
    assert.strictEqual(out.paid, undefined, `${name} must not settle without a wallet`);
    assert.ok(Array.isArray(out.challenge?.accepts) && out.challenge.accepts.length > 0, `${name} challenge should include accepts`);
    assert.ok(out.challenge.accepts[0].network, `${name} challenge should name the network`);
    assert.ok(typeof out.how_to_pay === "string", `${name} should explain how to enable payment`);
    console.log(`✓ ${name} → x402 challenge (${out.challenge.price || out.challenge.accepts[0].amount})`);
  }
  console.log("All paid tools are challenge-first without a wallet. No funds can move.");
})().catch((e) => {
  console.error(`✗ ${e.message}`);
  process.exit(1);
});
