import {
  buildInterleavedSegments,
  groupPacketsByInd,
  getTextContent,
  isToolPacket,
  isDisplayPacket,
} from "./packetUtils";
import { Packet, PacketType } from "./streamingModels";

// Helper to create a minimal Packet
function pkt(ind: number, type: string, extra?: Record<string, unknown>): Packet {
  return { ind, obj: { type, ...extra } as Packet["obj"] };
}

// Type-safe helpers to access discriminated union fields
function expectTools(seg: { type: string }) {
  if (seg.type !== "tools") throw new Error(`Expected tools, got ${seg.type}`);
  return seg as { type: "tools"; groups: { ind: number; packets: Packet[] }[] };
}
function expectDisplay(seg: { type: string }) {
  if (seg.type !== "display") throw new Error(`Expected display, got ${seg.type}`);
  return seg as { type: "display"; group: { ind: number; packets: Packet[] } };
}

describe("buildInterleavedSegments", () => {
  it("returns empty array for empty input", () => {
    expect(buildInterleavedSegments([])).toEqual([]);
  });

  it("groups all consecutive tools into one segment when no display packets", () => {
    const grouped = groupPacketsByInd([
      pkt(1, PacketType.CUSTOM_TOOL_START, { tool_name: "a" }),
      pkt(1, PacketType.CUSTOM_TOOL_DELTA, { tool_name: "a", response_type: "json", data: {} }),
      pkt(1, PacketType.SECTION_END),
      pkt(2, PacketType.CUSTOM_TOOL_START, { tool_name: "b" }),
      pkt(2, PacketType.SECTION_END),
    ]);
    const segments = buildInterleavedSegments(grouped);

    expect(segments).toHaveLength(1);
    const seg = expectTools(segments[0]!);
    expect(seg.groups).toHaveLength(2);
    expect(seg.groups[0]!.ind).toBe(1);
    expect(seg.groups[1]!.ind).toBe(2);
  });

  it("splits tools around a display segment", () => {
    const grouped = groupPacketsByInd([
      pkt(1, PacketType.CUSTOM_TOOL_START, { tool_name: "a" }),
      pkt(1, PacketType.SECTION_END),
      pkt(2, PacketType.MESSAGE_START, { content: "text" }),
      pkt(2, PacketType.MESSAGE_DELTA, { content: " here" }),
      pkt(3, PacketType.CUSTOM_TOOL_START, { tool_name: "b" }),
      pkt(3, PacketType.SECTION_END),
    ]);
    const segments = buildInterleavedSegments(grouped);

    expect(segments).toHaveLength(3);
    const tools0 = expectTools(segments[0]!);
    const disp1 = expectDisplay(segments[1]!);
    const tools2 = expectTools(segments[2]!);

    expect(tools0.groups).toHaveLength(1);
    expect(tools0.groups[0]!.ind).toBe(1);
    expect(disp1.group.ind).toBe(2);
    expect(tools2.groups).toHaveLength(1);
    expect(tools2.groups[0]!.ind).toBe(3);
  });

  it("handles display-first then tools", () => {
    const grouped = groupPacketsByInd([
      pkt(1, PacketType.MESSAGE_START, { content: "hello" }),
      pkt(2, PacketType.CUSTOM_TOOL_START, { tool_name: "x" }),
      pkt(2, PacketType.SECTION_END),
    ]);
    const segments = buildInterleavedSegments(grouped);

    expect(segments).toHaveLength(2);
    expect(segments[0]!.type).toBe("display");
    expect(segments[1]!.type).toBe("tools");
  });

  it("merges consecutive tools but keeps separate display segments", () => {
    const grouped = groupPacketsByInd([
      pkt(1, PacketType.SEARCH_TOOL_START, { is_internet_search: false }),
      pkt(1, PacketType.SECTION_END),
      pkt(2, PacketType.CUSTOM_TOOL_START, { tool_name: "a" }),
      pkt(2, PacketType.SECTION_END),
      pkt(3, PacketType.MESSAGE_START, { content: "mid" }),
      pkt(4, PacketType.MESSAGE_START, { content: "final" }),
    ]);
    const segments = buildInterleavedSegments(grouped);

    expect(segments).toHaveLength(3);
    const tools0 = expectTools(segments[0]!);
    expect(tools0.groups).toHaveLength(2);
    expect(segments[1]!.type).toBe("display");
    expect(segments[2]!.type).toBe("display");
  });

  it("handles the full agent flow: tool → text → tool → text → tool → text", () => {
    const packets: Packet[] = [];
    // Tool A
    packets.push(pkt(1, PacketType.CUSTOM_TOOL_START, { tool_name: "get-events" }));
    packets.push(pkt(1, PacketType.CUSTOM_TOOL_DELTA, { tool_name: "get-events", response_type: "json", data: {} }));
    packets.push(pkt(1, PacketType.SECTION_END));
    // Text 1
    packets.push(pkt(2, PacketType.MESSAGE_START, { content: "Found " }));
    packets.push(pkt(2, PacketType.MESSAGE_DELTA, { content: "4 events" }));
    packets.push(pkt(2, PacketType.SECTION_END));
    // Tool B
    packets.push(pkt(3, PacketType.CUSTOM_TOOL_START, { tool_name: "ask-user" }));
    packets.push(pkt(3, PacketType.CUSTOM_TOOL_DELTA, { tool_name: "ask-user", response_type: "json", data: {} }));
    packets.push(pkt(3, PacketType.SECTION_END));
    // Text 2
    packets.push(pkt(4, PacketType.MESSAGE_START, { content: "User wants " }));
    packets.push(pkt(4, PacketType.MESSAGE_DELTA, { content: "MOM draft" }));
    packets.push(pkt(4, PacketType.SECTION_END));
    // Tool C
    packets.push(pkt(5, PacketType.CUSTOM_TOOL_START, { tool_name: "draft-email" }));
    packets.push(pkt(5, PacketType.CUSTOM_TOOL_DELTA, { tool_name: "draft-email", response_type: "json", data: {} }));
    packets.push(pkt(5, PacketType.SECTION_END));
    // Final text
    packets.push(pkt(6, PacketType.MESSAGE_START, { content: "Draft " }));
    packets.push(pkt(6, PacketType.MESSAGE_DELTA, { content: "created!" }));
    packets.push(pkt(6, PacketType.SECTION_END));

    const grouped = groupPacketsByInd(packets);
    const segments = buildInterleavedSegments(grouped);

    expect(segments).toHaveLength(6);
    expect(segments.map((s) => s.type)).toEqual([
      "tools", "display", "tools", "display", "tools", "display",
    ]);
  });

  it("does not classify lone SECTION_END groups as tools", () => {
    const grouped: { ind: number; packets: Packet[] }[] = [
      { ind: 1, packets: [pkt(1, PacketType.CUSTOM_TOOL_START, { tool_name: "a" })] },
      { ind: 2, packets: [pkt(2, PacketType.SECTION_END)] },
      { ind: 3, packets: [pkt(3, PacketType.MESSAGE_START, { content: "text" })] },
    ];
    const segments = buildInterleavedSegments(grouped);

    expect(segments).toHaveLength(2);
    const tools0 = expectTools(segments[0]!);
    expect(tools0.groups).toHaveLength(1);
    expect(segments[1]!.type).toBe("display");
  });

  it("includes reasoning groups in tool segments", () => {
    const grouped = groupPacketsByInd([
      pkt(1, PacketType.REASONING_START),
      pkt(1, PacketType.REASONING_DELTA, { reasoning: "thinking..." }),
      pkt(1, PacketType.SECTION_END),
      pkt(2, PacketType.CUSTOM_TOOL_START, { tool_name: "a" }),
      pkt(2, PacketType.SECTION_END),
      pkt(3, PacketType.MESSAGE_START, { content: "done" }),
    ]);
    const segments = buildInterleavedSegments(grouped);

    expect(segments).toHaveLength(2);
    const tools0 = expectTools(segments[0]!);
    expect(tools0.groups).toHaveLength(2);
    expect(segments[1]!.type).toBe("display");
  });

  it("skips empty packet groups", () => {
    const grouped: { ind: number; packets: Packet[] }[] = [
      { ind: 1, packets: [] },
      { ind: 2, packets: [pkt(2, PacketType.MESSAGE_START, { content: "hi" })] },
    ];
    const segments = buildInterleavedSegments(grouped);
    expect(segments).toHaveLength(1);
    expect(segments[0]!.type).toBe("display");
  });

  it("handles IMAGE_GENERATION_TOOL_START as display", () => {
    const grouped = groupPacketsByInd([
      pkt(1, PacketType.CUSTOM_TOOL_START, { tool_name: "a" }),
      pkt(1, PacketType.SECTION_END),
      pkt(2, PacketType.IMAGE_GENERATION_TOOL_START),
    ]);
    const segments = buildInterleavedSegments(grouped);

    expect(segments).toHaveLength(2);
    expect(segments[0]!.type).toBe("tools");
    expect(segments[1]!.type).toBe("display");
  });
});

describe("getTextContent", () => {
  it("extracts text from MESSAGE_START and MESSAGE_DELTA packets", () => {
    const packets: Packet[] = [
      pkt(1, PacketType.MESSAGE_START, { content: "Hello " }),
      pkt(1, PacketType.MESSAGE_DELTA, { content: "world" }),
      pkt(1, PacketType.SECTION_END),
    ];
    expect(getTextContent(packets)).toBe("Hello world");
  });

  it("returns empty string for non-message packets", () => {
    const packets: Packet[] = [
      pkt(1, PacketType.CUSTOM_TOOL_START, { tool_name: "a" }),
      pkt(1, PacketType.SECTION_END),
    ];
    expect(getTextContent(packets)).toBe("");
  });

  it("handles missing content gracefully", () => {
    const packets: Packet[] = [
      pkt(1, PacketType.MESSAGE_START, {}),
      pkt(1, PacketType.MESSAGE_DELTA, {}),
    ];
    expect(getTextContent(packets)).toBe("");
  });
});

describe("isToolPacket", () => {
  it("classifies tool start/delta packets", () => {
    expect(isToolPacket(pkt(0, PacketType.CUSTOM_TOOL_START, { tool_name: "a" }))).toBe(true);
    expect(isToolPacket(pkt(0, PacketType.SEARCH_TOOL_START, { is_internet_search: false }))).toBe(true);
    expect(isToolPacket(pkt(0, PacketType.REASONING_START))).toBe(true);
    expect(isToolPacket(pkt(0, PacketType.FETCH_TOOL_START))).toBe(true);
  });

  it("classifies SECTION_END as tool when includeSectionEnd=true", () => {
    expect(isToolPacket(pkt(0, PacketType.SECTION_END), true)).toBe(true);
    expect(isToolPacket(pkt(0, PacketType.SECTION_END), false)).toBe(false);
  });

  it("does not classify message packets as tools", () => {
    expect(isToolPacket(pkt(0, PacketType.MESSAGE_START, { content: "" }), false)).toBe(false);
    expect(isToolPacket(pkt(0, PacketType.MESSAGE_DELTA, { content: "" }), false)).toBe(false);
  });
});

describe("isDisplayPacket", () => {
  it("classifies MESSAGE_START as display", () => {
    expect(isDisplayPacket(pkt(0, PacketType.MESSAGE_START, { content: "" }))).toBe(true);
  });

  it("classifies IMAGE_GENERATION_TOOL_START as display", () => {
    expect(isDisplayPacket(pkt(0, PacketType.IMAGE_GENERATION_TOOL_START))).toBe(true);
  });

  it("does not classify tool packets as display", () => {
    expect(isDisplayPacket(pkt(0, PacketType.CUSTOM_TOOL_START, { tool_name: "a" }))).toBe(false);
  });

  it("does not classify MESSAGE_DELTA as display", () => {
    expect(isDisplayPacket(pkt(0, PacketType.MESSAGE_DELTA, { content: "" }))).toBe(false);
  });
});
