import { HI_TYPE_PROFILES, HI_TYPES, NRCES_PROFILE_BASE, type HiType } from "@yellowparrottech/abdm-core";

export interface ValidationIssue {
  severity: "error" | "warning";
  /** FHIRPath-style location, such as `Bundle.entry[0].resource.subject`. */
  path: string;
  message: string;
}

export interface ValidationReport {
  valid: boolean;
  /** HI type implied by the Composition's NRCeS profile, when recognised. */
  hiType?: HiType;
  issues: ValidationIssue[];
}

type Json = Record<string, unknown>;
const isObject = (v: unknown): v is Json => typeof v === "object" && v !== null && !Array.isArray(v);
const isDateTime = (v: unknown) => typeof v === "string" && /^\d{4}-\d{2}-\d{2}/.test(v) && !Number.isNaN(Date.parse(v));
const COMPOSITION_STATUSES = ["preliminary", "final", "amended", "entered-in-error"];
const PROFILE_TO_HI_TYPE = new Map(HI_TYPES.map((t) => [`${NRCES_PROFILE_BASE}${HI_TYPE_PROFILES[t]}`, t]));

/**
 * Structural checks for an ABDM FHIR document bundle: bundle shape, a Composition declaring an NRCeS
 * record profile, and references that resolve inside the bundle. This is not full profile validation;
 * run the HL7 FHIR validator with the NRCeS IG for that.
 */
export function validateDocumentBundle(bundle: unknown): ValidationReport {
  const issues: ValidationIssue[] = [];
  const error = (path: string, message: string) => issues.push({ severity: "error", path, message });
  const warn = (path: string, message: string) => issues.push({ severity: "warning", path, message });

  if (!isObject(bundle) || bundle.resourceType !== "Bundle") {
    error("Bundle", "Not a FHIR Bundle");
    return { valid: false, issues };
  }
  if (bundle.type !== "document") error("Bundle.type", "Must be 'document'");
  if (!isDateTime(bundle.timestamp)) error("Bundle.timestamp", "Must be a date-time");
  const metaProfiles = isObject(bundle.meta) && Array.isArray(bundle.meta.profile) ? bundle.meta.profile : [];
  if (!metaProfiles.includes(`${NRCES_PROFILE_BASE}DocumentBundle`)) warn("Bundle.meta.profile", "Does not declare the NRCeS DocumentBundle profile");

  const entries = Array.isArray(bundle.entry) ? bundle.entry : [];
  if (entries.length === 0) {
    error("Bundle.entry", "A document needs at least a Composition");
    return { valid: false, issues };
  }

  // Index entries by fullUrl and by Type/id so references can be resolved.
  const byReference = new Map<string, Json>();
  entries.forEach((entry, i) => {
    const path = `Bundle.entry[${i}]`;
    if (!isObject(entry) || !isObject(entry.resource) || typeof entry.resource.resourceType !== "string") {
      error(path, "Entry must contain a resource with a resourceType");
      return;
    }
    if (typeof entry.fullUrl !== "string") error(`${path}.fullUrl`, "Missing fullUrl");
    else if (byReference.has(entry.fullUrl)) error(`${path}.fullUrl`, `Duplicate fullUrl ${entry.fullUrl}`);
    else byReference.set(entry.fullUrl, entry.resource);
    if (typeof entry.resource.id === "string") byReference.set(`${entry.resource.resourceType}/${entry.resource.id}`, entry.resource);
  });

  const first = entries[0];
  const composition = isObject(first) && isObject(first.resource) ? first.resource : undefined;
  if (composition?.resourceType !== "Composition") {
    error("Bundle.entry[0].resource", "The first entry must be a Composition");
    return { valid: false, issues };
  }

  const cPath = "Bundle.entry[0].resource";
  const profiles = isObject(composition.meta) && Array.isArray(composition.meta.profile) ? composition.meta.profile : [];
  const hiType = profiles.map((p) => PROFILE_TO_HI_TYPE.get(String(p))).find((t) => t !== undefined);
  if (!hiType) error(`${cPath}.meta.profile`, "Does not declare an NRCeS ABDM record profile");
  if (!COMPOSITION_STATUSES.includes(String(composition.status))) error(`${cPath}.status`, `Must be one of ${COMPOSITION_STATUSES.join(", ")}`);
  if (!isDateTime(composition.date)) error(`${cPath}.date`, "Must be a date-time");
  if (typeof composition.title !== "string" || composition.title === "") error(`${cPath}.title`, "Missing title");

  const resolve = (value: unknown, path: string, expectedType?: string) => {
    const reference = isObject(value) ? value.reference : undefined;
    if (typeof reference !== "string") return error(path, "Missing reference");
    const target = byReference.get(reference);
    if (!target) return error(path, `Reference ${reference} does not resolve inside the bundle`);
    if (expectedType && target.resourceType !== expectedType) error(path, `Must reference a ${expectedType}, found ${String(target.resourceType)}`);
  };

  resolve(composition.subject, `${cPath}.subject`, "Patient");
  const authors = Array.isArray(composition.author) ? composition.author : [];
  if (authors.length === 0) error(`${cPath}.author`, "At least one author is required");
  authors.forEach((a, i) => resolve(a, `${cPath}.author[${i}]`));

  const sections = Array.isArray(composition.section) ? composition.section : [];
  if (sections.length === 0) error(`${cPath}.section`, "At least one section is required");
  sections.forEach((section, s) => {
    const sectionEntries = isObject(section) && Array.isArray(section.entry) ? section.entry : [];
    sectionEntries.forEach((e, i) => resolve(e, `${cPath}.section[${s}].entry[${i}]`));
  });

  return { valid: !issues.some((i) => i.severity === "error"), ...(hiType ? { hiType } : {}), issues };
}
