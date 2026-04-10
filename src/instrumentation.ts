import { createOnRequestError } from "@axiomhq/nextjs";
import { axiomLogger } from "@/lib/axiom/server";
import { initConsoleAxiomBridge } from "@/lib/logger";

export async function register() {
  initConsoleAxiomBridge();
}

export const onRequestError = axiomLogger
  ? createOnRequestError(axiomLogger)
  : undefined;
