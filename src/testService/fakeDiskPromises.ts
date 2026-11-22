import { writeFile as nativeWriteFile } from "node:fs/promises";
import { beforeBufferWrite } from "./bufferPersistenceControl.js";

export { mkdir } from "node:fs/promises";

export async function writeFile(path: string, data: string, encoding: "utf8"): Promise<void> {
  await beforeBufferWrite(path);
  await nativeWriteFile(path, data, encoding);
}
