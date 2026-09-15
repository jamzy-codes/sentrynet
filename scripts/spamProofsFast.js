// scripts/spamProofsFast.js
//
// Fast rate-based spam test for SentryNet's ProofSubmitted anomaly detector.
//
// Unlike running `npx hardhat run scripts/submitProof.ts` in a loop (which pays
// a full Hardhat process-boot cost on every single iteration, easily pushing
// submissions past the 2-minute sliding window), this script opens ONE
// connection and fires submissions with a small stagger between them using a
// manually managed nonce, so they land on-chain within seconds instead of
// minutes.
//
// RETRY LOGIC:
// rpc.bohr.life has shown a consistent ~35-45% transaction failure rate under
// rapid/bursty load in testing (confirmed via scripts/diagnoseRevert.js to be
// an RPC-level issue — no nonce collisions, no contract-level rate limiting,
// no revert reason data returned at all). Since we can't fix a third-party
// RPC's reliability, this script targets a GUARANTEED number of successful
// on-chain confirmations by automatically retrying failures with a fresh
// nonce, instead of sending a fixed batch once and hoping enough survive.
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
// The number of CONFIRMED SUCCESSES to guarantee, not just the number sent.
const TARGET_SUCCESSES = Number(process.env.SPAM_TARGET || 25);
const MAX_ROUNDS = Number(process.env.SPAM_MAX_ROUNDS || 5);
const STAGGER_MS = Number(process.env.SPAM_STAGGER_MS || 150);

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Matches the real submitProof(string,uint256) signature confirmed via
// scripts/submitProof.ts: registry.submitProof(nodeId, BigInt(outputClaimed))
const ABI = [
  "function submitProof(string calldata nodeId, uint256 outputClaimed) external",
];

async function sendBatch(contract, provider, wallet, count, outputStart) {
  let nonce = await provider.getTransactionCount(wallet.address, "pending");
  console.log(`  Starting nonce for this round: ${nonce}`);

  const txs = [];
  for (let i = 0; i < count; i++) {
    const outputClaimed = outputStart + i; // stays well under the 100000 implausible-output threshold
    try {
      const tx = await contract.submitProof(NODE_ID, BigInt(outputClaimed), { nonce: nonce++ });
      console.log(`  [${i + 1}/${count}] sent, tx: ${tx.hash}`);
      txs.push(tx);
    } catch (err) {
      console.warn(`  [${i + 1}/${count}] send failed before broadcast:`, err.shortMessage || err.message);
    }
    if (i < count - 1) await sleep(STAGGER_MS);
  }

  console.log(`  All sent for this round. Waiting for confirmations...`);
  const results = await Promise.allSettled(txs.map((tx) => tx.wait()));
  const successCount = results.filter((r) => r.status === "fulfilled").length;
  const failCount = results.length - successCount;

  return { successCount, failCount, lastOutput: outputStart + count };
}

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

  let totalSuccesses = 0;
  let outputCursor = 101;
  let round = 1;

  console.log(`Target: ${TARGET_SUCCESSES} confirmed submissions for "${NODE_ID}"`);
  console.log(`(will retry failures automatically, up to ${MAX_ROUNDS} rounds)`);
  console.log("");

  while (totalSuccesses < TARGET_SUCCESSES && round <= MAX_ROUNDS) {
    const remaining = TARGET_SUCCESSES - totalSuccesses;
    // Send a bit more than strictly remaining to account for the known
    // failure rate, so most runs finish in fewer rounds.
    const batchSize = round === 1 ? Math.ceil(remaining * 1.5) : remaining + Math.ceil(remaining * 0.5);

    console.log(`Round ${round}: sending ${batchSize} (need ${remaining} more successes)...`);
    const { successCount, failCount, lastOutput } = await sendBatch(
      contract,
      provider,
      wallet,
      batchSize,
      outputCursor,
    );
    outputCursor = lastOutput;
    totalSuccesses += successCount;

    console.log(`Round ${round} result: ${successCount} succeeded, ${failCount} failed.`);
    console.log(`Running total: ${totalSuccesses}/${TARGET_SUCCESSES}`);
    console.log("");
    round++;
  }

  if (totalSuccesses >= TARGET_SUCCESSES) {
    console.log(`Done. Reached ${totalSuccesses} confirmed submissions (target was ${TARGET_SUCCESSES}).`);
  } else {
    console.warn(
      `Stopped after ${MAX_ROUNDS} rounds with only ${totalSuccesses}/${TARGET_SUCCESSES} confirmed. ` +
        `The RPC may be experiencing unusually heavy failure rates right now — try running again, or increase SPAM_MAX_ROUNDS.`,
    );
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
