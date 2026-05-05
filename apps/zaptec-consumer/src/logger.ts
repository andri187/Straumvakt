// Structured JSON logging — one line per log event so Fly's log
// drain can parse them. Keep it dead simple; any third-party logger
// is overkill for a single Node process.

export interface LogFields {
  [key: string]: unknown;
}

function emit(level: string, message: string, fields: LogFields = {}): void {
  const line = JSON.stringify({
    t: new Date().toISOString(),
    level,
    msg: message,
    ...fields,
  });
  // stdout for normal, stderr for warn/error so Fly distinguishes
  // them in the dashboard tail.
  if (level === "error" || level === "warn") {
    process.stderr.write(line + "\n");
  } else {
    process.stdout.write(line + "\n");
  }
}

export const log = {
  info: (msg: string, fields?: LogFields) => emit("info", msg, fields),
  warn: (msg: string, fields?: LogFields) => emit("warn", msg, fields),
  error: (msg: string, fields?: LogFields) => emit("error", msg, fields),
  debug: (msg: string, fields?: LogFields) => emit("debug", msg, fields),
};
