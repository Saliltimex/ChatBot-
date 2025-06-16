import { generateAuthUrl } from "./auth.server";
import { getCustomerToken } from "./db.server";

/**
 * Client for interacting with Model Context Protocol (MCP) API endpoints.
 */
class MCPClient {
  constructor(hostUrl, conversationId, shopId, customerMcpEndpoint) {
    this.tools = [];
    this.customerTools = [];

    // Legacy customer account MCP endpoint fallback
    this.customerMcpEndpoint =
      customerMcpEndpoint || `${hostUrl.replace(/\/$/, "")}/account/customer/api/mcp`;

    this.customerAccessToken = "";
    this.conversationId = conversationId;
    this.shopId = shopId;
  }

  /**
   * Connects to the customer MCP server and retrieves available tools.
   */
  async connectToCustomerServer() {
    try {
      console.log(`Connecting to MCP server at ${this.customerMcpEndpoint}`);

      if (this.conversationId) {
        const dbToken = await getCustomerToken(this.conversationId);
        if (dbToken?.accessToken) {
          this.customerAccessToken = dbToken.accessToken;
        } else {
          console.log("No token in database for conversation:", this.conversationId);
        }
      }

      const headers = {
        "Content-Type": "application/json",
        Authorization: this.customerAccessToken || ""
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
    } catch (e) {
      console.error("Failed to connect to MCP server:", e.message || e);
      throw e;
    }
  }

  /**
   * Dispatches a tool call to the appropriate MCP server.
   */
  async callTool(toolName, toolArgs) {
    if (this.customerTools.some(tool => tool.name === toolName)) {
      return this.callCustomerTool(toolName, toolArgs);
    } else {
      throw new Error(`Tool ${toolName} not found`);
    }
  }

  /**
   * Calls a customer tool via the MCP server.
   */
  async callCustomerTool(toolName, toolArgs) {
    try {
      console.log("Calling customer tool:", toolName, toolArgs);

      if (!this.customerAccessToken) {
        const dbToken = await getCustomerToken(this.conversationId);
        if (dbToken?.accessToken) {
          this.customerAccessToken = dbToken.accessToken;
        } else {
          console.log("No token in database for conversation:", this.conversationId);
        }
      }

      const headers = {
        "Content-Type": "application/json",
        Authorization: this.customerAccessToken
      };

      try {
        const response = await this._makeJsonRpcRequest(
          this.customerMcpEndpoint,
          "tools/call",
          { name: toolName, arguments: toolArgs },
          headers
        );
        return response.result || response;
      } catch (error) {
        if (error.status === 401) {
          console.log("Unauthorized. Generating auth URL...");
          const authResponse = await generateAuthUrl(this.conversationId, this.shopId);
          return {
            error: {
              type: "auth_required",
              data: `You need to authorize the app to access your customer data. [Click here to authorize](${authResponse.url})`
            }
          };
        }

        throw error;
      }
    } catch (error) {
      console.error(`Error calling tool ${toolName}:`, error.message || error);
      return {
        error: {
          type: "internal_error",
          data: `Error calling tool ${toolName}: ${error.message}`
        }
      };
    }
  }

  /**
   * Makes a JSON-RPC request to the MCP server.
   */
  async _makeJsonRpcRequest(endpoint, method, params, headers) {
    const response = await fetch(endpoint, {
      method: "POST",
      headers,
      body: JSON.stringify({
        jsonrpc: "2.0",
        method,
        id: 1,
        params
      })
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
        `Expected JSON but got ${contentType}. Response was: ${text.slice(0, 200)}`
      );
      error.status = 500;
      throw error;
    }

    return JSON.parse(text);
  }

  /**
   * Formats tool objects from MCP into internal format.
   */
  _formatToolsData(toolsData) {
    return toolsData.map(tool => ({
      name: tool.name,
      description: tool.description,
      input_schema: tool.inputSchema || tool.input_schema
    }));
  }
}

export default MCPClient;
