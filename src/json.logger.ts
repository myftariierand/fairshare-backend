import { LoggerService } from '@nestjs/common';

type Level = 'error' | 'warn' | 'info' | 'debug' | 'verbose' | 'fatal';

const serialize = (value: unknown) =>
  value instanceof Error
    ? { name: value.name, message: value.message, stack: value.stack }
    : value;

// One JSON object per line, so the hosting platform's log search can filter on the fields
export class JsonLogger implements LoggerService {
  log(message: unknown, ...params: unknown[]) {
    this.write('info', message, params);
  }

  error(message: unknown, ...params: unknown[]) {
    this.write('error', message, params);
  }

  warn(message: unknown, ...params: unknown[]) {
    this.write('warn', message, params);
  }

  debug(message: unknown, ...params: unknown[]) {
    this.write('debug', message, params);
  }

  verbose(message: unknown, ...params: unknown[]) {
    this.write('verbose', message, params);
  }

  fatal(message: unknown, ...params: unknown[]) {
    this.write('fatal', message, params);
  }

  private write(level: Level, message: unknown, params: unknown[]) {
    // Nest always adds the context last, when the logger has one
    const rest = [...params];
    const context =
      typeof rest[rest.length - 1] === 'string' ? rest.pop() : undefined;
    const details = rest.filter((param) => param != null).map(serialize);

    const line = {
      level,
      time: new Date().toISOString(),
      context,
      message:
        message instanceof Error
          ? message.message
          : typeof message === 'string'
            ? message
            : JSON.stringify(message),
      ...(message instanceof Error && { stack: message.stack }),
      ...(details.length > 0 && { details }),
    };

    const output =
      level === 'error' || level === 'fatal' ? process.stderr : process.stdout;

    try {
      output.write(`${JSON.stringify(line)}\n`);
    } catch {
      // Details that can't be written, such as a circular object, shouldn't lose the message
      output.write(
        `${JSON.stringify({ level, time: line.time, context, message: line.message })}\n`,
      );
    }
  }
}
