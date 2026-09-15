"use client";

import { cn } from "@/lib/utils";
import { createElement, type ComponentProps, memo } from "react";
import { Streamdown } from "streamdown";

type ResponseProps = ComponentProps<typeof Streamdown>;

// Not available from the AI Elements registry at the time this was built
// (registry.ai-sdk.dev/response.json 404s) -- replicated directly from
// inbox-zero's own copy (components/ai-elements/response.tsx), which is
// itself just a thin styled wrapper around `streamdown`.
export const Response = memo(
  ({ className, ...props }: ResponseProps) =>
    createElement(Streamdown, {
      className: cn(
        "size-full [&>*:first-child]:mt-0 [&>*:last-child]:mb-0",
        "[&_a]:!text-inherit [&_a]:underline [&_a]:underline-offset-2 [&_a:hover]:opacity-80",
        className,
      ),
      ...props,
    }),
  (prevProps, nextProps) => prevProps.children === nextProps.children,
);

Response.displayName = "Response";
