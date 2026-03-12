import { NextResponse } from 'next/server';

function getApiBaseUrl() {
  const apiBaseUrl = process.env.API_BASE_URL;
  if (!apiBaseUrl) {
    throw new Error('API_BASE_URL is required');
  }

  return apiBaseUrl;
}

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await context.params;
    const response = await fetch(
      `${getApiBaseUrl()}/v1/projects/${encodeURIComponent(id)}/products`,
      {
        cache: 'no-store',
      },
    );
    const body = await response.json();
    return NextResponse.json(body, { status: response.status });
  } catch (error) {
    return NextResponse.json(
      {
        message: 'Failed to load products from API.',
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
      `${getApiBaseUrl()}/v1/projects/${encodeURIComponent(id)}/products`,
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
        message: 'Failed to update products in API.',
        error: error instanceof Error ? error.message : 'unknown',
      },
      { status: 500 },
    );
  }
}
