import { network } from "hardhat";

// $env:BOND_MANAGER_ADDRESS="0x..."; $env:NODE_ID="node-1"; npx hardhat run scripts/checkBond.ts --network botTestnet
const BOND_MANAGER_ADDRESS = process.env.BOND_MANAGER_ADDRESS;
const NODE_ID = process.env.NODE_ID;

async function main() {
  if (!BOND_MANAGER_ADDRESS) throw new Error("Set BOND_MANAGER_ADDRESS env var");
  if (!NODE_ID) throw new Error("Set NODE_ID env var");

  const { ethers } = await network.connect({ network: "botTestnet" });

  const bondManager = await ethers.getContractAt("BondManager", BOND_MANAGER_ADDRESS);
  const [operator, amount, unbondingAt] = await bondManager.getBond(NODE_ID);

  console.log(`Bond status for "${NODE_ID}":`);
  console.log("Operator:", operator === ethers.ZeroAddress ? "(none)" : operator);
  console.log("Amount:", ethers.formatEther(amount), "BOT");
  console.log("Unbonding at:", unbondingAt.toString() === "0" ? "not requested" : unbondingAt.toString());
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
