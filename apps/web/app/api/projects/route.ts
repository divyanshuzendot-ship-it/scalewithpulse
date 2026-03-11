import { NextResponse } from 'next/server';

function getApiBaseUrl() {
  const apiBaseUrl = process.env.API_BASE_URL;
  if (!apiBaseUrl) {
    throw new Error('API_BASE_URL is required');
  }

  return apiBaseUrl;
}

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const adAccountId = url.searchParams.get('adAccountId');
    const upstream = new URL(`${getApiBaseUrl()}/v1/projects`);
    if (adAccountId) {
      upstream.searchParams.set('adAccountId', adAccountId);
    }

    const response = await fetch(upstream.toString(), { cache: 'no-store' });
    const body = await response.json();
    return NextResponse.json(body, { status: response.status });
  } catch (error) {
    return NextResponse.json(
      {
        message: 'Failed to load projects from API.',
        error: error instanceof Error ? error.message : 'unknown',
      },
      { status: 500 },
    );
  }
}

export async function POST(request: Request) {
  try {
    const payload = await request.json();
    const response = await fetch(`${getApiBaseUrl()}/v1/projects`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      cache: 'no-store',
    });
    const body = await response.json();
    return NextResponse.json(body, { status: response.status });
  } catch (error) {
    return NextResponse.json(
      {
        message: 'Failed to create project from API.',
        error: error instanceof Error ? error.message : 'unknown',
      },
      { status: 500 },
    );
  }
}
