import { ImageResponse } from "next/og";

import { getDatabasePool } from "../../../src/db/pool";
import { getCommunityByHost } from "../../../src/db/directory";
import { focusLabel } from "../../../src/ranking/focus";

export const runtime = "nodejs";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";
export const alt = "Buzz community on BuzzRouter";

function monogram(name: string): string {
  const first = [...name.trim()].find((c) => /\p{L}|\p{N}/u.test(c));
  return (first ?? "B").toUpperCase();
}

export default async function Image({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const slug = (await params).slug;
  const community = await getCommunityByHost(
    getDatabasePool(),
    decodeURIComponent(slug),
  );

  const name = community?.displayName ?? "Buzz community";
  const uptime =
    community && community.probesTotal > 0
      ? `${Math.round((community.probesSuccessful / community.probesTotal) * 100)}%`
      : "—";
  const open = Boolean(community?.publicUrl);
  const focus = community?.focus ? focusLabel(community.focus) : null;

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          padding: "64px 72px",
          background: "#0f1020",
          backgroundImage:
            "radial-gradient(700px 500px at 12% 55%, rgba(86,87,242,0.42), transparent 62%)",
          color: "#fff",
          fontFamily: "sans-serif",
        }}
      >
        <div style={{ display: "flex", alignItems: "center" }}>
          <div
            style={{
              width: 40,
              height: 40,
              borderRadius: 20,
              background: "#fff",
              color: "#0f1020",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: 22,
              fontWeight: 800,
            }}
          >
            B
          </div>
          <div style={{ fontSize: 26, fontWeight: 700, marginLeft: 14 }}>
            BuzzRouter
          </div>
          <div
            style={{
              marginLeft: "auto",
              display: "flex",
              alignItems: "center",
              color: "#e8f7f1",
              fontSize: 21,
              fontWeight: 600,
            }}
          >
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#e8f7f1" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" style={{ marginRight: 10 }}>
              <circle cx="12" cy="12" r="9" />
              <path d="m8.5 12 2.4 2.4 4.6-5" />
            </svg>
            <div>Checked directly at the relay</div>
          </div>
        </div>

        <div
          style={{
            marginTop: "auto",
            display: "flex",
            alignItems: "center",
          }}
        >
          <div
            style={{
              width: 150,
              height: 150,
              borderRadius: 34,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: 80,
              fontWeight: 800,
              color: "#fff",
              background: "#5657f2",
            }}
          >
            {monogram(name)}
          </div>
          <div style={{ display: "flex", flexDirection: "column", marginLeft: 34 }}>
            <div style={{ fontSize: 82, fontWeight: 800, letterSpacing: "-3px", lineHeight: 1 }}>
              {name}
            </div>
            <div style={{ display: "flex", marginTop: 22 }}>
              {focus ? (
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    height: 46,
                    padding: "0 22px",
                    borderRadius: 999,
                    background: "rgba(255,255,255,0.13)",
                    fontSize: 23,
                    fontWeight: 640,
                  }}
                >
                  {focus}
                </div>
              ) : null}
              {open ? (
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    height: 46,
                    padding: "0 22px",
                    marginLeft: 14,
                    borderRadius: 999,
                    background: "rgba(8,124,91,0.28)",
                    color: "#e8f7f1",
                    fontSize: 23,
                    fontWeight: 640,
                  }}
                >
                  Open to join
                </div>
              ) : null}
            </div>
          </div>
        </div>

        <div
          style={{
            marginTop: 44,
            paddingTop: 30,
            borderTop: "1px solid rgba(255,255,255,0.14)",
            display: "flex",
            alignItems: "center",
          }}
        >
          <div style={{ display: "flex", alignItems: "baseline", marginRight: 44 }}>
            <div style={{ fontSize: 40, fontWeight: 760 }}>{uptime}</div>
            <div style={{ fontSize: 20, color: "rgba(255,255,255,0.6)", marginLeft: 10 }}>
              uptime · 30d
            </div>
          </div>
          <div style={{ display: "flex", alignItems: "baseline", marginRight: 44 }}>
            <div style={{ fontSize: 40, fontWeight: 760 }}>Live</div>
            <div style={{ fontSize: 20, color: "rgba(255,255,255,0.6)", marginLeft: 10 }}>
              checked directly
            </div>
          </div>
          <div style={{ display: "flex", alignItems: "baseline" }}>
            <div style={{ fontSize: 40, fontWeight: 760 }}>
              3
            </div>
            <div style={{ fontSize: 20, color: "rgba(255,255,255,0.6)", marginLeft: 10 }}>
              sources
            </div>
          </div>
        </div>
      </div>
    ),
    size,
  );
}
