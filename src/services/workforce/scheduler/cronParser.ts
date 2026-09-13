export class CronParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CronParseError';
  }
}

export interface CronField {
  min: number;
  max: number;
  values: ReadonlySet<number>;
}

export interface CronExpression {
  minute: CronField;
  hour: CronField;
  dayOfMonth: CronField;
  month: CronField;
  dayOfWeek: CronField;
  raw: string;
}

const FIELD_BOUNDS: Array<{ name: string; min: number; max: number }> = [
  { name: 'minute', min: 0, max: 59 },
  { name: 'hour', min: 0, max: 23 },
  { name: 'day-of-month', min: 1, max: 31 },
  { name: 'month', min: 1, max: 12 },
  { name: 'day-of-week', min: 0, max: 6 }
];

function expandRange(start: number, end: number, step: number): number[] {
  const values: number[] = [];
  for (let v = start; v <= end; v += step) {
    values.push(v);
  }
  return values;
}

function parseSingleField(token: string, min: number, max: number, fieldName: string): number[] {
  if (token.length === 0) {
    throw new CronParseError(`Empty cron ${fieldName} field`);
  }

  if (token.includes(',')) {
    const parts = token.split(',');
    const values: number[] = [];
    for (const part of parts) {
      values.push(...parseSingleField(part, min, max, fieldName));
    }
    return values;
  }

  const slashIndex = token.indexOf('/');
  let base = token;
  let step = 1;
  if (slashIndex !== -1) {
    base = token.slice(0, slashIndex);
    const stepStr = token.slice(slashIndex + 1);
    if (!/^\d+$/.test(stepStr)) {
      throw new CronParseError(`Invalid step '${stepStr}' in cron ${fieldName} field '${token}'`);
    }
    step = parseInt(stepStr, 10);
    if (step < 1) {
      throw new CronParseError(`Step must be >= 1 in cron ${fieldName} field '${token}'`);
    }
  }

  let values: number[];
  if (base === '*') {
    values = expandRange(min, max, step);
  } else if (/^\d+$/.test(base)) {
    const single = parseInt(base, 10);
    if (slashIndex === -1) {
      values = [single];
    } else {
      values = expandRange(single, max, step);
    }
  } else if (/^\d+-\d+$/.test(base)) {
    const [start, end] = base.split('-').map(s => parseInt(s, 10));
    if (end < start) {
      throw new CronParseError(`Invalid range '${base}' in cron ${fieldName} field '${token}' (end < start)`);
    }
    values = expandRange(start, end, step);
  } else {
    throw new CronParseError(`Unsupported cron ${fieldName} token '${token}'`);
  }

  for (const v of values) {
    if (v < min || v > max) {
      throw new CronParseError(
        `Value ${v} out of range [${min}, ${max}] in cron ${fieldName} field '${token}'`
      );
    }
  }
  return values;
}

function isUnsupportedSyntax(token: string): boolean {
  return /[LWh]/i.test(token) || token.includes('7-7') || /^\d+#/.test(token);
}

export function parseCronField(token: string, fieldName: string, min: number, max: number): CronField {
  if (isUnsupportedSyntax(token)) {
    throw new CronParseError(
      `Cron ${fieldName} field '${token}' uses unsupported syntax (L, W, #, or named values are not supported)`
    );
  }
  return { min, max, values: new Set(parseSingleField(token, min, max, fieldName)) };
}

export function parseCron(expression: string): CronExpression {
  if (typeof expression !== 'string' || expression.trim().length === 0) {
    throw new CronParseError('Cron expression must be a non-empty string');
  }

  const tokens = expression.trim().split(/\s+/);
  if (tokens.length !== 5) {
    throw new CronParseError(
      `Cron expression must have exactly 5 fields (minute hour day-of-month month day-of-week), got ${tokens.length}: '${expression}'`
    );
  }

  const [minute, hour, dom, month, dow] = tokens;
  const [mBound, hBound, dBound, monBound, wBound] = FIELD_BOUNDS;

  return {
    minute: parseCronField(minute, mBound.name, mBound.min, mBound.max),
    hour: parseCronField(hour, hBound.name, hBound.min, hBound.max),
    dayOfMonth: parseCronField(dom, dBound.name, dBound.min, dBound.max),
    month: parseCronField(month, monBound.name, monBound.min, monBound.max),
    dayOfWeek: parseCronField(dow, wBound.name, wBound.min, wBound.max),
    raw: expression.trim()
  };
}

/**
 * Deterministic match against host local time. Day-of-month and day-of-week
 * are AND-ed (both must match when both are restricted) for unambiguous,
 * testable behavior.
 */
export function matchesCron(expression: CronExpression, date: Date): boolean {
  if (!expression.minute.values.has(date.getMinutes())) { return false; }
  if (!expression.hour.values.has(date.getHours())) { return false; }
  if (!expression.month.values.has(date.getMonth() + 1)) { return false; }
  if (!expression.dayOfMonth.values.has(date.getDate())) { return false; }
  if (!expression.dayOfWeek.values.has(date.getDay())) { return false; }
  return true;
}

export function isWildcard(field: CronField): boolean {
  return field.values.size === field.max - field.min + 1;
}