"use client";

import { Bar, BarChart, CartesianGrid, XAxis, YAxis } from "recharts";
import { ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig } from "@/components/ui/chart";
import type { CategoryBreakdownRow } from "./queries";

const config = {
  senderCount: { label: "Senders", color: "hsl(var(--chart-3))" },
} satisfies ChartConfig;

export function CategoryChart({ rows }: { rows: CategoryBreakdownRow[] }) {
  return (
    <ChartContainer config={config} className="aspect-auto h-56 w-full">
      <BarChart data={rows} layout="vertical" margin={{ left: 4, right: 12 }}>
        <CartesianGrid horizontal={false} />
        <XAxis type="number" tickLine={false} axisLine={false} />
        <YAxis type="category" dataKey="category" tickLine={false} axisLine={false} width={90} />
        <ChartTooltip
          content={
            <ChartTooltipContent
              hideLabel
              formatter={(value, _name, item) => (
                <span>
                  {String(value)} senders, {item.payload.messageCount.toLocaleString()} messages
                </span>
              )}
            />
          }
        />
        <Bar dataKey="senderCount" fill="var(--color-senderCount)" radius={4} />
      </BarChart>
    </ChartContainer>
  );
}
