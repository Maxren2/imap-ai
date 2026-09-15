"use client";

import { Area, AreaChart, CartesianGrid, XAxis, YAxis } from "recharts";
import { ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig } from "@/components/ui/chart";
import type { VolumeDay } from "./queries";

const config = {
  received: { label: "Received", color: "hsl(var(--chart-1))" },
  sent: { label: "Sent", color: "hsl(var(--chart-2))" },
} satisfies ChartConfig;

export function VolumeChart({ data }: { data: VolumeDay[] }) {
  return (
    <ChartContainer config={config} className="aspect-auto h-64 w-full">
      <AreaChart data={data} margin={{ left: 4, right: 4 }}>
        <CartesianGrid vertical={false} />
        <XAxis
          dataKey="day"
          tickLine={false}
          axisLine={false}
          tickMargin={8}
          minTickGap={32}
          tickFormatter={(value: string) => new Date(value).toLocaleDateString(undefined, { month: "short", day: "numeric" })}
        />
        <YAxis tickLine={false} axisLine={false} tickMargin={8} width={32} />
        <ChartTooltip
          content={
            <ChartTooltipContent
              labelFormatter={(value: string) => new Date(value).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })}
            />
          }
        />
        <Area dataKey="received" type="monotone" fill="var(--color-received)" fillOpacity={0.25} stroke="var(--color-received)" stackId="a" />
        <Area dataKey="sent" type="monotone" fill="var(--color-sent)" fillOpacity={0.25} stroke="var(--color-sent)" stackId="a" />
      </AreaChart>
    </ChartContainer>
  );
}
