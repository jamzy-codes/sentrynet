import { network } from "hardhat";

// $env:BOND_MANAGER_ADDRESS="0x..."; $env:NODE_ID="node-1"; $env:BOND_AMOUNT_BOT="0.1"; npx hardhat run scripts/postBond.ts --network botTestnet
const BOND_MANAGER_ADDRESS = process.env.BOND_MANAGER_ADDRESS;
const NODE_ID = process.env.NODE_ID;
const BOND_AMOUNT_BOT = process.env.BOND_AMOUNT_BOT || "0.1";

async function main() {
  if (!BOND_MANAGER_ADDRESS) throw new Error("Set BOND_MANAGER_ADDRESS env var");
  if (!NODE_ID) throw new Error("Set NODE_ID env var");

  const { ethers } = await network.connect({ network: "botTestnet" });

  const [signer] = await ethers.getSigners();
  console.log(`Posting bond for "${NODE_ID}" from account:`, signer.address);

  const bondManager = await ethers.getContractAt("BondManager", BOND_MANAGER_ADDRESS);

  const tx = await bondManager.postBond(NODE_ID, { value: ethers.parseEther(BOND_AMOUNT_BOT) });
  console.log("Tx sent:", tx.hash);
  await tx.wait();

  const [operator, amount, unbondingAt] = await bondManager.getBond(NODE_ID);
  console.log("Bond posted successfully.");
  console.log("Operator:", operator);
  console.log("Amount:", ethers.formatEther(amount), "BOT");
  console.log("Unbonding at:", unbondingAt.toString() === "0" ? "not requested" : unbondingAt.toString());
  console.log("View tx:", `https://scan.bohr.life/tx/${tx.hash}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
