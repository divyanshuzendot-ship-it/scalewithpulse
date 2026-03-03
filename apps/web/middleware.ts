import { NextRequest, NextResponse } from 'next/server';

const AUTH_COOKIE = 'adbuffs_internal_auth';

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const isProtectedRoute =
    pathname.startsWith('/dashboard') || pathname.startsWith('/api/meta');

  if (!isProtectedRoute) {
    return NextResponse.next();
  }

  const isAuthenticated = request.cookies.get(AUTH_COOKIE)?.value === '1';
  if (isAuthenticated) {
    return NextResponse.next();
  }

  const loginUrl = new URL('/login', request.url);
  return NextResponse.redirect(loginUrl);
}

export const config = {
  matcher: ['/dashboard/:path*', '/api/meta/:path*'],
};
