import { useEffect, useMemo, useState } from "react";
import {
  getResponseTemplateSurface,
  type Message,
  type MessageContentStructured,
} from "../lib/api";
import { SurfaceMessage } from "./messages/SurfaceMessage";

/** Placeholder ids for the message-like row the renderer needs. The
 *  conversation is not one the chat store holds, so completion stamps feed
 *  the processor directly instead of persisting anywhere. */
const PREVIEW_CONVERSATION_ID = "response-template-preview";
const PREVIEW_SENDER_ID = "response-template-preview";

/**
 * A response template rendered exactly as it lands in chat: the backend
 * compiles the template's sample data into an A2UI Surface
 * (`GET /api/response-templates/:id/surface`) and the real `SurfaceMessage`
 * renderer draws it. A skeleton holds the space while the surface loads;
 * a failed fetch renders nothing.
 */
export function TemplateSurfacePreview({ templateId }: { templateId: string }) {
  const [surface, setSurface] = useState<MessageContentStructured | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setSurface(null);
    setFailed(false);
    getResponseTemplateSurface(templateId)
      .then(({ surface: next }) => {
        if (!cancelled) setSurface(next);
      })
      .catch((e) => {
        console.warn("[templates] surface preview failed", templateId, e);
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, [templateId]);

  const message = useMemo<Message | null>(() => {
    if (!surface) return null;
    const now = new Date().toISOString();
    return {
      id: `response-template:${templateId}`,
      conversationId: PREVIEW_CONVERSATION_ID,
      senderId: PREVIEW_SENDER_ID,
      messageType: "Surface",
      contentType: "structured",
      contentStructured: surface,
      content: "",
      insertedAt: now,
      updatedAt: now,
    };
  }, [surface, templateId]);

  if (failed) return null;
  if (!message) {
    return <div className="h-28 w-full rounded-xl bg-muted/40 animate-pulse" aria-hidden />;
  }
  return <SurfaceMessage message={message} />;
}
