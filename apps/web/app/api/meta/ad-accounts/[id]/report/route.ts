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
    const since = url.searchParams.get('since');
    const until = url.searchParams.get('until');

    const upstream = new URL(
      `${getApiBaseUrl()}/v1/meta/ad-accounts/${encodeURIComponent(id)}/report`,
    );

    if (since) {
      upstream.searchParams.set('since', since);
    }

    if (until) {
      upstream.searchParams.set('until', until);
    }

    const response = await fetch(upstream.toString(), {
      cache: 'no-store',
    });

    const body = await response.json();
    return NextResponse.json(body, { status: response.status });
  } catch (error) {
    return NextResponse.json(
      {
        message: 'Failed to load report from API.',
        error: error instanceof Error ? error.message : 'unknown',
      },
      { status: 500 },
    );
  }
}
