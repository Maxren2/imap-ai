"use client";

import { useState, useTransition } from "react";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Loader2, Ban, CheckCircle2, XCircle } from "lucide-react";
import { markNotCold, unmarkNotCold, testColdEmail } from "./actions";
import type { ColdEmailRow, NotColdSender, RecentMessageRow } from "./queries";

type Tab = "cold" | "not-cold" | "test";

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

export function ColdEmailTabs({
  coldEmails,
  notColdSenders,
  recentMessages,
}: {
  coldEmails: ColdEmailRow[];
  notColdSenders: NotColdSender[];
  recentMessages: RecentMessageRow[];
}) {
  const [tab, setTab] = useState<Tab>("cold");
  const [cold, setCold] = useState(coldEmails);
  const [notCold, setNotCold] = useState(notColdSenders);
  const [pendingAddress, setPendingAddress] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function handleMarkNotCold(fromAddress: string | null) {
    if (!fromAddress) return;
    setPendingAddress(fromAddress);
    startTransition(async () => {
      await markNotCold(fromAddress);
      setCold((prev) => prev.filter((row) => row.fromAddress !== fromAddress));
      setNotCold((prev) => [{ senderAddress: fromAddress, markedAtIso: new Date().toISOString() }, ...prev]);
      setPendingAddress(null);
    });
  }

  function handleUndo(senderAddress: string) {
    setPendingAddress(senderAddress);
    startTransition(async () => {
      await unmarkNotCold(senderAddress);
      setNotCold((prev) => prev.filter((row) => row.senderAddress !== senderAddress));
      setPendingAddress(null);
    });
  }

  return (
    <div>
      <Tabs value={tab} onValueChange={(v) => setTab(v as Tab)}>
        <TabsList>
          <TabsTrigger value="cold">Cold Emails ({cold.length})</TabsTrigger>
          <TabsTrigger value="not-cold">Marked Not Cold ({notCold.length})</TabsTrigger>
          <TabsTrigger value="test">Test</TabsTrigger>
        </TabsList>
      </Tabs>

      <div className="mt-4 rounded-lg border">
        {tab === "cold" && (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Sender</TableHead>
                <TableHead>Subject</TableHead>
                <TableHead>Sent</TableHead>
                <TableHead></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {cold.map((row) => (
                <TableRow key={row.messageId}>
                  <TableCell>
                    <div className="font-medium">{row.fromName || row.fromAddress || "Unknown"}</div>
                    <div className="text-xs text-muted-foreground">{row.fromAddress}</div>
                  </TableCell>
                  <TableCell className="max-w-xs truncate text-sm">{row.subject || "(no subject)"}</TableCell>
                  <TableCell className="text-sm text-muted-foreground">{formatDate(row.dateIso)}</TableCell>
                  <TableCell>
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={isPending && pendingAddress === row.fromAddress}
                      onClick={() => handleMarkNotCold(row.fromAddress)}
                    >
                      {isPending && pendingAddress === row.fromAddress ? (
                        <Loader2 className="animate-spin" />
                      ) : (
                        <Ban />
                      )}
                      Mark Not Cold
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
        {tab === "cold" && cold.length === 0 && (
          <p className="px-3 py-8 text-center text-sm text-muted-foreground">
            No cold emails detected yet. Run detection from the Assistant page to check your synced mail.
          </p>
        )}

        {tab === "not-cold" && (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Sender</TableHead>
                <TableHead>Marked</TableHead>
                <TableHead></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {notCold.map((row) => (
                <TableRow key={row.senderAddress}>
                  <TableCell className="font-medium">{row.senderAddress}</TableCell>
                  <TableCell className="text-sm text-muted-foreground">{formatDate(row.markedAtIso)}</TableCell>
                  <TableCell>
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={isPending && pendingAddress === row.senderAddress}
                      onClick={() => handleUndo(row.senderAddress)}
                    >
                      {isPending && pendingAddress === row.senderAddress && <Loader2 className="animate-spin" />}
                      Undo
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
        {tab === "not-cold" && notCold.length === 0 && (
          <p className="px-3 py-8 text-center text-sm text-muted-foreground">
            Nothing here yet -- senders you mark "Not Cold" from the Cold Emails tab show up here.
          </p>
        )}

        {tab === "test" && <TestTab messages={recentMessages} />}
      </div>
    </div>
  );
}

function TestTab({ messages }: { messages: RecentMessageRow[] }) {
  const [results, setResults] = useState<Record<string, boolean>>({});
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function runTest(id: string) {
    setPendingId(id);
    startTransition(async () => {
      const result = await testColdEmail(id);
      setResults((prev) => ({ ...prev, [id]: result.coldEmail }));
      setPendingId(null);
    });
  }

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Sender</TableHead>
          <TableHead>Subject</TableHead>
          <TableHead>Verdict</TableHead>
          <TableHead></TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {messages.map((message) => {
          const result = results[message.id];
          return (
            <TableRow key={message.id}>
              <TableCell>
                <div className="font-medium">{message.fromName || message.fromAddress || "Unknown"}</div>
                <div className="text-xs text-muted-foreground">{message.fromAddress}</div>
              </TableCell>
              <TableCell className="max-w-xs truncate text-sm">{message.subject || "(no subject)"}</TableCell>
              <TableCell>
                {result === undefined ? (
                  <span className="text-xs text-muted-foreground">Not tested</span>
                ) : result ? (
                  <Badge variant="secondary" className="font-normal">
                    <XCircle className="mr-1 h-3 w-3" /> Cold
                  </Badge>
                ) : (
                  <Badge variant="outline" className="font-normal">
                    <CheckCircle2 className="mr-1 h-3 w-3" /> Not cold
                  </Badge>
                )}
              </TableCell>
              <TableCell>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={isPending && pendingId === message.id}
                  onClick={() => runTest(message.id)}
                >
                  {isPending && pendingId === message.id && <Loader2 className="animate-spin" />}
                  Test
                </Button>
              </TableCell>
            </TableRow>
          );
        })}
      </TableBody>
    </Table>
  );
}
