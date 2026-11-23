export type UpdateEligibility =
  | { type: "unrestricted"; issuedAt: string; environment: string }
  | { type: "held"; issuedAt: string; environment: string; reason?: string; until?: string }
  | {
      type: "eligible";
      issuedAt: string;
      environment: string;
      priority?: "normal" | "high";
    };
