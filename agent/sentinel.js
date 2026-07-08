import { ethers } from "ethers";
import * as dotenv from "dotenv";
import http from "http";

dotenv.config();

const RPC_URL = "https://rpc.bohr.life";
const CONTRACT_ADDRESS = process.env.CONTRACT_ADDRESS;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const GEMINI_MODEL = "gemini-2.5-flash";
const API_PORT = 4000;

if (!CONTRACT_ADDRESS) throw new Error("Set CONTRACT_ADDRESS in .env to your deployed NodeRegistry address");
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

// Derive the agent's own address from the same private key used elsewhere in the project.
const AGENT_ADDRESS = process.env.PRIVATE_KEY
  ? new ethers.Wallet(process.env.PRIVATE_KEY).address
  : null;

const STARTED_AT = new Date().toISOString();

// --- In-memory state shared between the polling loop and the HTTP API ---
let nodesRegistered = 0;
const alerts = []; // newest-first

function explorerAddressUrl(address) {
  return `https://scan.bohr.life/address/${address}`;
}
function explorerTxUrl(txHash) {
  return `https://scan.bohr.life/tx/${txHash}`;
}

async function generateReportOnce(anomalyType, details) {
  const prompt = `You are BOT Sentinel, an autonomous AI security agent monitoring a DePIN compute-node registry on BOT Chain. You just detected the following anomaly:

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
async function generateReport(anomalyType, details, { retries = 2, delayMs = 2000 } = {}) {
  let lastError;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await generateReportOnce(anomalyType, details);
    } catch (err) {
      lastError = err;
      console.error(`[gemini] attempt ${attempt + 1}/${retries + 1} failed:`, err.message);
      if (attempt < retries) await sleep(delayMs);
    }
  }
  console.error("[gemini] all retries exhausted, recording alert with fallback report.");
  return `AI report generation is temporarily unavailable (${lastError?.message ?? "unknown error"}). The on-chain anomaly was detected and recorded regardless: ${anomalyType} on node "${details.nodeId}". Please refer to the transaction on the block explorer for verified evidence while the report generator recovers.`;
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

function recordAlert({ type, severity, nodeId, txHash, details, report }) {
  const alert = {
    id: txHash,
    type,
    severity,
    nodeId,
    detectedAt: new Date().toISOString(),
    txHash,
    explorerTxUrl: explorerTxUrl(txHash),
    details,
    report: report.trim(),
  };
  alerts.unshift(alert); // newest-first
}

const POLL_INTERVAL_MS = 6000;

async function handleLog(log) {
  const parsed = registry.interface.parseLog(log);
  if (!parsed) return;

  const { name, args } = parsed;
  const txHash = log.transactionHash;

  if (name === "NodeRegistered") {
    nodesRegistered += 1;
    console.log(`[info] Node registered: "${args.nodeId}" by ${args.owner}`);
  } else if (name === "ProofSubmitted") {
    console.log(`[info] Proof submitted: "${args.nodeId}" claimed output ${args.outputClaimed.toString()}`);
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
    recordAlert({
      type: "ImplausibleOutputClaim",
      severity: "high",
      nodeId: args.nodeId,
      txHash,
      details,
      report,
    });
  } else if (name === "ProofFromInactiveNode") {
    console.log(`[ANOMALY] Proof submitted from inactive node "${args.nodeId}"`);
    const details = {
      nodeId: args.nodeId,
      submitter: args.submitter,
      timestamp: new Date(Number(args.timestamp) * 1000).toISOString(),
    };
    const report = await generateReport("Proof Submitted From Inactive Node", details);
    printAlert(`Proof From Inactive Node — Node "${args.nodeId}"`, report);
    recordAlert({
      type: "ProofFromInactiveNode",
      severity: "high",
      nodeId: args.nodeId,
      txHash,
      details,
      report,
    });
  }
}

// --- Tiny local HTTP API so a frontend can pull real, live data ---
function startApiServer() {
  const server = http.createServer((req, res) => {
    // Allow the frontend (running on a different origin/port) to fetch this.
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Content-Type", "application/json");

    if (req.method === "OPTIONS") {
      res.writeHead(204);
      res.end();
      return;
    }

    if (req.url === "/api/identity") {
      const body = {
        agentName: "BOT Sentinel",
        agentAddress: AGENT_ADDRESS,
        contractAddress: CONTRACT_ADDRESS,
        network: "BOT Chain Testnet",
        chainId: 968,
        startedAt: STARTED_AT,
        nodesMonitored: nodesRegistered,
        totalAlertsRaised: alerts.length,
        explorerAgentUrl: AGENT_ADDRESS ? explorerAddressUrl(AGENT_ADDRESS) : null,
        explorerContractUrl: explorerAddressUrl(CONTRACT_ADDRESS),
      };
      res.writeHead(200);
      res.end(JSON.stringify(body, null, 2));
      return;
    }

    if (req.url === "/api/alerts") {
      res.writeHead(200);
      res.end(JSON.stringify(alerts, null, 2));
      return;
    }

    res.writeHead(404);
    res.end(JSON.stringify({ error: "Not found" }));
  });

  server.listen(API_PORT, () => {
    console.log(`Sentinel API listening on http://localhost:${API_PORT}`);
  });
}

async function main() {
  const nodeCount = await registry.getNodeCount();
  nodesRegistered = Number(nodeCount);

  console.log("BOT Sentinel agent started.");
  console.log("Watching NodeRegistry at:", CONTRACT_ADDRESS);
  console.log("Nodes currently registered:", nodeCount.toString());
  console.log(`Polling for new events every ${POLL_INTERVAL_MS / 1000}s... (leave this running)`);
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
          await handleLog(log);
        }

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