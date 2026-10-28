import { digits, pick, seededRandom } from "./random.js";

export interface SyntheticPatient {
  synthetic: true;
  /** 14 digits shown as XX-XXXX-XXXX-XXXX; the `00` prefix marks it as synthetic. Never send these to a real ABDM environment. */
  abhaNumber: string;
  /** Sandbox-style ABHA address ending in `@sbx`. */
  abhaAddress: string;
  givenName: string;
  familyName: string;
  gender: "M" | "F" | "O";
  yearOfBirth: number;
  /** Not a valid Indian mobile number: real numbers never start with 0 after the country code. */
  mobile: string;
}

const GIVEN = { F: ["Asha", "Meera", "Kavya", "Lakshmi", "Nisha", "Pooja"], M: ["Arjun", "Ravi", "Kiran", "Vikram", "Suresh", "Anil"] } as const;
const FAMILY = ["Rao", "Sharma", "Iyer", "Patel", "Reddy", "Das", "Nair", "Gupta"] as const;

export function syntheticPatients(seed: number, count: number): SyntheticPatient[] {
  const random = seededRandom(seed);
  return Array.from({ length: count }, (_, i) => {
    const gender = random() < 0.5 ? "F" : "M";
    const givenName = pick(random, GIVEN[gender]);
    const familyName = pick(random, FAMILY);
    const n = digits(random, 12);
    return {
      synthetic: true,
      abhaNumber: `00-${n.slice(0, 4)}-${n.slice(4, 8)}-${n.slice(8)}`,
      abhaAddress: `${givenName}.${familyName}${i + 1}@sbx`.toLowerCase(),
      givenName,
      familyName,
      gender,
      yearOfBirth: 1950 + Math.floor(random() * 55),
      mobile: `+91-0${digits(random, 9)}`,
    };
  });
}
