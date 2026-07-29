export async function runWithTimeout<T>(
	parentSignal: AbortSignal | undefined,
	timeoutMs: number,
	operation: (signal: AbortSignal) => Promise<T>,
): Promise<T> {
	const controller = new AbortController();
	const forwardAbort = () => controller.abort(parentSignal?.reason);
	if (parentSignal?.aborted) forwardAbort();
	else parentSignal?.addEventListener("abort", forwardAbort, { once: true });

	const timer = setTimeout(() => {
		controller.abort(new DOMException(`Timed out after ${timeoutMs}ms`, "TimeoutError"));
	}, timeoutMs);

	try {
		return await operation(controller.signal);
	} finally {
		clearTimeout(timer);
		parentSignal?.removeEventListener("abort", forwardAbort);
	}
}
