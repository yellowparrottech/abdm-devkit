import { err, ok, type DateRange, type HiType, type Result } from "@yellowparrottech/abdm-core";
import { consentStateAt } from "./state-machine.js";
import type { ConsentArtefact, ConsentTransaction } from "./types.js";

/** A request to fetch records under a granted consent artefact. */
export interface HealthInfoRequest {
  hiuId: string;
  artefactId: string;
  hiTypes: HiType[];
  dateRange: DateRange;
}

export type PolicyDenial =
  | { code: "consent_not_granted"; state: string }
  | { code: "consent_expired" }
  | { code: "unknown_artefact"; artefactId: string }
  | { code: "wrong_requester" }
  | { code: "hi_type_not_consented"; hiTypes: HiType[] }
  | { code: "date_range_outside_consent" };

/** Decide whether a health-information request falls inside what the patient granted. */
export function checkHealthInfoRequest(tx: ConsentTransaction, req: HealthInfoRequest, now: Date): Result<ConsentArtefact, PolicyDenial> {
  const state = consentStateAt(tx, now);
  if (state === "expired") return err({ code: "consent_expired" });
  if (state !== "granted") return err({ code: "consent_not_granted", state });

  const artefact = tx.artefacts.find((a) => a.id === req.artefactId);
  if (!artefact) return err({ code: "unknown_artefact", artefactId: req.artefactId });
  if (!(Date.parse(artefact.expiresAt) > now.getTime())) return err({ code: "consent_expired" });
  if (artefact.hiuId !== req.hiuId) return err({ code: "wrong_requester" });

  const notConsented = req.hiTypes.filter((t) => !artefact.hiTypes.includes(t));
  if (notConsented.length > 0) return err({ code: "hi_type_not_consented", hiTypes: notConsented });

  const inside =
    Date.parse(req.dateRange.from) >= Date.parse(artefact.dateRange.from) && Date.parse(req.dateRange.to) <= Date.parse(artefact.dateRange.to);
  if (!inside) return err({ code: "date_range_outside_consent" });

  return ok(artefact);
}
