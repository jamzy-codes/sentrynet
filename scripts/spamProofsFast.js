// scripts/spamProofsFast.js
//
// Fast rate-based spam test for SentryNet's ProofSubmitted anomaly detector.
//
// Unlike running `npx hardhat run scripts/submitProof.ts` in a loop (which pays
// a full Hardhat process-boot cost on every single iteration, easily pushing
// 25 submissions past the 2-minute sliding window), this script opens ONE
// connection and fires all submissions with a small stagger between them
// using a manually managed nonce, so they land on-chain within seconds
// instead of minutes, while avoiding the nonce/mempool-ordering issues seen
// when sending everything with zero delay against a public testnet RPC.
//
// Sends 30 by default (not just 20) to build in margin: NodeRegistry.sol has
// no contract-level rate limiting, so any failures seen are transient
// network/RPC issues, not a deliberate block — a few stragglers failing
// should still comfortably clear the 20-submission threshold.
//
// Usage (PowerShell):
//   $env:CONTRACT_ADDRESS="0x170F34cc6EF948eb4e2b56DA643a80596d854Aa3"
//   $env:NODE_ID="test-spam-1"
//   node scripts/spamProofsFast.js
//
// Requires PRIVATE_KEY to already be set in your project root .env (same one
// sentinel.js and the other Hardhat scripts use).

import { ethers } from "ethers";
import * as dotenv from "dotenv";
dotenv.config();

const RPC_URL = "https://rpc.bohr.life";
const CONTRACT_ADDRESS = process.env.CONTRACT_ADDRESS;
const NODE_ID = process.env.NODE_ID || "test-spam-1";
const COUNT = Number(process.env.SPAM_COUNT || 30);
// Small delay between sends. Zero delay caused ~36% of transactions to
// revert in testing, likely a nonce/mempool-ordering race against a
// load-balanced public RPC. 150ms keeps 30 sends well under 5 seconds
// total, comfortably inside the 2-minute detection window, while giving
// the RPC time to settle each nonce before the next arrives.
const STAGGER_MS = Number(process.env.SPAM_STAGGER_MS || 150);

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Matches the real submitProof(string,uint256) signature confirmed via
// scripts/submitProof.ts: registry.submitProof(nodeId, BigInt(outputClaimed))
const ABI = [
  "function submitProof(string calldata nodeId, uint256 outputClaimed) external",
];

async function main() {
  if (!CONTRACT_ADDRESS) {
    throw new Error("Set CONTRACT_ADDRESS env var to your deployed NodeRegistry address");
  }
  if (!process.env.PRIVATE_KEY) {
    throw new Error("PRIVATE_KEY must be set (usually already in your project root .env)");
  }

  const provider = new ethers.JsonRpcProvider(RPC_URL);
  const wallet = new ethers.Wallet(process.env.PRIVATE_KEY, provider);
  const contract = new ethers.Contract(CONTRACT_ADDRESS, ABI, wallet);

  let nonce = await provider.getTransactionCount(wallet.address, "pending");

  console.log(`Submitting ${COUNT} proofs for "${NODE_ID}" as fast as possible...`);
  console.log(`Starting nonce: ${nonce}`);

  const txs = [];
  for (let i = 1; i <= COUNT; i++) {
    const outputClaimed = 100 + i; // stays well under the 100000 implausible-output threshold
    const tx = await contract.submitProof(NODE_ID, BigInt(outputClaimed), { nonce: nonce++ });
    console.log(`[${i}/${COUNT}] sent, tx: ${tx.hash}`);
    txs.push(tx);
    if (i < COUNT) await sleep(STAGGER_MS);
  }

  console.log("All transactions sent. Waiting for confirmations...");
  const results = await Promise.allSettled(txs.map((tx) => tx.wait()));

  const failed = results.filter((r) => r.status === "rejected");
  if (failed.length > 0) {
    console.warn(`${failed.length} of ${COUNT} transactions failed to confirm:`);
    failed.forEach((f, idx) => console.warn(`  - tx ${idx + 1}:`, f.reason?.message || f.reason));
  } else {
    console.log("All confirmed successfully.");
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
