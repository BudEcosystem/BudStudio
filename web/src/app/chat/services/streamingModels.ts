import { OnyxDocument } from "@/lib/search/interfaces";

// Base interface for all streaming objects
interface BaseObj {
  type: string;
}

export enum PacketType {
  MESSAGE_START = "message_start",
  MESSAGE_DELTA = "message_delta",
  MESSAGE_END = "message_end",

  STOP = "stop",
  SECTION_END = "section_end",

  // Specific tool packets
  SEARCH_TOOL_START = "internal_search_tool_start",
  SEARCH_TOOL_DELTA = "internal_search_tool_delta",
  IMAGE_GENERATION_TOOL_START = "image_generation_tool_start",
  IMAGE_GENERATION_TOOL_DELTA = "image_generation_tool_delta",
  FETCH_TOOL_START = "fetch_tool_start",

  // Custom tool packets
  CUSTOM_TOOL_START = "custom_tool_start",
  CUSTOM_TOOL_DELTA = "custom_tool_delta",

  // Reasoning packets
  REASONING_START = "reasoning_start",
  REASONING_DELTA = "reasoning_delta",
  REASONING_END = "reasoning_end",

  CITATION_START = "citation_start",
  CITATION_DELTA = "citation_delta",
  CITATION_END = "citation_end",

  // Agent-specific packets
  AGENT_APPROVAL_REQUIRED = "agent_approval_required",
  AGENT_SESSION_COMPACTED = "agent_session_compacted",
  AGENT_LOCAL_TOOL_REQUEST = "agent_local_tool_request",
  AGENT_STOPPED = "agent_stopped",
  AGENT_DONE = "agent_done",

  // Canvas packets
  CANVAS_GENERATION = "canvas_generation",
}

// Basic Message Packets
export interface MessageStart extends BaseObj {
  id: string;
  type: "message_start";
  content: string;

  final_documents: OnyxDocument[] | null;
}

export interface MessageDelta extends BaseObj {
  content: string;
  type: "message_delta";
}

export interface MessageEnd extends BaseObj {
  type: "message_end";
}

// Control Packets
export interface Stop extends BaseObj {
  type: "stop";
}

export interface SectionEnd extends BaseObj {
  type: "section_end";
}

export interface PacketException extends BaseObj {
  type: "error";
  exception?: string;
}

// Specific tool packets
export interface SearchToolStart extends BaseObj {
  type: "internal_search_tool_start";
  is_internet_search?: boolean;
}

export interface SearchToolDelta extends BaseObj {
  type: "internal_search_tool_delta";
  queries: string[] | null;
  documents: OnyxDocument[] | null;
}

export type ImageShape = "square" | "landscape" | "portrait";

interface GeneratedImage {
  file_id: string;
  url: string;
  revised_prompt: string;
  shape?: ImageShape;
}

export interface ImageGenerationToolStart extends BaseObj {
  type: "image_generation_tool_start";
}

export interface ImageGenerationToolDelta extends BaseObj {
  type: "image_generation_tool_delta";
  images: GeneratedImage[];
}

export interface FetchToolStart extends BaseObj {
  type: "fetch_tool_start";
  queries: string[] | null;
  documents: OnyxDocument[] | null;
}

// Custom Tool Packets
export interface CustomToolStart extends BaseObj {
  type: "custom_tool_start";
  tool_name: string;
}

export interface CustomToolDelta extends BaseObj {
  type: "custom_tool_delta";
  tool_name: string;
  response_type: string;
  data?: any;
  file_ids?: string[] | null;
  openui_response?: string | null;
}

// Reasoning Packets
export interface ReasoningStart extends BaseObj {
  type: "reasoning_start";
}

export interface ReasoningDelta extends BaseObj {
  type: "reasoning_delta";
  reasoning: string;
}

// Citation Packets
export interface StreamingCitation {
  citation_num: number;
  document_id: string;
}

export interface CitationStart extends BaseObj {
  type: "citation_start";
}

export interface CitationDelta extends BaseObj {
  type: "citation_delta";
  citations: StreamingCitation[];
}

// Agent-specific packets
export interface AgentApprovalRequired extends BaseObj {
  type: "agent_approval_required";
  tool_name: string;
  tool_input: Record<string, unknown> | null;
  tool_call_id: string;
}

export interface AgentSessionCompacted extends BaseObj {
  type: "agent_session_compacted";
  new_session_id: string;
  summary: string;
}

export interface AgentLocalToolRequest extends BaseObj {
  type: "agent_local_tool_request";
  tool_name: string;
  tool_input: Record<string, unknown> | null;
  tool_call_id: string;
}

export interface AgentStopped extends BaseObj {
  type: "agent_stopped";
}

export interface AgentDone extends BaseObj {
  type: "agent_done";
}

// Canvas packets
export interface CanvasGeneration extends BaseObj {
  type: "canvas_generation";
  openui_lang: string;
  title: string;
}

export type AgentObj =
  | AgentApprovalRequired
  | AgentSessionCompacted
  | AgentLocalToolRequest
  | AgentStopped
  | AgentDone;

export type ChatObj = MessageStart | MessageDelta | MessageEnd;

export type StopObj = Stop;

export type SectionEndObj = SectionEnd;

// Specific tool objects
export type SearchToolObj = SearchToolStart | SearchToolDelta | SectionEnd;
export type ImageGenerationToolObj =
  | ImageGenerationToolStart
  | ImageGenerationToolDelta
  | SectionEnd;
export type FetchToolObj = FetchToolStart | SectionEnd;
export type CustomToolObj = CustomToolStart | CustomToolDelta | SectionEnd;
export type NewToolObj =
  | SearchToolObj
  | ImageGenerationToolObj
  | FetchToolObj
  | CustomToolObj;

export type ReasoningObj = ReasoningStart | ReasoningDelta | SectionEnd;

export type CitationObj = CitationStart | CitationDelta | SectionEnd;

// Union type for all possible streaming objects
export type ObjTypes =
  | ChatObj
  | NewToolObj
  | ReasoningObj
  | StopObj
  | SectionEndObj
  | CitationObj
  | AgentObj
  | CanvasGeneration
  | PacketException;

// Packet wrapper for streaming objects
export interface Packet {
  ind: number;
  obj: ObjTypes;
}

export interface ChatPacket {
  ind: number;
  obj: ChatObj;
}

export interface StopPacket {
  ind: number;
  obj: StopObj;
}

export interface CitationPacket {
  ind: number;
  obj: CitationObj;
}

// New specific tool packet types
export interface SearchToolPacket {
  ind: number;
  obj: SearchToolObj;
}

export interface ImageGenerationToolPacket {
  ind: number;
  obj: ImageGenerationToolObj;
}

export interface FetchToolPacket {
  ind: number;
  obj: FetchToolObj;
}

export interface CustomToolPacket {
  ind: number;
  obj: CustomToolObj;
}

export interface ReasoningPacket {
  ind: number;
  obj: ReasoningObj;
}

export interface SectionEndPacket {
  ind: number;
  obj: SectionEndObj;
}
