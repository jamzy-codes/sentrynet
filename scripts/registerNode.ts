import { network } from "hardhat";

async function main() {
  const contractAddress = process.env.CONTRACT_ADDRESS;
  const nodeId = process.env.NODE_ID;

  if (!contractAddress) throw new Error("Set CONTRACT_ADDRESS env var to your deployed NodeRegistry address");
  if (!nodeId) throw new Error("Set NODE_ID env var, e.g. 'node-1'");

  const { ethers } = await network.connect({ network: "botTestnet" });
  const [signer] = await ethers.getSigners();

  const registry = await ethers.getContractAt("NodeRegistry", contractAddress, signer);

  console.log(`Registering node "${nodeId}" from ${signer.address}...`);
  const tx = await registry.registerNode(nodeId);
  console.log("Tx sent:", tx.hash);
  await tx.wait();
  console.log(`Node "${nodeId}" registered successfully.`);
  console.log("View tx:", `https://scan.bohr.life/tx/${tx.hash}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});