import type { AdapterCommand, CreateAdapterRequest } from "@barrel-kit/sdk-conformance-harness";
import { command, initialize } from "./runtime.js";

process.on("message", (message: { id: number; payload: AdapterCommand }) => {
  void command(message.payload).then(
    (result) => process.send?.({ id: message.id, result }),
    (error: unknown) => process.send?.({ id: message.id, error: String(error) }),
  );
});

const config = JSON.parse(process.env["BARREL_TEST_CONFIG"] ?? "null") as CreateAdapterRequest;
void initialize(config).catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});

process.on("disconnect", () => process.exit(0));
