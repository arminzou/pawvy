import type { HookHandler } from "../../src/hooks/hooks.js";

const handler: HookHandler = async (event) => {
  // Get webhook URL from environment
  const webhookUrl = process.env.PAWVY_WEBHOOK_URL;
  if (!webhookUrl) {
    console.log("[pawvy-pulse] PAWVY_WEBHOOK_URL not set, skipping");
    return;
  }

  // Extract agent ID from sessionKey (e.g., "agent:tee:main" -> "tee")
  const sessionKey = event.sessionKey || "";
  const agentMatch = sessionKey.match(/^agent:([^:]+):/);
  const agentId = agentMatch ? agentMatch[1] : "unknown";

  // Build payload based on event type
  const payload: Record<string, unknown> = {
    event: event.action || event.type,
    agentId,
    sessionKey,
    timestamp: event.timestamp.toISOString(),
  };

  // Add extra context based on event type
  if (event.type === "command" && event.context) {
    payload.commandSource = event.context.commandSource;
    payload.senderId = event.context.senderId;
  }

  if (event.type === "message" && event.context) {
    payload.messageFrom = event.context.from;
    payload.messageTo = event.context.to;
    payload.messageContent = event.context.content;
    payload.channel = event.context.channelId;
  }

  if (event.type === "gateway") {
    payload.message = "Gateway started";
  }

  // Send webhook (fire and forget - don't block)
  try {
    const response = await fetch(webhookUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      console.error(
        `[pawvy-pulse] Webhook failed: ${response.status} ${response.statusText}`
      );
    } else {
      console.log(`[pawvy-pulse] Sent ${event.action || event.type} for ${agentId}`);
    }
  } catch (err) {
    console.error(
      "[pawvy-pulse] Webhook error:",
      err instanceof Error ? err.message : String(err)
    );
  }
};

export default handler;
