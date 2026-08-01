import "server-only";

import { createDatabaseClient, type DatabaseClient } from "@siftloom/db";

interface DatabaseGlobals {
  auth?: DatabaseClient;
  runtime?: DatabaseClient;
}

const databaseGlobals = globalThis as typeof globalThis & {
  __siftloomDatabases?: DatabaseGlobals;
};

function requireDatabaseUrl(name: "AUTH_DATABASE_URL" | "DATABASE_URL"): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function getClients(): DatabaseGlobals {
  databaseGlobals.__siftloomDatabases ??= {};
  return databaseGlobals.__siftloomDatabases;
}

export function getAuthDatabaseClient(): DatabaseClient {
  const clients = getClients();
  clients.auth ??= createDatabaseClient(requireDatabaseUrl("AUTH_DATABASE_URL"));
  return clients.auth;
}

export function getRuntimeDatabaseClient(): DatabaseClient {
  const clients = getClients();
  clients.runtime ??= createDatabaseClient(requireDatabaseUrl("DATABASE_URL"));
  return clients.runtime;
}
