"use client";

import { useEffect, useRef, useState } from "react";

/**
 * Renders a message body -- sanitized HTML (with formatting and inline
 * images) when available, plain text otherwise. The HTML is already
 * sanitized server-side (see packages/core/src/body.ts's SANITIZE_OPTIONS
 * -- an allowlist, so script tags, event-handler attributes, iframes, and
 * forms are simply never present), but it's still rendered inside a
 * sandboxed iframe with no script execution allowed, as defense in
 * depth: even a sanitizer bug can't run anything here, since the sandbox
 * disables scripts at the browser level regardless of what's in the
 * markup. Same-origin access is safe to include specifically because
 * scripts stay disabled -- it's only there so this component's onLoad
 * handler can read the iframe's own content height to size itself (a
 * cross-origin srcDoc frame would block that read entirely).
 */
function clampHeight(scrollHeight: number): number {
  return Math.min(Math.max(scrollHeight + 16, 80), 2000);
}

export function EmailBody({ html, text }: { html: string | null; text: string | null }) {
  const [height, setHeight] = useState(200);
  const frameRef = useRef<HTMLIFrameElement>(null);

  // Server-rendered srcDoc content can finish loading (and fire the
  // iframe's native `load` event) before React finishes hydrating and
  // attaches the onLoad handler below -- found live: the handler never
  // ran on first paint, only on a second navigation to the same thread,
  // because the browser had already loaded the srcdoc from the initial
  // static HTML before hydration wired up any listener. This effect
  // covers that case by measuring immediately if the document is already
  // complete by the time it runs; onLoad still covers the normal case
  // (client-side navigation, where hydration is already done before the
  // iframe starts loading).
  useEffect(() => {
    const frame = frameRef.current;
    if (!frame || !html) return;
    try {
      if (frame.contentDocument?.readyState === "complete") {
        const scrollHeight = frame.contentDocument.body?.scrollHeight;
        if (scrollHeight) setHeight(clampHeight(scrollHeight));
      }
    } catch {
      // Cross-origin or otherwise unreadable -- keep the fallback height.
    }
  }, [html]);

  if (!html) {
    return <div className="mt-3 whitespace-pre-wrap text-sm">{text ?? "(no body synced yet)"}</div>;
  }

  const doc = `<!DOCTYPE html><html><head><meta name="color-scheme" content="light dark"><base target="_blank"><style>
    body { margin: 0; padding: 0; font-family: ui-sans-serif, system-ui, sans-serif; font-size: 14px; color: #111; word-wrap: break-word; overflow-wrap: break-word; }
    img { max-width: 100%; height: auto; }
    a { color: #2563eb; }
    @media (prefers-color-scheme: dark) { body { color: #e5e5e5; } a { color: #60a5fa; } }
  </style></head><body>${html}</body></html>`;

  return (
    <iframe
      ref={frameRef}
      title="Message body"
      srcDoc={doc}
      sandbox="allow-same-origin allow-popups allow-popups-to-escape-sandbox"
      className="mt-3 w-full rounded-md border-0"
      style={{ height }}
      onLoad={(e) => {
        try {
          const scrollHeight = e.currentTarget.contentDocument?.body?.scrollHeight;
          if (scrollHeight) setHeight(clampHeight(scrollHeight));
        } catch {
          // Cross-origin or otherwise unreadable -- keep the fallback height.
        }
      }}
    />
  );
}
