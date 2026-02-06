/**
 * Base interfaces and utilities for BudAgent tools.
 *
 * Tools are the primary mechanism for the agent to interact with the environment.
 * Each tool defines a name, description, parameters, and an execute function.
 */

/**
 * Defines a single parameter for a tool.
 */
export interface ToolParameter {
  /** The name of the parameter */
  name: string;
  /** The type of the parameter value */
  type: "string" | "number" | "boolean" | "array" | "object";
  /** A description of what this parameter does */
  description: string;
  /** Whether this parameter is required. Defaults to true. */
  required?: boolean;
  /** For string types, an optional list of allowed values */
  enum?: string[];
}

/**
 * Defines a tool that the agent can use.
 *
 * Tools encapsulate actions the agent can take, such as reading files,
 * executing commands, or searching for information.
 */
export interface Tool {
  /** Unique identifier for the tool */
  name: string;
  /** Human-readable description of what the tool does */
  description: string;
  /** List of parameters the tool accepts */
  parameters: ToolParameter[];
  /** Whether this tool requires user approval before execution. Defaults to false. */
  requiresApproval?: boolean;
  /**
   * Execute the tool with the given parameters.
   * @param params - Key-value pairs of parameter names to values
   * @returns A promise that resolves to a string result
   */
  execute(params: Record<string, unknown>): Promise<string>;
}

/**
 * OpenAI/Anthropic function parameter schema
 */
interface FunctionParameterSchema {
  type: "object";
  properties: Record<
    string,
    {
      type: string;
      description: string;
      enum?: string[];
      items?: { type: string };
    }
  >;
  required: string[];
}

/**
 * OpenAI/Anthropic tool schema format
 */
export interface ToolSchema {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: FunctionParameterSchema;
  };
}

/**
 * Maps ToolParameter types to JSON Schema types.
 */
function mapParameterType(type: ToolParameter["type"]): string {
  switch (type) {
    case "string":
      return "string";
    case "number":
      return "number";
    case "boolean":
      return "boolean";
    case "array":
      return "array";
    case "object":
      return "object";
    default:
      return "string";
  }
}

/**
 * Converts a Tool to the OpenAI/Anthropic tool schema format.
 *
 * This format is used when calling LLM APIs to describe available tools.
 *
 * @param tool - The tool to convert
 * @returns The tool in OpenAI/Anthropic schema format
 *
 * @example
 * ```typescript
 * const tool: Tool = {
 *   name: 'read_file',
 *   description: 'Read contents of a file',
 *   parameters: [
 *     { name: 'path', type: 'string', description: 'File path to read' }
 *   ],
 *   execute: async (params) => { ... }
 * };
 *
 * const schema = toolToSchema(tool);
 * // {
 * //   type: 'function',
 * //   function: {
 * //     name: 'read_file',
 * //     description: 'Read contents of a file',
 * //     parameters: {
 * //       type: 'object',
 * //       properties: {
 * //         path: { type: 'string', description: 'File path to read' }
 * //       },
 * //       required: ['path']
 * //     }
 * //   }
 * // }
 * ```
 */
export function toolToSchema(tool: Tool): ToolSchema {
  const properties: FunctionParameterSchema["properties"] = {};
  const required: string[] = [];

  for (const param of tool.parameters) {
    const propertySchema: {
      type: string;
      description: string;
      enum?: string[];
      items?: { type: string };
    } = {
      type: mapParameterType(param.type),
      description: param.description,
    };

    // Add enum constraint if specified
    if (param.enum && param.enum.length > 0) {
      propertySchema.enum = param.enum;
    }

    // For array types, add items schema (default to string items)
    if (param.type === "array") {
      propertySchema.items = { type: "string" };
    }

    properties[param.name] = propertySchema;

    // Parameter is required unless explicitly set to false
    if (param.required !== false) {
      required.push(param.name);
    }
  }

  return {
    type: "function",
    function: {
      name: tool.name,
      description: tool.description,
      parameters: {
        type: "object",
        properties,
        required,
      },
    },
  };
}
