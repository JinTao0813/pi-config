import type { SearchRequest } from "../types.ts";

export type FetchLike = (input: string | URL, init?: RequestInit) => Promise<Response>;

export class ProviderHttpError extends Error {
	readonly status: number;

	constructor(provider: string, status: number) {
		super(`${provider} HTTP ${status}`);
		this.name = "ProviderHttpError";
		this.status = status;
	}
}

export function requestLimit(request: SearchRequest): number {
	return Math.max(1, Math.min(20, Math.floor(request.limit ?? 5)));
}

export function assertRecord(value: unknown, provider: string): Record<string, unknown> {
	if (!value || typeof value !== "object" || Array.isArray(value)) {
		throw new Error(`${provider} malformed response`);
	}
	return value as Record<string, unknown>;
}

export function optionalString(value: unknown): string | null {
	return typeof value === "string" && value.trim() ? value : null;
}

export async function readJson(response: Response, provider: string): Promise<Record<string, unknown>> {
	try {
		return assertRecord(await response.json(), provider);
	} catch (error) {
		if (error instanceof Error && error.message === `${provider} malformed response`) throw error;
		throw new Error(`${provider} malformed response`, { cause: error });
	}
}
