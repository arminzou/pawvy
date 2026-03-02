import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock the hooks.js import - we only need the type
vi.mock("../../src/hooks/hooks.js", () => ({
  default: {},
}));

// Mock fetch
global.fetch = vi.fn();

// Import after mocks
import handler from "./handler.js";

function createMockEvent(
  type: string,
  action: string,
  sessionKey: string,
  context?: Record<string, unknown>
) {
  return {
    type,
    action,
    sessionKey,
    timestamp: new Date("2026-02-19T12:00:00Z"),
    messages: [] as string[],
    context: context || {},
  };
}

function parseBody(fetchCall: unknown[]): Record<string, unknown> {
  const options = fetchCall[1] as { body: string };
  return JSON.parse(options.body);
}

describe("pawvy-pulse", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.PAWVY_WEBHOOK_URL;
  });

  it("should skip if PAWVY_WEBHOOK_URL is not set", async () => {
    const event = createMockEvent("command", "new", "agent:tee:main");

    await handler(event);

    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("should send webhook on command:new", async () => {
    process.env.PAWVY_WEBHOOK_URL = "http://localhost:3001/api/webhook/pawvy";
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      status: 200,
    });

    const event = createMockEvent("command", "new", "agent:tee:main", {
      commandSource: "telegram",
      senderId: "user123",
    });

    await handler(event);

    expect(global.fetch).toHaveBeenCalledWith(
      "http://localhost:3001/api/webhook/pawvy",
      expect.objectContaining({
        method: "POST",
        headers: { "Content-Type": "application/json" },
      })
    );

    const body = parseBody((global.fetch as ReturnType<typeof vi.fn>).mock.calls[0]);
    expect(body.event).toBe("new");
    expect(body.agentId).toBe("tee");
    expect(body.sessionKey).toBe("agent:tee:main");
    expect(body.commandSource).toBe("telegram");
    expect(body.senderId).toBe("user123");
  });

  it("should send webhook on command:reset", async () => {
    process.env.PAWVY_WEBHOOK_URL = "http://localhost:3001/api/webhook/pawvy";
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      status: 200,
    });

    const event = createMockEvent("command", "reset", "agent:fay:main");

    await handler(event);

    const body = parseBody((global.fetch as ReturnType<typeof vi.fn>).mock.calls[0]);
    expect(body.event).toBe("reset");
    expect(body.agentId).toBe("fay");
  });

  it("should send webhook on gateway:startup", async () => {
    process.env.PAWVY_WEBHOOK_URL = "http://localhost:3001/api/webhook/pawvy";
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      status: 200,
    });

    const event = createMockEvent("gateway", "startup", "");

    await handler(event);

    const body = parseBody((global.fetch as ReturnType<typeof vi.fn>).mock.calls[0]);
    expect(body.event).toBe("startup");
    expect(body.agentId).toBe("unknown");
    expect(body.message).toBe("Gateway started");
  });

  it("should handle fetch errors gracefully", async () => {
    process.env.PAWVY_WEBHOOK_URL = "http://localhost:3001/api/webhook/pawvy";
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: false,
      status: 500,
      statusText: "Internal Server Error",
    });

    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const event = createMockEvent("command", "new", "agent:tee:main");

    await handler(event);

    expect(consoleSpy).toHaveBeenCalled();
    // Just check that it was called (format may vary)
    expect(consoleSpy.mock.calls[0][0]).toContain("[pawvy-pulse]");
    expect(consoleSpy.mock.calls[0][0]).toContain("Webhook failed");

    consoleSpy.mockRestore();
  });

  it("should handle network errors gracefully", async () => {
    process.env.PAWVY_WEBHOOK_URL = "http://localhost:3001/api/webhook/pawvy";
    (global.fetch as ReturnType<typeof vi.fn>).mockRejectedValue(new Error("Network error"));

    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const event = createMockEvent("command", "new", "agent:tee:main");

    await handler(event);

    expect(consoleSpy).toHaveBeenCalled();
    expect(consoleSpy.mock.calls[0][0]).toContain("[pawvy-pulse]");
    expect(consoleSpy.mock.calls[0][0]).toContain("Webhook error");

    consoleSpy.mockRestore();
  });

  it("should extract agentId from sessionKey correctly", async () => {
    process.env.PAWVY_WEBHOOK_URL = "http://localhost:3001/api/webhook/pawvy";
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      status: 200,
    });

    const testCases = [
      { sessionKey: "agent:tee:main", expected: "tee" },
      { sessionKey: "agent:fay:subagent:abc", expected: "fay" },
      { sessionKey: "agent:docky:main", expected: "docky" },
      { sessionKey: "", expected: "unknown" },
    ];

    for (const { sessionKey, expected } of testCases) {
      vi.clearAllMocks();
      const event = createMockEvent("command", "new", sessionKey);
      await handler(event);

      const body = parseBody((global.fetch as ReturnType<typeof vi.fn>).mock.calls[0]);
      expect(body.agentId).toBe(expected);
    }
  });

  it("should send webhook on message:received", async () => {
    process.env.PAWVY_WEBHOOK_URL = "http://localhost:3001/api/webhook/pawvy";
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      status: 200,
    });

    const event = createMockEvent("message", "received", "agent:tee:main", {
      from: "user123",
      to: "tee",
      content: "Hello!",
      channelId: "telegram",
    });

    await handler(event);

    const body = parseBody((global.fetch as ReturnType<typeof vi.fn>).mock.calls[0]);
    expect(body.event).toBe("received");
    expect(body.agentId).toBe("tee");
    expect(body.messageFrom).toBe("user123");
    expect(body.messageTo).toBe("tee");
    expect(body.messageContent).toBe("Hello!");
    expect(body.channel).toBe("telegram");
  });

  it("should send webhook on message:sent", async () => {
    process.env.PAWVY_WEBHOOK_URL = "http://localhost:3001/api/webhook/pawvy";
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      status: 200,
    });

    const event = createMockEvent("message", "sent", "agent:fay:main", {
      from: "fay",
      to: "user123",
      content: "Hi there!",
      channelId: "discord",
    });

    await handler(event);

    const body = parseBody((global.fetch as ReturnType<typeof vi.fn>).mock.calls[0]);
    expect(body.event).toBe("sent");
    expect(body.agentId).toBe("fay");
    expect(body.messageFrom).toBe("fay");
    expect(body.messageTo).toBe("user123");
    expect(body.messageContent).toBe("Hi there!");
    expect(body.channel).toBe("discord");
  });
});
