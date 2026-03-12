import { NextResponse } from 'next/server';

function getApiBaseUrl() {
  const apiBaseUrl = process.env.API_BASE_URL;
  if (!apiBaseUrl) {
    throw new Error('API_BASE_URL is required');
  }

  return apiBaseUrl;
}

export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await context.params;
    const url = new URL(request.url);
    const accountId = url.searchParams.get('accountId');
    const upstream = new URL(
      `${getApiBaseUrl()}/v1/projects/${encodeURIComponent(id)}/tags`,
    );
    if (accountId) {
      upstream.searchParams.set('accountId', accountId);
    }
    const response = await fetch(upstream.toString(), {
      cache: 'no-store',
    });
    const body = await response.json();
    return NextResponse.json(body, { status: response.status });
  } catch (error) {
    return NextResponse.json(
      {
        message: 'Failed to load tags from API.',
        error: error instanceof Error ? error.message : 'unknown',
      },
      { status: 500 },
    );
  }
}

export async function PUT(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await context.params;
    const payload = await request.json();
    const response = await fetch(
      `${getApiBaseUrl()}/v1/projects/${encodeURIComponent(id)}/tags`,
      {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        cache: 'no-store',
      },
    );
    const body = await response.json();
    return NextResponse.json(body, { status: response.status });
  } catch (error) {
    return NextResponse.json(
      {
        message: 'Failed to update tag in API.',
        error: error instanceof Error ? error.message : 'unknown',
      },
      { status: 500 },
    );
  }
}
