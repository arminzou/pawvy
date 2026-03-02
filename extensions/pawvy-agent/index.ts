import type { OpenClawPluginApi } from "openclaw/plugin-sdk";

interface AgentState {
  status: "thinking" | "idle" | "offline";
  timeoutHandle?: ReturnType<typeof setTimeout>;
  lastThought?: string;
  turnCount: number;
}

export default function register(api: OpenClawPluginApi) {
  const config = api.pluginConfig as {
    webhookUrl?: string;
    idleTimeoutMs?: number;
  } | undefined;

  const webhookUrl = config?.webhookUrl;
  const idleTimeoutMs = config?.idleTimeoutMs ?? 30000;
  const logger = api.logger;

  // Per-agent state inside register — not module-level — to avoid leaking
  // across any potential re-registrations.
  const agentStates = new Map<string, AgentState>();

  function getOrCreateState(agentId: string): AgentState {
    let state = agentStates.get(agentId);
    if (!state) {
      state = { status: "idle", turnCount: 0 };
      agentStates.set(agentId, state);
    }
    return state;
  }

  function clearIdleTimer(agentId: string) {
    const state = agentStates.get(agentId);
    if (state?.timeoutHandle) {
      clearTimeout(state.timeoutHandle);
      state.timeoutHandle = undefined;
    }
  }

  // Send a status webhook to Pawvy.
  // fireAndForget: skip awaiting (use during shutdown to avoid blocking).
  async function sendStatus(
    agentId: string,
    status: "thinking" | "idle" | "offline",
    {
      fireAndForget = false,
      thought,
      turnCount,
    }: { fireAndForget?: boolean; thought?: string; turnCount?: number } = {},
  ) {
    if (!webhookUrl) return;

    const event =
      status === "thinking" ? "agent:thinking" :
      status === "idle"     ? "agent:idle"     :
                              "agent:offline";

    const effectiveThought =
      thought !== undefined
        ? thought
        : status === "thinking"
          ? "Thinking..."
          : status === "offline"
            ? "Gateway offline"
            : undefined;

    const doFetch = async () => {
      // 3-second hard timeout — before_agent_start is awaited by OpenClaw before
      // the agent runs, so a hanging fetch here delays every agent response.
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 3000);
      try {
        const res = await fetch(webhookUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            event,
            agentId,
            status,
            thought: effectiveThought,
            turnCount,
            timestamp: new Date().toISOString(),
          }),
          signal: controller.signal,
        });
        if (!res.ok) {
          logger.warn(`[pawvy-agent] webhook ${res.status} for ${agentId}:${status}`);
        }
      } catch (err: unknown) {
        if ((err as { name?: string }).name !== "AbortError") {
          logger.warn(`[pawvy-agent] webhook error for ${agentId}: ${(err as Error).message}`);
        }
      } finally {
        clearTimeout(timer);
      }
    };

    if (fireAndForget) {
      void doFetch();
    } else {
      await doFetch();
    }
  }

  function agentIdFrom(ctx: { agentId?: string }): string {
    return ctx.agentId ?? "default";
  }

  function sanitizeToolName(value: unknown): string {
    const raw = String(value ?? "").trim();
    if (!raw) return "tool";
    const cleaned = raw.replace(/[^a-zA-Z0-9_.:/-]/g, " ").replace(/\s+/g, " ").trim();
    return (cleaned || "tool").slice(0, 32);
  }

  function toActionThought(toolName: unknown): string {
    const normalized = sanitizeToolName(toolName);
    const key = normalized.toLowerCase();
    if (!key || key === "tool") return "Running task...";
      if (key.includes("read") || key.includes("view") || key === "cat") return "Reading files...";
    if (
      key.includes("write") ||
      key.includes("edit") ||
      key.includes("apply_patch") ||
      key.includes("patch") ||
      key.includes("replace")
    ) {
        return "Editing code...";
    }
    if (key.includes("rg") || key.includes("grep") || key.includes("search") || key.includes("find")) {
        return "Searching code...";
    }
    if (key.includes("test") || key.includes("vitest") || key.includes("jest") || key.includes("pytest")) {
        return "Running tests...";
    }
    if (key.includes("git")) return "Working with git";
    if (key.includes("exec") || key.includes("shell") || key.includes("bash") || key.includes("sh")) {
        return "Running command...";
    }
      return `Using ${normalized}...`;
  }

  function updateThinkingThought(agentId: string, thought: string, options: { forceEmit?: boolean } = {}) {
    const state = getOrCreateState(agentId);
    if (state.status !== "thinking") {
      state.status = "thinking";
    }
    if (state.lastThought === thought && !options.forceEmit) return;
    state.lastThought = thought;
    void sendStatus(agentId, "thinking", { fireAndForget: true, thought, turnCount: state.turnCount });
  }

  logger.info(`[pawvy-agent] registered · webhookUrl=${webhookUrl ? "(set)" : "(not set)"} · idleTimeoutMs=${idleTimeoutMs}`);

  // Modifying hook — OpenClaw awaits this before the agent runs.
  // Must stay fast: set state, fire webhook with timeout, return.
  api.on("before_agent_start", async (_event, ctx) => {
    const agentId = agentIdFrom(ctx);
    const state = getOrCreateState(agentId);
    clearIdleTimer(agentId);
    const nextThought = "Planning response...";

    // Reset turn count on new user message (assuming before_agent_start means new turn)
    // Actually, OpenClaw might call this multiple times if it's a loop?
    // Usually before_agent_start is once per user request.
    state.turnCount = 1;

    if (state.status === "thinking" && state.lastThought === nextThought) return; // suppress duplicates

    state.status = "thinking";
    state.lastThought = nextThought;
    logger.info(`[pawvy-agent] ${agentId} → thinking (turn 1)`);
    await sendStatus(agentId, "thinking", { thought: nextThought, turnCount: state.turnCount });
  });

  // Modifying hook — runs before every tool execution.
  api.on("before_tool_call", async (event, ctx) => {
    const agentId = agentIdFrom(ctx);
    const state = getOrCreateState(agentId);
    clearIdleTimer(agentId);
    
    // Increment turn count for each tool call
    state.turnCount = (state.turnCount || 0) + 1;
    
    // Emit every tool phase even if thought text repeats, so turnCount stays in sync.
    updateThinkingThought(agentId, toActionThought(event.toolName), { forceEmit: true });
    return undefined;
  });

  // Void hook — update status text on tool failures.
  api.on("after_tool_call", async (event, ctx) => {
    if (!event.error) return;
    const agentId = agentIdFrom(ctx);
    clearIdleTimer(agentId);
    updateThinkingThought(agentId, `Error: ${sanitizeToolName(event.toolName)}`);
  });

  // Void hook — start the idle countdown after the agent finishes.
  api.on("agent_end", async (_event, ctx) => {
    const agentId = agentIdFrom(ctx);
    const state = getOrCreateState(agentId);
    clearIdleTimer(agentId);

    state.timeoutHandle = setTimeout(async () => {
      const current = agentStates.get(agentId);
      if (current?.status === "thinking") {
        current.status = "idle";
        current.timeoutHandle = undefined;
        current.lastThought = undefined;
        // Don't reset turnCount here, so we can see how many turns the last run took?
        // But status is idle, so turnCount display might disappear.
        logger.info(`[pawvy-agent] ${agentId} → idle`);
        await sendStatus(agentId, "idle");
      }
    }, idleTimeoutMs);
  });

  // Void hook — a new session is ready; report idle unless agent is mid-run.
  api.on("session_start", async (_event, ctx) => {
    const agentId = agentIdFrom(ctx);
    const state = getOrCreateState(agentId);
    if (state.status !== "thinking") {
      state.status = "idle";
      state.lastThought = undefined;
      state.turnCount = 0;
      await sendStatus(agentId, "idle");
    }
  });

  // Void hook — gateway came online.
  api.on("gateway_start", async (_event, _ctx) => {
    if (agentStates.size > 0) {
      for (const [agentId, state] of agentStates) {
        clearIdleTimer(agentId);
        state.status = "idle";
        state.lastThought = undefined;
        state.turnCount = 0;
        await sendStatus(agentId, "idle");
      }
    } else {
      // First boot before any agent has run — broadcast to all.
      await sendStatus("*", "idle");
    }
    logger.info("[pawvy-agent] gateway online");
  });

  // Void hook — gateway shutting down. Fire-and-forget: don't hold up shutdown
  // waiting for HTTP responses.
  api.on("gateway_stop", (_event, _ctx) => {
    if (agentStates.size > 0) {
      for (const [agentId, state] of agentStates) {
        clearIdleTimer(agentId);
        state.status = "offline";
        state.lastThought = "Gateway offline";
        state.turnCount = 0;
        void sendStatus(agentId, "offline", { fireAndForget: true });
      }
    } else {
      void sendStatus("*", "offline", { fireAndForget: true });
    }
    logger.info("[pawvy-agent] gateway offline");
  });
}
