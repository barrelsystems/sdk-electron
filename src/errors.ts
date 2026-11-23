/** Invalid SDK configuration, reported synchronously at initialization. */
export class BarrelConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BarrelConfigError";
  }
}
