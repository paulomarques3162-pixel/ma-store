import jwt from "jsonwebtoken";
import type { Role } from "@prisma/client";
import { env } from "../env.js";

export type AccessTokenPayload = {
  sub: string;
  role: Role;
  sid?: string;
};

/**
 * Assina o access token (curta duracao).
 * O refresh token NAO e um JWT: e um valor opaco guardado com hash no banco,
 * o que permite revogacao imediata de sessao.
 */
export function signAccessToken(payload: AccessTokenPayload): string {
  return jwt.sign(payload, env.JWT_SECRET, {
    expiresIn: env.JWT_ACCESS_TTL as jwt.SignOptions["expiresIn"],
    issuer: "ma-store",
    audience: "ma-store-client",
    algorithm: "HS256",
  });
}

export function verifyAccessToken(token: string): AccessTokenPayload {
  const decoded = jwt.verify(token, env.JWT_SECRET, {
    issuer: "ma-store",
    audience: "ma-store-client",
    algorithms: ["HS256"],
  });

  if (typeof decoded === "string" || !decoded.sub) {
    throw new Error("Token invalido");
  }

  return {
    sub: String(decoded.sub),
    role: (decoded as { role: Role }).role,
    sid: (decoded as { sid?: string }).sid,
  };
}

export function accessTokenTtlSeconds(): number {
  const ttl = env.JWT_ACCESS_TTL;
  const match = /^(\d+)\s*([smhd])?$/.exec(ttl.trim());
  if (!match) return 900;
  const amount = Number(match[1]);
  const unit = match[2] ?? "s";
  const factor = unit === "d" ? 86400 : unit === "h" ? 3600 : unit === "m" ? 60 : 1;
  return amount * factor;
}
