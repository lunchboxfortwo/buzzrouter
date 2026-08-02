"use client";

import type { ReactNode } from "react";

/**
 * Submits its associated GET form as soon as a choice is made, so filtering
 * needs no separate Apply step. The form may be an ancestor or associated by
 * `form` id (`event.currentTarget.form` resolves either) — the directory uses
 * the id form since its GET form lives elsewhere on the page. Without
 * JavaScript the select still posts with the form's own submit path, so the
 * control never becomes inert.
 */
export function AutoSubmitSelect({
  children,
  defaultValue,
  form,
  name,
}: {
  children: ReactNode;
  defaultValue: string;
  form?: string;
  name: string;
}) {
  return (
    <select
      defaultValue={defaultValue}
      form={form}
      name={name}
      onChange={(event) => event.currentTarget.form?.requestSubmit()}
    >
      {children}
    </select>
  );
}
