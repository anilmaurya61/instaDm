import { NextResponse, type NextRequest } from "next/server";
import { getToken } from "next-auth/jwt";

// Keep this list in sync with the directories under app/(dashboard). Routes
// not listed here are not gated at the edge and must do their own auth.
const PROTECTED_PREFIXES = [
  "/dashboard",
  "/automations",
  "/campaigns",
  "/diagnostics",
  "/inbox",
  "/logs",
  "/overview",
  "/settings",
];

export async function proxy(request: NextRequest) {
  const pathname = request.nextUrl.pathname;
  const isProtected = PROTECTED_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`)
  );
  const isLogin = pathname === "/login";

  // With the JWT session strategy the session cookie carries the token, so we
  // can verify it cryptographically at the edge (HMAC signature check) instead
  // of just checking for cookie presence — expired or tampered tokens redirect
  // here rather than rendering the shell and bouncing in the layout.
  //
  // getToken() defaults to `secureCookie: false`, i.e. it only looks for the
  // unprefixed `authjs.session-token`. But on HTTPS the Auth.js server sets
  // `__Secure-authjs.session-token` (the salt is the cookie name itself), so
  // without this flag the edge check sees no cookie and bounces every signed-in
  // user back to /login. Mirror the server's own rule exactly — it derives
  // useSecureCookies from the request URL's protocol (init.ts:
  // useSecureCookies ?? url.protocol === "https:"), but next-auth first
  // rewrites that URL's origin to AUTH_URL/NEXTAUTH_URL when set
  // (next-auth/lib/env.js reqWithEnvURL). So with an https NEXTAUTH_URL the
  // server uses `__Secure-` cookies even on http://localhost. Reading a
  // different cookie name here means signOut clears one cookie while this
  // check reads another (e.g. a stale unprefixed one) and logout looks broken.
  const envUrl = process.env.AUTH_URL ?? process.env.NEXTAUTH_URL;
  const secureCookie =
    (envUrl ? new URL(envUrl).protocol : request.nextUrl.protocol) ===
    "https:";
  const token = await getToken({
    req: request,
    secret: process.env.NEXTAUTH_SECRET,
    secureCookie,
  });
  const isAuthenticated = Boolean(token);

  if (isProtected && !isAuthenticated) {
    const loginUrl = new URL("/login", request.url);
    loginUrl.searchParams.set("callbackUrl", pathname);
    return NextResponse.redirect(loginUrl);
  }

  if (isLogin && isAuthenticated) {
    return NextResponse.redirect(new URL("/dashboard", request.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    "/dashboard/:path*",
    "/automations/:path*",
    "/campaigns/:path*",
    "/diagnostics/:path*",
    "/inbox/:path*",
    "/logs/:path*",
    "/overview/:path*",
    "/settings/:path*",
    "/login",
  ],
};
