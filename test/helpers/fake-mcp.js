// A tiny MCP server over stdio for tests: tools "echo" (read-only) and "add_note"
const readline = require("node:readline");
const rl = readline.createInterface({ input: process.stdin });
const send = (m) => process.stdout.write(JSON.stringify(m) + "\n");
console.log("a log line that isn't JSON");
const tools = [
  { name: "echo", description: "Says it back", inputSchema: { type: "object", properties: { text: { type: "string", description: "What to say" }, loud: { type: ["boolean", "null"] } }, required: ["text"] }, annotations: { readOnlyHint: true } },
  { name: "add-note", description: "Adds a note", inputSchema: { type: "object", properties: { note: { anyOf: [{ type: "string" }, { type: "null" }] }, tags: { type: "array", items: { type: "string" } } } } },
];
rl.on("line", (line) => {
  const m = JSON.parse(line);
  if (m.method === "initialize") send({ jsonrpc: "2.0", id: m.id, result: { protocolVersion: m.params.protocolVersion, capabilities: { tools: {} }, serverInfo: { name: "fake", version: "1" } } });
  else if (m.method === "tools/list") send({ jsonrpc: "2.0", id: m.id, result: { tools } });
  else if (m.method === "tools/call") {
    if (m.params.name === "echo") send({ jsonrpc: "2.0", id: m.id, result: { content: [{ type: "text", text: (m.params.arguments.loud ? m.params.arguments.text.toUpperCase() : m.params.arguments.text) + ` (env ${process.env.FAKE_SECRET || "none"})` }] } });
    else send({ jsonrpc: "2.0", id: m.id, result: { isError: true, content: [{ type: "text", text: "notes are full" }] } });
  } else if (m.id !== undefined) send({ jsonrpc: "2.0", id: m.id, error: { code: -32601, message: "no" } });
});
