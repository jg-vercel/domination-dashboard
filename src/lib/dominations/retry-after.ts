const HTTP_DATE_PATTERN = /^(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun), \d{2} (?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) \d{4} \d{2}:\d{2}:\d{2} GMT$/;
const RFC850_PATTERN = /^(Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday), (\d{2})-(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)-(\d{2}) (\d{2}:\d{2}:\d{2}) GMT$/;
const ASCTIME_PATTERN = /^(Mon|Tue|Wed|Thu|Fri|Sat|Sun) (Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) ( \d|\d{2}) (\d{2}:\d{2}:\d{2}) (\d{4})$/;

export function parseRetryAfterMs(
  header: string | null,
  nowMs = Date.now(),
): number | undefined {
  if (header === null) return undefined;
  let value = header.trim();
  if (/^\d+$/.test(value)) {
    // Preserve an enormous valid delay as a value beyond any request budget;
    // treating overflow as a missing header could cause an early retry.
    return Math.min(Number(value) * 1_000, Number.MAX_SAFE_INTEGER);
  }
  if (!Number.isFinite(nowMs)) return undefined;
  // HTTP recipients also accept the two obsolete HTTP-date formats. Convert
  // to IMF-fixdate first so parsing is always UTC, even on a non-UTC machine.
  const rfc850 = RFC850_PATTERN.exec(value);
  const asctime = ASCTIME_PATTERN.exec(value);
  if (rfc850) {
    const [, weekday, day, month, shortYear, time] = rfc850;
    let year = Math.floor(new Date(nowMs).getUTCFullYear() / 100) * 100 + Number(shortYear);
    const fiftyYearsLater = new Date(nowMs);
    fiftyYearsLater.setUTCFullYear(fiftyYearsLater.getUTCFullYear() + 50);
    if (Date.parse(`${day} ${month} ${year} ${time} GMT`) > fiftyYearsLater.getTime()) year -= 100;
    value = `${weekday!.slice(0, 3)}, ${day} ${month} ${year} ${time} GMT`;
  } else if (asctime) {
    const [, weekday, month, day, time, year] = asctime;
    value = `${weekday}, ${String(Number(day)).padStart(2, "0")} ${month} ${year} ${time} GMT`;
  }
  if (!HTTP_DATE_PATTERN.test(value)) return undefined;
  const retryAt = Date.parse(value);
  if (!Number.isFinite(retryAt) || new Date(retryAt).toUTCString() !== value) {
    return undefined;
  }
  return Math.min(Math.max(0, Math.ceil(retryAt - nowMs)), Number.MAX_SAFE_INTEGER);
}
