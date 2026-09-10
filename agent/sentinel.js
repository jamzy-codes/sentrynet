import { ethers } from "ethers";
import * as dotenv from "dotenv";
import http from "http";
import {
  initDb,
  insertAlert,
  getAlerts,
  getAlertCount,
  insertPendingSlash,
  updatePendingSlashStatus,
  getPendingSlashes,
} from "../db.js";

dotenv.config();

const RPC_URL = "https://rpc.bohr.life";
const CONTRACT_ADDRESS = process.env.CONTRACT_ADDRESS;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const GEMINI_MODEL = "gemini-2.5-flash";
// Railway (and most hosting platforms) assign a port dynamically via process.env.PORT.
// Falls back to 4000 for local development where no PORT env var is set.
const API_PORT = process.env.PORT || 4000;
const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS || "http://localhost:3000")
  .split(",")
  .map((s) => s.trim());
const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_MAX = 60; // requests per IP per window
const requestLog = new Map(); // ip -> array of recent request timestamps

function isRateLimited(ip) {
  const now = Date.now();
  const recent = (requestLog.get(ip) || []).filter(
    (t) => now - t < RATE_LIMIT_WINDOW_MS,
  );
  recent.push(now);
  requestLog.set(ip, recent);
  return recent.length > RATE_LIMIT_MAX;
}

if (!CONTRACT_ADDRESS)
  throw new Error(
    "Set CONTRACT_ADDRESS in .env to your deployed NodeRegistry address",
  );
if (!GEMINI_API_KEY) throw new Error("Set GEMINI_API_KEY in .env");

const ABI = [
  "event NodeRegistered(string nodeId, address indexed owner, uint256 timestamp)",
  "event NodeDeactivated(string nodeId, uint256 timestamp)",
  "event NodeReactivated(string nodeId, uint256 timestamp)",
  "event ProofSubmitted(string nodeId, address indexed submitter, uint256 outputClaimed, uint256 timestamp)",
  "event ImplausibleOutputFlag(string nodeId, uint256 outputClaimed, uint256 timestamp)",
  "event ProofFromInactiveNode(string nodeId, address indexed submitter, uint256 timestamp)",
  "function getNodeCount() view returns (uint256)",
];

const provider = new ethers.JsonRpcProvider(RPC_URL, {
  chainId: 968,
  name: "bot-testnet",
});
const registry = new ethers.Contract(CONTRACT_ADDRESS, ABI, provider);

// Signer needed for slash() calls, not just reads. Also used to derive AGENT_ADDRESS.
const wallet = process.env.PRIVATE_KEY
  ? new ethers.Wallet(process.env.PRIVATE_KEY, provider)
  : null;
const AGENT_ADDRESS = wallet ? wallet.address : null;

const BOND_MANAGER_ADDRESS = process.env.BOND_MANAGER_ADDRESS;
const TIMELOCK_ADDRESS = process.env.TIMELOCK_ADDRESS;

const BOND_MANAGER_ABI = [
  "function flagPendingSlash(string calldata nodeId) external",
  "function slash(string calldata nodeId, string calldata reason) external",
  "function getBond(string calldata nodeId) view returns (address operator, uint256 amount, uint256 unbondingAt)",
];
const TIMELOCK_ABI = [
  "function schedule(address target, uint256 value, bytes calldata data, bytes32 predecessor, bytes32 salt, uint256 delay) external",
  "function hashOperation(address target, uint256 value, bytes calldata data, bytes32 predecessor, bytes32 salt) view returns (bytes32)",
  "function getMinDelay() view returns (uint256)",
];

const TIMELOCK_EVENTS_ABI = [
  "event CallExecuted(bytes32 indexed id, uint256 indexed index, address target, uint256 value, bytes data)",
  "event Cancelled(bytes32 indexed id)",
];

const timelockEventsInterface = new ethers.Interface(TIMELOCK_EVENTS_ABI);

const bondManager =
  BOND_MANAGER_ADDRESS && wallet
    ? new ethers.Contract(BOND_MANAGER_ADDRESS, BOND_MANAGER_ABI, wallet)
    : null;
const timelock =
  TIMELOCK_ADDRESS && wallet
    ? new ethers.Contract(TIMELOCK_ADDRESS, TIMELOCK_ABI, wallet)
    : null;

// Two-step now instead of an instant slash:
// 1. Flag the node immediately (locks its funds against withdrawal while under review).
// 2. Schedule the actual slash() call on the timelock, it only executes after
//    the delay window, and can be cancelled by anyone holding CANCELLER_ROLE.
async function trySlash(nodeId, reason, relatedAlertId) {
  if (!bondManager || !timelock) return;

  try {
    const flagTx = await bondManager.flagPendingSlash(nodeId);
    await flagTx.wait();
    console.log(
      `[bond] Flagged pending slash for "${nodeId}" (tx: ${flagTx.hash})`,
    );
  } catch (err) {
    console.error(
      `[bond] flagPendingSlash failed for "${nodeId}":`,
      err.message,
    );
    return;
  }

  try {
    const data = bondManager.interface.encodeFunctionData("slash", [
      nodeId,
      reason,
    ]);
    const minDelay = await timelock.getMinDelay();
    const salt = ethers.keccak256(
      ethers.toUtf8Bytes(`${nodeId}-${reason}-${Date.now()}`),
    );

    const operationId = await timelock.hashOperation(
      BOND_MANAGER_ADDRESS,
      0,
      data,
      ethers.ZeroHash,
      salt,
    );

    const tx = await timelock.schedule(
      BOND_MANAGER_ADDRESS,
      0,
      data,
      ethers.ZeroHash,
      salt,
      minDelay,
    );
    await tx.wait();
    console.log(
      `[bond] Scheduled slash for "${nodeId}", executes after ${minDelay}s (tx: ${tx.hash})`,
    );
    console.log(`[bond] Salt for manual execute/cancel testing: ${salt}`);

    const now = new Date();
    const executeAfter = new Date(now.getTime() + Number(minDelay) * 1000);

    await insertPendingSlash({
      operationId,
      nodeId,
      reason,
      salt,
      relatedAlertId,
      scheduledAt: now.toISOString(),
      executeAfter: executeAfter.toISOString(),
    });
  } catch (err) {
    console.error(
      `[bond] Scheduling slash failed for "${nodeId}":`,
      err.message,
    );
  }
}

const STARTED_AT = new Date().toISOString();

// --- In-memory state shared between the polling loop and the HTTP API ---
let nodesRegistered = 0;

function explorerAddressUrl(address) {
  return `https://scan.bohr.life/address/${address}`;
}
function explorerTxUrl(txHash) {
  return `https://scan.bohr.life/tx/${txHash}`;
}

async function generateReportOnce(anomalyType, details) {
  const prompt = `You are SentryNet, an autonomous AI security agent monitoring a DePIN compute-node registry on BOT Chain. You just detected the following anomaly:

Anomaly type: ${anomalyType}
Details: ${JSON.stringify(details, null, 2)}

Write a short, professional security alert report (4-6 sentences) explaining what happened, why it's suspicious, and what a network operator should check next. Be concrete and specific to the details given. Do not use markdown formatting, just plain text.`;

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${GEMINI_API_KEY}`;

  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
    }),
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`Gemini API error (${response.status}): ${errText}`);
  }

  const data = await response.json();
  const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;
  return text ?? "(No report text returned)";
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Retries a couple times on transient Gemini errors (e.g. 503 "model overloaded").
// If all attempts fail, returns a clear fallback report instead of throwing —
// this guarantees a real on-chain anomaly is never silently dropped from /api/alerts
// just because a third-party AI call happened to hiccup.
async function generateReport(
  anomalyType,
  details,
  { retries = 2, delayMs = 2000 } = {},
) {
  let lastError;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await generateReportOnce(anomalyType, details);
    } catch (err) {
      lastError = err;
      console.error(
        `[gemini] attempt ${attempt + 1}/${retries + 1} failed:`,
        err.message,
      );
      if (attempt < retries) await sleep(delayMs);
    }
  }
  console.error(
    "[gemini] all retries exhausted, recording alert with fallback report.",
  );
  return `AI report generation is temporarily unavailable (${
    lastError?.message ?? "unknown error"
  }). The on-chain anomaly was detected and recorded regardless: ${anomalyType} on node "${
    details.nodeId
  }". Please refer to the transaction on the block explorer for verified evidence while the report generator recovers.`;
}

function printAlert(title, report) {
  console.log("");
  console.log("=".repeat(70));
  console.log(`🚨 ${title}`);
  console.log("=".repeat(70));
  console.log(report.trim());
  console.log("=".repeat(70));
  console.log("");
}

async function recordAlert({
  type,
  severity,
  nodeId,
  txHash,
  logIndex,
  details,
  report,
}) {
  const alert = {
    id: `${txHash}-${logIndex}`,
    type,
    severity,
    nodeId,
    detectedAt: new Date().toISOString(),
    txHash,
    explorerTxUrl: explorerTxUrl(txHash),
    details,
    report: report.trim(),
  };
  await insertAlert(alert);
}

const POLL_INTERVAL_MS = 6000;

async function checkTimelockOutcomes(fromBlock, toBlock) {
  if (!TIMELOCK_ADDRESS) return;

  try {
    const logs = await provider.getLogs({
      address: TIMELOCK_ADDRESS,
      fromBlock,
      toBlock,
    });

    for (const log of logs) {
      let parsed;

      try {
        parsed = timelockEventsInterface.parseLog(log);
      } catch {
        continue; // not one of the two events we care about
      }

      if (!parsed) continue;

      if (parsed.name === "CallExecuted") {
        await updatePendingSlashStatus(parsed.args.id, "executed");
        console.log(
          `[bond] Pending slash executed on-chain (operation ${parsed.args.id})`,
        );
      } else if (parsed.name === "Cancelled") {
        await updatePendingSlashStatus(parsed.args.id, "cancelled");
        console.log(
          `[bond] Pending slash cancelled (operation ${parsed.args.id})`,
        );
      }
    }
  } catch (err) {
    console.error("[timelock poll error]", err.message);
  }
}

async function handleLog(log) {
  const parsed = registry.interface.parseLog(log);
  if (!parsed) return;

  const { name, args } = parsed;
  const txHash = log.transactionHash;

  if (name === "NodeRegistered") {
    nodesRegistered += 1;
    console.log(`[info] Node registered: "${args.nodeId}" by ${args.owner}`);
  } else if (name === "ProofSubmitted") {
    console.log(
      `[info] Proof submitted: "${
        args.nodeId
      }" claimed output ${args.outputClaimed.toString()}`,
    );
  } else if (name === "ImplausibleOutputFlag") {
    console.log(`[ANOMALY] Implausible output detected on "${args.nodeId}"`);
    const details = {
      nodeId: args.nodeId,
      outputClaimed: args.outputClaimed.toString(),
      threshold: "100000",
      timestamp: new Date(Number(args.timestamp) * 1000).toISOString(),
    };
    // generateReport no longer throws — it always resolves, falling back to a
    // placeholder message if Gemini is unavailable, so the alert below is always recorded.
    const report = await generateReport("Implausible Output Claim", details);
    printAlert(`Implausible Output Claim — Node "${args.nodeId}"`, report);
    await recordAlert({
      type: "ImplausibleOutputClaim",
      severity: "high",
      nodeId: args.nodeId,
      txHash,
      logIndex: log.index,
      details,
      report,
    });
    await trySlash(
      args.nodeId,
      "Implausible output claim",
      `${txHash}-${log.index}`,
    );
  } else if (name === "ProofFromInactiveNode") {
    console.log(
      `[ANOMALY] Proof submitted from inactive node "${args.nodeId}"`,
    );
    const details = {
      nodeId: args.nodeId,
      submitter: args.submitter,
      timestamp: new Date(Number(args.timestamp) * 1000).toISOString(),
    };
    const report = await generateReport(
      "Proof Submitted From Inactive Node",
      details,
    );
    printAlert(`Proof From Inactive Node — Node "${args.nodeId}"`, report);
    await recordAlert({
      type: "ProofFromInactiveNode",
      severity: "high",
      nodeId: args.nodeId,
      txHash,
      logIndex: log.index,
      details,
      report,
    });
    await trySlash(
      args.nodeId,
      "Proof submitted from inactive node",
      `${txHash}-${log.index}`,
    );
  }
}

// --- Tiny local HTTP API so a frontend can pull real, live data ---
function startApiServer() {
  const server = http.createServer(async (req, res) => {
    const origin = req.headers.origin;
    if (ALLOWED_ORIGINS.includes(origin)) {
      res.setHeader("Access-Control-Allow-Origin", origin);
    }
    res.setHeader("Content-Type", "application/json");

    if (req.method === "OPTIONS") {
      res.writeHead(204);
      res.end();
      return;
    }

    const ip = req.socket.remoteAddress;
    if (isRateLimited(ip)) {
      res.writeHead(429);
      res.end(JSON.stringify({ error: "Too many requests, slow down." }));
      return;
    }

    try {
      if (req.url === "/api/identity") {
        const totalAlertsRaised = await getAlertCount();
        const body = {
          agentName: "SentryNet",
          agentAddress: AGENT_ADDRESS,
          contractAddress: CONTRACT_ADDRESS,
          network: "BOT Chain Testnet",
          chainId: 968,
          startedAt: STARTED_AT,
          nodesMonitored: nodesRegistered,
          totalAlertsRaised,
          explorerAgentUrl: AGENT_ADDRESS
            ? explorerAddressUrl(AGENT_ADDRESS)
            : null,
          explorerContractUrl: explorerAddressUrl(CONTRACT_ADDRESS),
        };
        res.writeHead(200);
        res.end(JSON.stringify(body, null, 2));
        return;
      }

      if (req.url === "/api/alerts") {
        const alerts = await getAlerts();
        res.writeHead(200);
        res.end(JSON.stringify(alerts, null, 2));
        return;
      }
      if (req.url.startsWith("/api/bond/")) {
        const nodeId = decodeURIComponent(req.url.replace("/api/bond/", ""));
        if (!bondManager) {
          res.writeHead(200);
          res.end(
            JSON.stringify({ operator: null, amount: "0", unbondingAt: "0" }),
          );
          return;
        }
        try {
          const [operator, amount, unbondingAt] = await bondManager.getBond(
            nodeId,
          );
          res.writeHead(200);
          res.end(
            JSON.stringify({
              operator: operator === ethers.ZeroAddress ? null : operator,
              amount: ethers.formatEther(amount),
              unbondingAt: unbondingAt.toString(),
            }),
          );
        } catch (err) {
          res.writeHead(500);
          res.end(JSON.stringify({ error: err.message }));
        }
        return;
      }

      if (
        req.url === "/api/pending-slashes" ||
        req.url?.startsWith("/api/pending-slashes?")
      ) {
        const url = new URL(req.url, `http://localhost:${API_PORT}`);
        const status = url.searchParams.get("status");
        const pending = await getPendingSlashes(status);
        res.writeHead(200);
        res.end(JSON.stringify(pending, null, 2));
        return;
      }

      res.writeHead(404);
      res.end(JSON.stringify({ error: "Not found" }));
    } catch (err) {
      console.error("[api error]", err.message);
      res.writeHead(500);
      res.end(JSON.stringify({ error: "Internal server error" }));
    }
  });

  server.listen(API_PORT, () => {
    console.log(`SentryNet API listening on http://localhost:${API_PORT}`);
  });
}

async function main() {
  await initDb();
  const nodeCount = await registry.getNodeCount();
  nodesRegistered = Number(nodeCount);

  console.log("SentryNet agent started.");
  console.log("Watching NodeRegistry at:", CONTRACT_ADDRESS);
  console.log("Nodes currently registered:", nodeCount.toString());
  console.log(
    `Polling for new events every ${
      POLL_INTERVAL_MS / 1000
    }s... (leave this running)`,
  );
  console.log("");

  startApiServer();

  let lastCheckedBlock = await provider.getBlockNumber();

  async function poll() {
    try {
      const currentBlock = await provider.getBlockNumber();
      if (currentBlock > lastCheckedBlock) {
        const logs = await provider.getLogs({
          address: CONTRACT_ADDRESS,
          fromBlock: lastCheckedBlock + 1,
          toBlock: currentBlock,
        });

        for (const log of logs) {
          try {
            await handleLog(log);
          } catch (err) {
            console.error("[handleLog error]", err.message);
          }
        }

        await checkTimelockOutcomes(lastCheckedBlock + 1, currentBlock);

        lastCheckedBlock = currentBlock;
      }
    } catch (err) {
      console.error("[poll error]", err.message);
    } finally {
      setTimeout(poll, POLL_INTERVAL_MS);
    }
  }

  poll();
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
