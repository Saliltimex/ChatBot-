// app/routes/api/mcp.ts

import { json } from "@remix-run/node";

export async function action({ request }) {
  const body = await request.json();

  console.log("🔍 MCP Request:", body);

  if (body.method === "tools/list") {
    return json({
      jsonrpc: "2.0",
      id: body.id,
      result: {
        tools: [
          {
            name: "productSearch",
            description: "Search for products",
            inputSchema: {
              type: "object",
              properties: {
                query: { type: "string" },
              },
              required: ["query"],
            },
          },
        ],
      },
    });
  }

  return json(
    {
      jsonrpc: "2.0",
      id: body.id,
      error: {
        code: -32601,
        message: "Method not found",
      },
    },
    { status: 404 }
  );
}

export const loader = () =>
  json({ message: "This endpoint only supports POST" }, { status: 405 });
