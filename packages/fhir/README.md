# @yellowparrottech/abdm-fhir

Build and check FHIR document bundles for ABDM health information types (NRCeS IG `ndhm.in` 6.5.0).

- `buildDocumentBundle`: a document Bundle whose Composition declares the NRCeS profile for the HI type (for example `PrescriptionRecord`), with the Patient, the author and your clinical resources linked by `urn:uuid` references.
- `validateDocumentBundle`: structural checks only. It checks the bundle shape, that the Composition comes first and declares a known NRCeS record profile, its status, date, title, author and sections, and that every reference resolves inside the bundle. It does not check profile cardinalities, terminology bindings or slicing. Full validation will use the HL7 FHIR validator with the NRCeS IG, once the IG package licence is confirmed.

Clinical content is plain text for now: no SNOMED CT or LOINC codes until terminology licensing is settled.

Pre-release; not yet published to npm.
