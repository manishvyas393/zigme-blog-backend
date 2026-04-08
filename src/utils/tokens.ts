import crypto from "node:crypto";

export function generateId(): string {
  return crypto.randomUUID();
}

export function generateReviewToken(): string {
  return crypto.randomBytes(24).toString("hex");
}

