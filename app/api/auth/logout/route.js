import { clearSessionCookie } from "@/lib/session";

export async function GET() {
  return new Response(null, {
    status: 302,
    headers: { Location: `${process.env.SITE_URL}/`, "Set-Cookie": clearSessionCookie() },
  });
}
