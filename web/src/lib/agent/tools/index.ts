/**
 * Tool registry and exports for BudAgent.
 *
 * The ToolRegistry manages all available tools and provides methods
 * to register, retrieve, and convert tools to LLM-compatible schemas.
 */

export type { Tool, ToolParameter, ToolSchema } from "./base";
export { toolToSchema } from "./base";
export {
  ReadFileTool,
  WriteFileTool,
  EditFileTool,
  PathTraversalError,
  createFileTools,
} from "./file-tools";
export { BashTool } from "./bash-tool";
export { GlobTool, GrepTool } from "./search-tools";
export {
  OnyxSearchTool,
  createOnyxSearchTool,
  type OnyxSearchToolConfig,
} from "./onyx-search-tool";
export {
  MemorySearchTool,
  MemoryGetTool,
  createMemoryTools,
} from "./memory-tools";
import type { Tool, ToolSchema } from "./base";
import { OnyxSearchTool } from "./onyx-search-tool";
import { MemorySearchTool, MemoryGetTool } from "./memory-tools";
import { toolToSchema } from "./base";
import type { MemorySearch } from "../memory/search";

/**
 * Registry for managing agent tools.
 *
 * The ToolRegistry provides a centralized way to manage tools that the agent
 * can use. It handles tool registration, retrieval, and schema generation
 * for LLM API calls.
 *
 * @example
 * ```typescript
 * const registry = new ToolRegistry('/path/to/workspace');
 *
 * registry.register({
 *   name: 'my_tool',
 *   description: 'Does something useful',
 *   parameters: [],
 *   execute: async () => 'done'
 * });
 *
 * const schemas = registry.getSchemas();
 * // Pass schemas to LLM API
 * ```
 */
export class ToolRegistry {
  private tools: Map<string, Tool> = new Map();
  private workspacePath: string;
  private apiBaseUrl?: string;
  private authToken?: string;

  /**
   * Creates a new ToolRegistry.
   *
   * @param workspacePath - The path to the workspace directory for file operations
   * @param apiBaseUrl - Optional base URL for API calls (e.g., for Onyx search)
   * @param authToken - Optional authentication token for API calls
   */
  constructor(workspacePath: string, apiBaseUrl?: string, authToken?: string) {
    this.workspacePath = workspacePath;
    this.apiBaseUrl = apiBaseUrl;
    this.authToken = authToken;
  }

  /**
   * Registers the Onyx search tool if API configuration is available.
   *
   * This method should be called after creating the registry to add the
   * Onyx search tool when an API base URL and auth token are provided.
   *
   * @returns True if the tool was registered, false if API config was missing
   */
  registerOnyxSearchTool(): boolean {
    if (this.apiBaseUrl) {
      const onyxSearchTool = new OnyxSearchTool({
        apiBaseUrl: this.apiBaseUrl,
        authToken: this.authToken,
      });
      this.register(onyxSearchTool);
      return true;
    }
    return false;
  }

  /**
   * Registers the memory tools for searching and retrieving from memory.
   *
   * This method registers both the memory_search and memory_get tools.
   * The memory_search tool requires a MemorySearch instance for performing
   * hybrid searches. The memory_get tool only requires the workspace path.
   *
   * @param memorySearch - Optional MemorySearch instance for search operations.
   *                       If not provided, the memory_search tool will return
   *                       an error when called until setMemorySearch is called
   *                       on the MemorySearchTool.
   */
  registerMemoryTools(memorySearch?: MemorySearch): void {
    const memorySearchTool = new MemorySearchTool(
      this.workspacePath,
      memorySearch
    );
    const memoryGetTool = new MemoryGetTool(this.workspacePath);

    this.register(memorySearchTool);
    this.register(memoryGetTool);
  }

  /**
   * Gets the MemorySearchTool if registered, for updating the MemorySearch instance.
   *
   * @returns The MemorySearchTool if registered, undefined otherwise
   */
  getMemorySearchTool(): MemorySearchTool | undefined {
    const tool = this.get("memory_search");
    if (tool instanceof MemorySearchTool) {
      return tool;
    }
    return undefined;
  }

  /**
   * Registers a tool with the registry.
   *
   * If a tool with the same name already exists, it will be overwritten.
   *
   * @param tool - The tool to register
   */
  register(tool: Tool): void {
    this.tools.set(tool.name, tool);
  }

  /**
   * Retrieves a tool by name.
   *
   * @param name - The name of the tool to retrieve
   * @returns The tool if found, undefined otherwise
   */
  get(name: string): Tool | undefined {
    return this.tools.get(name);
  }

  /**
   * Returns all registered tools.
   *
   * @returns An array of all registered tools
   */
  getAll(): Tool[] {
    return Array.from(this.tools.values());
  }

  /**
   * Returns tool schemas for all registered tools.
   *
   * This is useful for passing to LLM APIs that need to know
   * about available tools.
   *
   * @returns An array of tool schemas in OpenAI/Anthropic format
   */
  getSchemas(): ToolSchema[] {
    return this.getAll().map((tool) => toolToSchema(tool));
  }

  /**
   * Returns the workspace path configured for this registry.
   *
   * @returns The workspace path
   */
  getWorkspacePath(): string {
    return this.workspacePath;
  }

  /**
   * Returns the API base URL configured for this registry.
   *
   * @returns The API base URL, or undefined if not configured
   */
  getApiBaseUrl(): string | undefined {
    return this.apiBaseUrl;
  }

  /**
   * Returns the auth token configured for this registry.
   *
   * @returns The auth token, or undefined if not configured
   */
  getAuthToken(): string | undefined {
    return this.authToken;
  }

  /**
   * Checks if a tool with the given name is registered.
   *
   * @param name - The name of the tool to check
   * @returns True if the tool exists, false otherwise
   */
  has(name: string): boolean {
    return this.tools.has(name);
  }

  /**
   * Removes a tool from the registry.
   *
   * @param name - The name of the tool to remove
   * @returns True if the tool was removed, false if it didn't exist
   */
  unregister(name: string): boolean {
    return this.tools.delete(name);
  }

  /**
   * Returns the number of registered tools.
   *
   * @returns The count of registered tools
   */
  size(): number {
    return this.tools.size;
  }

  /**
   * Clears all registered tools.
   */
  clear(): void {
    this.tools.clear();
  }
}
