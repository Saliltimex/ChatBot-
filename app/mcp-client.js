import { generateAuthUrl } from "./auth.server";
import { getCustomerToken } from "./db.server";

class MCPClient {
  constructor(hostUrl, conversationId, shopId, customerMcpEndpoint) {
    this.tools = [];
    this.customerTools = [];
    this.storefrontTools = [];

    this.storefrontMcpEndpoint = `${hostUrl.replace(/\/$/, "")}/api/mcp`;
    this.customerMcpEndpoint =
      customerMcpEndpoint || `${hostUrl.replace(/\/$/, "")}/account/customer/api/mcp`;

    this.customerAccessToken = "";
    this.conversationId = conversationId;
    this.shopId = shopId;
  }

  async connectToCustomerServer() {
    try {
      console.log(`Connecting to Customer MCP at ${this.customerMcpEndpoint}`);

      const dbToken = await getCustomerToken(this.conversationId);
      if (dbToken?.accessToken) {
        this.customerAccessToken = dbToken.accessToken;
      }

      const headers = {
        "Content-Type": "application/json",
        Authorization: this.customerAccessToken || "",
      };

      const response = await this._makeJsonRpcRequest(
        this.customerMcpEndpoint,
        "tools/list",
        {},
        headers
      );

      const toolsData = response?.result?.tools || [];
      const customerTools = this._formatToolsData(toolsData);

      this.customerTools = customerTools;
      this.tools = [...this.tools, ...customerTools];

      return customerTools;
    } catch (error) {
      console.error("Failed to connect to Customer MCP server:", error.message);
      throw error;
    }
  }

  async connectToStorefrontServer() {
    try {
      console.log(`Connecting to Storefront MCP at ${this.storefrontMcpEndpoint}`);

      const headers = {
        "Content-Type": "application/json",
      };

      const response = await this._makeJsonRpcRequest(
        this.storefrontMcpEndpoint,
        "tools/list",
        {},
        headers
      );

      const toolsData = response?.result?.tools || [];
      const storefrontTools = this._formatToolsData(toolsData);

      this.storefrontTools = storefrontTools;
      this.tools = [...this.tools, ...storefrontTools];

      return storefrontTools;
    } catch (error) {
      console.error("Failed to connect to Storefront MCP server:", error.message);
      throw error;
    }
  }

  async callTool(toolName, toolArgs) {
    if (this.customerTools.some((tool) => tool.name === toolName)) {
      return this.callCustomerTool(toolName, toolArgs);
    } else if (this.storefrontTools.some((tool) => tool.name === toolName)) {
      return this.callStorefrontTool(toolName, toolArgs);
    } else {
      throw new Error(`Tool ${toolName} not found`);
    }
  }

  async callStorefrontTool(toolName, toolArgs) {
    try {
      const headers = {
        "Content-Type": "application/json",
      };

      const response = await this._makeJsonRpcRequest(
        this.storefrontMcpEndpoint,
        "tools/call",
        { name: toolName, arguments: toolArgs },
        headers
      );

      return response.result || response;
    } catch (error) {
      console.error(`Error calling storefront tool ${toolName}:`, error.message);
      throw error;
    }
  }

  async callCustomerTool(toolName, toolArgs) {
    try {
      if (!this.customerAccessToken) {
        const dbToken = await getCustomerToken(this.conversationId);
        if (dbToken?.accessToken) {
          this.customerAccessToken = dbToken.accessToken;
        }
      }

      const headers = {
        "Content-Type": "application/json",
        Authorization: this.customerAccessToken || "",
      };

      const response = await this._makeJsonRpcRequest(
        this.customerMcpEndpoint,
        "tools/call",
        { name: toolName, arguments: toolArgs },
        headers
      );

      return response.result || response;
    } catch (error) {
      if (error.status === 401) {
        const authResponse = await generateAuthUrl(this.conversationId, this.shopId);
        return {
          error: {
            type: "auth_required",
            data: `You need to authorize access. [Click here to authorize](${authResponse.url})`,
          },
        };
      }

      console.error(`Error calling customer tool ${toolName}:`, error.message);
      return {
        error: {
          type: "internal_error",
          data: `Error calling tool ${toolName}: ${error.message}`,
        },
      };
    }
  }

  async _makeJsonRpcRequest(endpoint, method, params, headers) {
    const response = await fetch(endpoint, {
      method: "POST",
      headers,
      body: JSON.stringify({
        jsonrpc: "2.0",
        method,
        id: 1,
        params,
      }),
    });

    const contentType = response.headers.get("Content-Type") || "";
    const text = await response.text();

    if (!response.ok) {
      const error = new Error(`Request failed: ${response.status} - ${text.slice(0, 200)}`);
      error.status = response.status;
      throw error;
    }

    if (!contentType.includes("application/json")) {
      const error = new Error(
        `Expected JSON, got ${contentType}. Response: ${text.slice(0, 200)}`
      );
      error.status = 500;
      throw error;
    }

    return JSON.parse(text);
  }

  _formatToolsData(toolsData) {
    return toolsData.map((tool) => ({
      name: tool.name,
      description: tool.description,
      input_schema: tool.inputSchema || tool.input_schema,
    }));
  }
}

export default MCPClient;
