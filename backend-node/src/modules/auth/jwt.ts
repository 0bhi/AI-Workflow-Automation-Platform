import jwt from "jsonwebtoken";
import { env } from "../../config/env";

export interface AuthTokenPayload {
  sub: string;
  tenantId: string;
  role?: string;
}

export function signAuthToken(payload: AuthTokenPayload): string {
  return jwt.sign(payload, env.AUTH_JWT_SECRET, {
    algorithm: "HS256",
    expiresIn: "7d"
  });
}

export function verifyAuthToken(token: string): AuthTokenPayload | null {
  try {
    return jwt.verify(token, env.AUTH_JWT_SECRET) as AuthTokenPayload;
  } catch {
    return null;
  }
}


