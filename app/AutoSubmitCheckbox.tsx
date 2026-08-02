"use client";

/**
 * A checkbox that submits its associated GET form the moment it is toggled, so a
 * filter needs no separate Apply step — the checkbox counterpart to
 * {@link AutoSubmitSelect}. Associated by `form` id (the directory's GET form
 * lives elsewhere on the page); `event.currentTarget.form` resolves it. Without
 * JavaScript the checkbox still posts with the form's own submit path.
 */
export function AutoSubmitCheckbox({
  defaultChecked,
  form,
  name,
  value,
}: {
  defaultChecked?: boolean;
  form?: string;
  name: string;
  value: string;
}) {
  return (
    <input
      defaultChecked={defaultChecked}
      form={form}
      name={name}
      onChange={(event) => event.currentTarget.form?.requestSubmit()}
      type="checkbox"
      value={value}
    />
  );
}
