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
    const upstream = new URL(
      `${getApiBaseUrl()}/v1/meta/ad-accounts/${encodeURIComponent(id)}/creative-fatigue`,
    );
    const projectId = url.searchParams.get('projectId');
    const product = url.searchParams.get('product');
    if (projectId) {
      upstream.searchParams.set('projectId', projectId);
    }
    if (product) {
      upstream.searchParams.set('product', product);
    }

    const response = await fetch(upstream.toString(), { cache: 'no-store' });
    const body = await response.json();
    return NextResponse.json(body, { status: response.status });
  } catch (error) {
    return NextResponse.json(
      {
        message: 'Failed to load creative fatigue from API.',
        error: error instanceof Error ? error.message : 'unknown',
      },
      { status: 500 },
    );
  }
}
