/** Thrown synchronously by `init()`, and only by `init()` — every later failure fails open instead. */
export class BarrelConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BarrelConfigError";
  }
}
