"use client";

import type { ReactNode } from "react";

/**
 * Submits the enclosing GET form as soon as a choice is made, so filtering
 * needs no separate Apply step. Without JavaScript the select still posts
 * with the form's own submit path, so the control never becomes inert.
 */
export function AutoSubmitSelect({
  children,
  defaultValue,
  name,
}: {
  children: ReactNode;
  defaultValue: string;
  name: string;
}) {
  return (
    <select
      defaultValue={defaultValue}
      name={name}
      onChange={(event) => event.currentTarget.form?.requestSubmit()}
    >
      {children}
    </select>
  );
}
