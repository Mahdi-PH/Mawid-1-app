/** تسجيل بسيط منظّم / minimal structured logger (no extra dependency). */
type Level = 'debug' | 'info' | 'warn' | 'error';

const order: Record<Level, number> = { debug: 10, info: 20, warn: 30, error: 40 };
const minimum: Level = process.env.LOG_LEVEL === 'debug' ? 'debug' : 'info';

function emit(level: Level, scope: string, message: string, extra?: Record<string, unknown>): void {
  if (order[level] < order[minimum]) return;
  const line = {
    t: new Date().toISOString(),
    level,
    scope,
    msg: message,
    ...(extra ?? {}),
  };
  const text = JSON.stringify(line);
  if (level === 'error') console.error(text);
  else if (level === 'warn') console.warn(text);
  else console.log(text);
}

export function createLogger(scope: string) {
  return {
    debug: (msg: string, extra?: Record<string, unknown>) => emit('debug', scope, msg, extra),
    info: (msg: string, extra?: Record<string, unknown>) => emit('info', scope, msg, extra),
    warn: (msg: string, extra?: Record<string, unknown>) => emit('warn', scope, msg, extra),
    error: (msg: string, extra?: Record<string, unknown>) => emit('error', scope, msg, extra),
  };
}

export type Logger = ReturnType<typeof createLogger>;
