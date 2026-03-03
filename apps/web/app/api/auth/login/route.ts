import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';

const AUTH_COOKIE = 'adbuffs_internal_auth';

export async function POST(request: Request) {
  const formData = await request.formData();
  const email = String(formData.get('email') ?? '').trim().toLowerCase();
  const token = String(formData.get('token') ?? '');

  const configuredToken = process.env.INTERNAL_AUTH_BYPASS_TOKEN;

  if (!configuredToken) {
    return NextResponse.redirect(new URL('/login?error=1', request.url));
  }

  const isAllowedEmail = email.endsWith('@adbuffs.com');
  const isAllowedToken = token === configuredToken;

  if (!isAllowedEmail || !isAllowedToken) {
    return NextResponse.redirect(new URL('/login?error=1', request.url));
  }

  const cookieStore = await cookies();
  cookieStore.set(AUTH_COOKIE, '1', {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: 60 * 60 * 12,
  });

  return NextResponse.redirect(new URL('/dashboard', request.url));
}
