import type { EvidenceMcpServer } from "./EvidenceMcpServer.js";
import type { MalbolgeService } from "../application/malbolge/MalbolgeService.js";
import type { EvidenceWriter } from "../application/investigation/InvestigationRecordPort.js";
import { toolContract } from "../contracts/toolContracts.js";
import type { Logger } from "pino";
import type { WithAdmittedAnalysis } from "./analysisAdmission.js";
import { createEvidenceToolHandler } from "./contractToolHandler.js";
import { toolRegistrationOptions } from "./toolRegistrationOptions.js";

/** Bind the Malbolge contracts to their shared workflow and Evidence ledger. */
export const registerMalbolgeTools = (
  server: EvidenceMcpServer,
  service: MalbolgeService,
  logger: Logger,
  recordEvidence?: EvidenceWriter["recordEvidence"],
  withAdmittedAnalysis?: WithAdmittedAnalysis,
): void => {
  const inspectHandler = createEvidenceToolHandler(
    server,
    (input, options) => service.inspect(input, options),
    logger,
    recordEvidence,
    withAdmittedAnalysis,
  );
  const inspectContract = toolContract("inspect_malbolge");
  server.registerTool(
    inspectContract.name,
    toolRegistrationOptions(inspectContract),
    inspectHandler(inspectContract),
  );

  const traceHandler = createEvidenceToolHandler(
    server,
    (input, options) => service.trace(input, options),
    logger,
    recordEvidence,
    withAdmittedAnalysis,
  );
  const traceContract = toolContract("trace_malbolge");
  server.registerTool(
    traceContract.name,
    toolRegistrationOptions(traceContract),
    traceHandler(traceContract),
  );

  const decompileHandler = createEvidenceToolHandler(
    server,
    (input, options) => service.decompile(input, options),
    logger,
    recordEvidence,
    withAdmittedAnalysis,
  );
  const decompileContract = toolContract("decompile_malbolge");
  server.registerTool(
    decompileContract.name,
    toolRegistrationOptions(decompileContract),
    decompileHandler(decompileContract),
  );
};
