import axios from 'axios';

const ATTEMPT_MS = 8000;
const PAUSE_MS = 1000;

export function isAbortError(err: unknown): boolean {
    if (!err || typeof err !== 'object') return false;
    const e = err as { name?: string; code?: string };
    return (
        e.name === 'AbortError'
        || e.name === 'CanceledError'
        || e.code === 'ERR_CANCELED'
        || e.code === 'ECONNABORTED'
    );
}

function sleep(ms: number, signal: AbortSignal): Promise<void> {
    return new Promise((resolve, reject) => {
        if (signal.aborted) {
            reject(Object.assign(new Error('Aborted'), { name: 'AbortError', code: 'ERR_CANCELED' }));
            return;
        }
        const timer = window.setTimeout(resolve, ms);
        const onAbort = () => {
            window.clearTimeout(timer);
            reject(Object.assign(new Error('Aborted'), { name: 'AbortError', code: 'ERR_CANCELED' }));
        };
        signal.addEventListener('abort', onAbort, { once: true });
    });
}

export async function runWithTimeoutRetry<T>(
    task: (signal: AbortSignal) => Promise<T>,
    userSignal: AbortSignal,
    attemptMs = ATTEMPT_MS,
    pauseMs = PAUSE_MS,
): Promise<T> {
    const attempt = async (): Promise<T> => {
        const inner = new AbortController();
        const onOuterAbort = () => inner.abort();
        if (userSignal.aborted) {
            inner.abort();
        } else {
            userSignal.addEventListener('abort', onOuterAbort);
        }
        const timer = window.setTimeout(() => inner.abort(), attemptMs);
        try {
            return await task(inner.signal);
        } finally {
            window.clearTimeout(timer);
            userSignal.removeEventListener('abort', onOuterAbort);
        }
    };

    try {
        return await attempt();
    } catch (err) {
        if (userSignal.aborted) throw err;
        if (axios.isAxiosError(err) && err.response) throw err;
        await sleep(pauseMs, userSignal);
        return await attempt();
    }
}
