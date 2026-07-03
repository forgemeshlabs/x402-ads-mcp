#!/usr/bin/env node
"use strict";
// Free-tools test: the three no-cost tools work against the live public network.
// No wallet, no publisher key, no payment — nothing here can spend funds.

const assert = require("assert");
delete process.env.WALLET_PRIVATE_KEY;
delete process.env.X402_ADS_PUBLISHER_KEY;

const { callTool } = require("../index.js");

(async () => {
  const counters = await callTool("get_network_counters");
  assert.ok(counters.events_observed > 0, "counters should report observed events");
  console.log(`✓ get_network_counters (${counters.events_observed.toLocaleString()} events observed)`);

  const preview = await callTool("preview_recommendations", { category: "finance", endpoint: "/api/example" });
  assert.ok(Array.isArray(preview.recommendations?.items), "preview should return a typed items array");
  assert.ok(preview.recommendations.items.every((i) => typeof i.type === "string"), "every item carries a type label");
  console.log(`✓ preview_recommendations (${preview.recommendations.items.length} items, all typed)`);

  const terms = await callTool("get_terms");
  assert.ok(terms.terms.includes("DATA WE COLLECT"), "terms include the data disclosure");
  assert.ok(terms.terms.includes("DATA WE DO NOT COLLECT"), "terms include the never-collected list");
  console.log("✓ get_terms (full data disclosure served)");

  console.log("All free-tool assertions passed.");
})().catch((e) => {
  console.error(`✗ ${e.message}`);
  process.exit(1);
});
