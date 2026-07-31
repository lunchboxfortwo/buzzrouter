"use client";

import { type MouseEvent, useCallback } from "react";

import styles from "./create-community.module.css";
import { BUZZ_RELEASES_URL, type DesktopArch, resolveDownloadUrl } from "./download-assets";
import type { DesktopPlatform } from "./platform";

interface Option {
  arch: DesktopArch;
  hint?: string;
  label: string;
  platform: Exclude<DesktopPlatform, "unknown">;
}

const OPTIONS: Record<Exclude<DesktopPlatform, "unknown">, Option[]> = {
  linux: [{ arch: "x64", label: "Download for Linux (.AppImage)", platform: "linux" }],
  macos: [
    {
      arch: "arm64",
      hint: "2021 or later, or a late-2020 Mac with Apple M1",
      label: "Apple Silicon Mac (.dmg)",
      platform: "macos",
    },
    {
      arch: "x64",
      hint: "2019 or earlier, or a 2020 Mac with an Intel processor",
      label: "Intel Mac (.dmg)",
      platform: "macos",
    },
  ],
  windows: [{ arch: "x64", label: "Download for Windows (.exe)", platform: "windows" }],
};

function DownloadLink({ arch, hint, label, platform }: Option) {
  const handleClick = useCallback(
    (event: MouseEvent<HTMLAnchorElement>) => {
      event.preventDefault();
      void resolveDownloadUrl(platform, arch).then((url) => {
        window.open(url, "_blank", "noopener,noreferrer");
      });
    },
    [arch, platform],
  );

  return (
    <a className={styles.downloadOption} href={BUZZ_RELEASES_URL} onClick={handleClick}>
      <span className={styles.downloadLabel}>{label}</span>
      {hint ? <span className={styles.downloadHint}>{hint}</span> : null}
    </a>
  );
}

export function DownloadCta({ platform }: { platform: DesktopPlatform }) {
  const groups = platform === "unknown" ? Object.values(OPTIONS).flat() : OPTIONS[platform];

  return (
    <div className={styles.downloadOptions}>
      {groups.map((option) => (
        <DownloadLink key={`${option.platform}-${option.arch}`} {...option} />
      ))}
    </div>
  );
}
