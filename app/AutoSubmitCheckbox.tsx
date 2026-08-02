"use client";

import { useRouter, useSearchParams } from "next/navigation";

/**
 * A filter checkbox that updates the URL via a client-side (soft) navigation the
 * moment it is toggled — no full page reload, so scroll position and other
 * client state (e.g. the mobile "Search options" collapsible) survive. It stays
 * a real form control so the no-JS "Apply" button still submits it, and its
 * checked state is driven by the URL, keeping it in sync across back/forward.
 */
export function AutoSubmitCheckbox({
  form,
  name,
  value,
}: {
  form?: string;
  name: string;
  value: string;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();

  return (
    <input
      checked={searchParams.get(name) === value}
      form={form}
      name={name}
      onChange={(event) => {
        const params = new URLSearchParams(searchParams);
        if (event.currentTarget.checked) params.set(name, value);
        else params.delete(name);
        const qs = params.toString();
        router.replace(qs ? `?${qs}` : "?", { scroll: false });
      }}
      type="checkbox"
      value={value}
    />
  );
}
