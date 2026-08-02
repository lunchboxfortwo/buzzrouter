"use client";

import type { ReactNode } from "react";

import { useRouter, useSearchParams } from "next/navigation";

/**
 * A filter select that updates the URL via a client-side (soft) navigation as
 * soon as a choice is made — no full page reload, so scroll position and other
 * client state survive. It stays a real form control so the no-JS "Apply" button
 * still submits it, and its value is driven by the URL, keeping it in sync
 * across back/forward.
 */
export function AutoSubmitSelect({
  children,
  form,
  name,
}: {
  children: ReactNode;
  form?: string;
  name: string;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();

  return (
    <select
      form={form}
      name={name}
      onChange={(event) => {
        const params = new URLSearchParams(searchParams);
        const value = event.currentTarget.value;
        if (value) params.set(name, value);
        else params.delete(name);
        const qs = params.toString();
        router.replace(qs ? `?${qs}` : "?", { scroll: false });
      }}
      value={searchParams.get(name) ?? ""}
    >
      {children}
    </select>
  );
}
