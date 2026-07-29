// db.js
// Persistent alert storage using Turso (hosted libSQL/SQLite).
// Replaces the in-memory alerts array so data survives restarts and redeploys.

import { createClient } from "@libsql/client";
import * as dotenv from "dotenv";

dotenv.config();

const client = createClient({
  url: process.env.TURSO_DATABASE_URL,
  authToken: process.env.TURSO_AUTH_TOKEN,
});

// Call once at startup (e.g. at the top of sentinel.js after imports).
export async function initDb() {
  await client.execute(`
    CREATE TABLE IF NOT EXISTS alerts (
      id TEXT PRIMARY KEY,
      type TEXT NOT NULL,
      severity TEXT NOT NULL,
      node_id TEXT NOT NULL,
      detected_at TEXT NOT NULL,
      tx_hash TEXT,
      explorer_tx_url TEXT,
      details TEXT,
      report TEXT
    )
  `);
  console.log("[db] Turso alerts table ready");
}

// Insert a new alert. Call this everywhere the old code did
// `alerts.unshift(newAlert)` or similar.
export async function insertAlert(alert) {
  await client.execute({
    sql: `
      INSERT INTO alerts (id, type, severity, node_id, detected_at, tx_hash, explorer_tx_url, details, report)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `,
    args: [
      alert.id,
      alert.type,
      alert.severity,
      alert.nodeId,
      alert.detectedAt,
      alert.txHash ?? null,
      alert.explorerTxUrl ?? null,
      JSON.stringify(alert.details ?? {}),
      alert.report ?? null,
    ],
  });
}

// Replaces GET /api/alerts. Returns newest-first, matching current API shape.
export async function getAlerts(limit = 100) {
  const result = await client.execute({
    sql: `SELECT * FROM alerts ORDER BY detected_at DESC LIMIT ?`,
    args: [limit],
  });
  return result.rows.map(rowToAlert);
}

// Replaces the per-alert lookup used by /verification/:alertId.
export async function getAlertById(id) {
  const result = await client.execute({
    sql: `SELECT * FROM alerts WHERE id = ?`,
    args: [id],
  });
  if (result.rows.length === 0) return null;
  return rowToAlert(result.rows[0]);
}

// Total count, used for the /api/identity totalAlertsRaised field.
export async function getAlertCount() {
  const result = await client.execute(`SELECT COUNT(*) as count FROM alerts`);
  return Number(result.rows[0].count);
}

function rowToAlert(row) {
  return {
    id: row.id,
    type: row.type,
    severity: row.severity,
    nodeId: row.node_id,
    detectedAt: row.detected_at,
    txHash: row.tx_hash,
    explorerTxUrl: row.explorer_tx_url,
    details: row.details ? JSON.parse(row.details) : {},
    report: row.report,
  };
}
