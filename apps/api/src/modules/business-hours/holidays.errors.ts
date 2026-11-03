import { HolidayInPastError, HolidayOverlapError } from '@gani/db';

// The answers of /v1/workspaces/{id}/holidays to the refusals of the store (CEO 02/11/2026). Messages are fixed sentences: no user data.

/** 422: the range shares a date with another day off of the workspace. */
export class HolidayOverlapHttpError extends Error {
  readonly status = 422;
  readonly code = 'holiday_overlap';
  constructor() {
    super('The day off overlaps another one of the workspace.');
    this.name = 'HolidayOverlapHttpError';
  }
}

/** 422: the day off ends before today in the workspace's time zone, so it is history (SLA, C8) and stays as it is. */
export class HolidayInPastHttpError extends Error {
  readonly status = 422;
  readonly code = 'holiday_in_past';
  constructor() {
    super('The day off is over.');
    this.name = 'HolidayInPastHttpError';
  }
}

/** The HTTP error of a refusal of the store; anything else as it is. */
export function holidayHttpErrorOf(error: unknown): unknown {
  if (error instanceof HolidayOverlapError) return new HolidayOverlapHttpError();
  if (error instanceof HolidayInPastError) return new HolidayInPastHttpError();
  return error;
}
