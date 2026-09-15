"use client";

import { Bar, BarChart, CartesianGrid, XAxis, YAxis } from "recharts";
import { ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig } from "@/components/ui/chart";
import type { TopSenderRow } from "./queries";

const config = {
  count: { label: "Messages", color: "hsl(var(--chart-1))" },
} satisfies ChartConfig;

export function TopSendersChart({ senders }: { senders: TopSenderRow[] }) {
  const data = senders.map((s) => ({ ...s, label: s.fromName || s.fromAddress }));

  return (
    <ChartContainer config={config} className="aspect-auto w-full" style={{ height: Math.max(data.length * 32, 160) }}>
      <BarChart data={data} layout="vertical" margin={{ left: 4, right: 12 }}>
        <CartesianGrid horizontal={false} />
        <XAxis type="number" tickLine={false} axisLine={false} />
        <YAxis
          type="category"
          dataKey="label"
          tickLine={false}
          axisLine={false}
          width={140}
          tickFormatter={(value: string) => (value.length > 20 ? `${value.slice(0, 20)}…` : value)}
        />
        <ChartTooltip content={<ChartTooltipContent hideLabel />} />
        <Bar dataKey="count" fill="var(--color-count)" radius={4} />
      </BarChart>
    </ChartContainer>
  );
}
