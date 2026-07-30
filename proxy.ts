import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import { isInternalReviewAuthorized } from "./src/internal/auth";

export function proxy(request: NextRequest) {
  if (isInternalReviewAuthorized(request.headers)) {
    return NextResponse.next();
  }

  return new NextResponse("Authentication required.", {
    status: 401,
    headers: {
      "cache-control": "no-store",
      "www-authenticate": 'Basic realm="BuzzRouter Review"',
    },
  });
}

export const config = {
  matcher: "/internal/discovery/:path*",
};
