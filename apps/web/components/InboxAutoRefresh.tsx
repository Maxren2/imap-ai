"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { getInboxFingerprint } from "@/app/mail-actions";

const POLL_MS = 20_000;

/**
 * Renders nothing -- just polls for new/changed inbox mail and refreshes
 * the page when something's actually different, so mail that `watch`
 * pulls in while the Inbox is already open shows up on its own instead
 * of needing a manual reload. `BackgroundRunsPanel` already covers "a
 * button I clicked just finished" (refresh on a run's own state
 * transition); this covers the other case -- mail arriving with nothing
 * on this page having triggered it at all, since `watch` runs
 * independently of any button click (see the Dockerfile's background
 * watch loop).
 *
 * Deliberately a cheap poll, not a websocket/SSE push -- this app has no
 * existing push-notification infrastructure, and 20s of latency for "new
 * mail shows up without a manual reload" is a reasonable trade against
 * adding one just for this.
 */
export function InboxAutoRefresh({ fingerprint }: { fingerprint: string }) {
  const router = useRouter();
  const lastRef = useRef(fingerprint);

  useEffect(() => {
    lastRef.current = fingerprint;
  }, [fingerprint]);

  useEffect(() => {
    const timer = setInterval(async () => {
      try {
        const next = await getInboxFingerprint();
        if (next !== lastRef.current) {
          lastRef.current = next;
          router.refresh();
        }
      } catch {
        // A transient failure here (e.g. the DB briefly unreachable)
        // just means this tick found nothing new -- the next one tries
        // again, no need to surface it.
      }
    }, POLL_MS);
    return () => clearInterval(timer);
  }, [router]);

  return null;
}
