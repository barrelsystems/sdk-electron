interface Window {
  updates: {
    subscribe(
      listener: (
        status: import("@barrel-kit/sdk-electron").Updates.Status,
      ) => void,
    ): Promise<() => void>;
    apply(): Promise<void>;
  };
}
