import {
  BadGatewayException,
  Injectable,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';

type Primitive = string | number | boolean;
type MetaQueryParams = Record<string, Primitive | undefined>;

interface MetaErrorPayload {
  error?: {
    code?: number;
    error_subcode?: number;
    message?: string;
    type?: string;
  };
}

interface MetaPagingResponse<T> {
  data: T[];
  paging?: {
    next?: string;
  };
}

function isMetaPagingResponse<T>(
  value: unknown,
): value is MetaPagingResponse<T> {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const payload = value as Record<string, unknown>;
  return Array.isArray(payload.data);
}

@Injectable()
export class MetaGraphClient {
  private readonly logger = new Logger(MetaGraphClient.name);
  private readonly token = process.env.META_ACCESS_TOKEN;
  private readonly apiVersion = process.env.META_GRAPH_API_VERSION ?? 'v21.0';
  private readonly baseUrl = `https://graph.facebook.com/${this.apiVersion}`;
  private readonly maxRetries = Number.parseInt(
    process.env.META_API_RETRY_MAX ?? '3',
    10,
  );

  async getAllPages<T>(path: string, params: MetaQueryParams = {}) {
    const result: T[] = [];
    let nextUrl: string | undefined = this.buildUrl(path, params);

    while (nextUrl) {
      const payload = await this.requestWithRetry<unknown>(nextUrl);
      if (!isMetaPagingResponse<T>(payload)) {
        throw new BadGatewayException(
          'Meta response missing expected data array.',
        );
      }

      result.push(...payload.data);
      nextUrl = payload.paging?.next;
    }

    return result;
  }

  private buildUrl(path: string, params: MetaQueryParams): string {
    const cleanPath = path.startsWith('/') ? path.slice(1) : path;
    const url = new URL(`${this.baseUrl}/${cleanPath}`);

    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined) {
        url.searchParams.set(key, String(value));
      }
    }

    return url.toString();
  }

  private async requestWithRetry<T>(url: string): Promise<T> {
    let attempt = 0;

    while (attempt <= this.maxRetries) {
      const response = await fetch(url, {
        headers: {
          Authorization: `Bearer ${this.getToken()}`,
        },
      });

      if (response.ok) {
        return (await response.json()) as T;
      }

      const errorPayload = (await this.safeJson(response)) as MetaErrorPayload;
      const metaCode = errorPayload.error?.code;

      if (
        this.shouldRetry(response.status, metaCode) &&
        attempt < this.maxRetries
      ) {
        const waitMs = this.backoffDelayMs(attempt);
        this.logger.warn(
          `Meta API rate-limited (status=${response.status}, code=${metaCode}), retrying in ${waitMs}ms`,
        );
        await this.sleep(waitMs);
        attempt += 1;
        continue;
      }

      const message =
        errorPayload.error?.message ??
        `Meta request failed with status ${response.status}`;

      throw new BadGatewayException({
        message,
        status: response.status,
        metaCode,
      });
    }

    throw new BadGatewayException('Meta request failed after retries.');
  }

  private shouldRetry(status: number, metaCode?: number): boolean {
    const retryableCodes = new Set([4, 17, 613]);
    return (
      status === 429 || (metaCode !== undefined && retryableCodes.has(metaCode))
    );
  }

  private backoffDelayMs(attempt: number): number {
    const base = 500 * 2 ** attempt;
    const jitter = Math.floor(Math.random() * 250);
    return base + jitter;
  }

  private sleep(ms: number) {
    return new Promise((resolve) => {
      setTimeout(resolve, ms);
    });
  }

  private async safeJson(response: Response): Promise<unknown> {
    try {
      return await response.json();
    } catch {
      return {};
    }
  }

  private getToken(): string {
    if (!this.token) {
      throw new InternalServerErrorException(
        'META_ACCESS_TOKEN is required for Meta API calls.',
      );
    }

    return this.token;
  }
}
