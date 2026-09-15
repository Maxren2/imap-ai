"use client";

import { Bar, BarChart, CartesianGrid, XAxis, YAxis } from "recharts";
import { ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig } from "@/components/ui/chart";
import type { RuleStatRow } from "./queries";

const config = {
  matchCount: { label: "Matches", color: "hsl(var(--chart-4))" },
} satisfies ChartConfig;

export function RuleStatsChart({ rules }: { rules: RuleStatRow[] }) {
  return (
    <ChartContainer config={config} className="aspect-auto w-full" style={{ height: Math.max(rules.length * 36, 160) }}>
      <BarChart data={rules} layout="vertical" margin={{ left: 4, right: 12 }}>
        <CartesianGrid horizontal={false} />
        <XAxis type="number" tickLine={false} axisLine={false} allowDecimals={false} />
        <YAxis type="category" dataKey="name" tickLine={false} axisLine={false} width={140} />
        <ChartTooltip content={<ChartTooltipContent hideLabel />} />
        <Bar dataKey="matchCount" fill="var(--color-matchCount)" radius={4} />
      </BarChart>
    </ChartContainer>
  );
}
