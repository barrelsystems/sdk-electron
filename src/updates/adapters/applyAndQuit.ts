import type { UpdateState } from "../models/state.js";

/** The native call may exit immediately, so its applying check-in
 * must settle first. */
export async function applyAndQuit(
  setState: (state: UpdateState) => Promise<void>,
  nativeQuitAndInstall: () => void,
): Promise<void> {
  await setState({ type: "applying" });
  nativeQuitAndInstall();
}
