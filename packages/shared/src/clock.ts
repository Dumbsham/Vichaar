export interface Clock {
  now(): Date;
  isoNow(): string;
  epochMs(): number;
}

export class SystemClock implements Clock {
  now(): Date {
    return new Date();
  }

  isoNow(): string {
    return new Date().toISOString();
  }

  epochMs(): number {
    return Date.now();
  }
}

export class FakeClock implements Clock {
  private currentTime: Date;

  constructor(initialTime: Date | string = new Date()) {
    this.currentTime = typeof initialTime === 'string' ? new Date(initialTime) : new Date(initialTime.getTime());
  }

  now(): Date {
    return new Date(this.currentTime.getTime());
  }

  isoNow(): string {
    return this.currentTime.toISOString();
  }

  epochMs(): number {
    return this.currentTime.getTime();
  }

  setTime(time: Date | string): void {
    this.currentTime = typeof time === 'string' ? new Date(time) : new Date(time.getTime());
  }

  advance(ms: number): void {
    this.currentTime = new Date(this.currentTime.getTime() + ms);
  }

  advanceSeconds(seconds: number): void {
    this.advance(seconds * 1000);
  }

  advanceMinutes(minutes: number): void {
    this.advance(minutes * 60 * 1000);
  }

  advanceDays(days: number): void {
    this.advance(days * 24 * 60 * 60 * 1000);
  }
}
