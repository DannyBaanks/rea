import { inventoryArtifact } from "../artifacts/inventory/ArtifactInventory.js";
import { serveArtifactInventoryWorker } from "../artifacts/inventory/ArtifactInventoryWorkerServer.js";

await serveArtifactInventoryWorker(inventoryArtifact).catch(
  (cause: unknown) => {
    const message = cause instanceof Error ? cause.message : String(cause);
    process.stderr.write(`${message}\n`);
    process.exitCode = 1;
  },
);
