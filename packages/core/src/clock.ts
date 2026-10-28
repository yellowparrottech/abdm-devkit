/** Source of the current time, so workflows and the mock gateway can run on simulated time. */
export interface Clock {
  now(): Date;
}

export const systemClock: Clock = { now: () => new Date() };

/** A clock that only moves when told to; used by tests and the mock gateway. */
export class ManualClock implements Clock {
  #ms: number;

  constructor(start: Date | string = "2026-01-01T00:00:00.000Z") {
    this.#ms = new Date(start).getTime();
  }

  now(): Date {
    return new Date(this.#ms);
  }

  advance(ms: number): void {
    if (ms < 0) throw new RangeError("A clock cannot move backwards");
    this.#ms += ms;
  }
}
