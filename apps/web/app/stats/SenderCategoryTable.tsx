"use client";

import { useState, useTransition } from "react";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { setSenderCategory } from "./actions";
import { SENDER_CATEGORIES, type SenderCategory } from "@/lib/analytics/categorize-sender";
import type { SenderCategoryRow } from "./queries";

/**
 * Hand-correction UI for the heuristic categorizer's guesses -- pairs with
 * the Sender categories chart above it. Each row's Select shows the
 * *effective* category (override if the user's set one, else the
 * heuristic's guess) and saves on change via a plain server action, no
 * confirm step needed since this is trivially reversible (re-pick anytime).
 */
export function SenderCategoryTable({ rows }: { rows: SenderCategoryRow[] }) {
  const [localRows, setLocalRows] = useState(rows);
  const [isPending, startTransition] = useTransition();

  function handleChange(fromAddress: string, category: SenderCategory) {
    setLocalRows((prev) => prev.map((row) => (row.fromAddress === fromAddress ? { ...row, category, isOverridden: true } : row)));
    startTransition(async () => {
      await setSenderCategory(fromAddress, category);
    });
  }

  if (localRows.length === 0) {
    return <p className="py-8 text-center text-sm text-muted-foreground">No senders yet.</p>;
  }

  return (
    <div className="rounded-lg border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Sender</TableHead>
            <TableHead>Messages</TableHead>
            <TableHead>Category</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {localRows.map((row) => (
            <TableRow key={row.fromAddress}>
              <TableCell className="max-w-64 truncate">{row.fromName || row.fromAddress}</TableCell>
              <TableCell>{row.messageCount.toLocaleString("en-US")}</TableCell>
              <TableCell>
                <div className="flex items-center gap-2">
                  <Select
                    value={row.category}
                    disabled={isPending}
                    onValueChange={(value) => handleChange(row.fromAddress, value as SenderCategory)}
                  >
                    <SelectTrigger className="w-36">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {SENDER_CATEGORIES.map((category) => (
                        <SelectItem key={category} value={category}>
                          {category}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {row.isOverridden && (
                    <Badge variant="secondary" className="font-normal">
                      Corrected
                    </Badge>
                  )}
                </div>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
