import { network } from "hardhat";

async function main() {
  const contractAddress = process.env.CONTRACT_ADDRESS;
  const nodeId = process.env.NODE_ID;
  const outputClaimed = process.env.OUTPUT_CLAIMED;

  if (!contractAddress) throw new Error("Set CONTRACT_ADDRESS env var to your deployed NodeRegistry address");
  if (!nodeId) throw new Error("Set NODE_ID env var, e.g. 'node-1'");
  if (!outputClaimed) throw new Error("Set OUTPUT_CLAIMED env var, e.g. '500' or '999999' for an anomaly");

  const { ethers } = await network.connect({ network: "botTestnet" });
  const [signer] = await ethers.getSigners();

  const registry = await ethers.getContractAt("NodeRegistry", contractAddress, signer);

  console.log(`Submitting proof for "${nodeId}" — output claimed: ${outputClaimed}...`);
  const tx = await registry.submitProof(nodeId, BigInt(outputClaimed));
  console.log("Tx sent:", tx.hash);
  await tx.wait();
  console.log("Proof submitted successfully.");
  console.log("View tx:", `https://scan.bohr.life/tx/${tx.hash}`);

  if (BigInt(outputClaimed) >= 100000n) {
    console.log("⚠ This output exceeds the implausible-output threshold — ImplausibleOutputFlag should have fired.");
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});