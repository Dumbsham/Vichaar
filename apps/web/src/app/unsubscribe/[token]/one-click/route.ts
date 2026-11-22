import { NextResponse } from 'next/server';
import { z } from 'zod';

export async function POST(_request: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  if (
    !z
      .string()
      .regex(/^[A-Za-z0-9._-]{1,2048}$/)
      .safeParse(token).success
  )
    return new NextResponse(null, { status: 400 });
  try {
    const origin = new URL(process.env.API_ORIGIN || 'http://127.0.0.1:4000').origin;
    const response = await fetch(
      `${origin}/subscriptions/unsubscribe/${encodeURIComponent(token)}`,
      {
        method: 'POST',
        cache: 'no-store',
        signal: AbortSignal.timeout(5000),
      },
    );
    return new NextResponse(null, { status: response.status });
  } catch {
    return new NextResponse(null, { status: 503 });
  }
}

export async function GET(request: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  return NextResponse.redirect(new URL(`/unsubscribe/${encodeURIComponent(token)}`, request.url));
}
