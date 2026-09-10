import { network } from "hardhat";
import { createRequire } from "node:module";

// $env:TIMELOCK_ADDRESS="0x..."; $env:BOND_MANAGER_ADDRESS="0x..."; $env:NODE_ID="node-1"; $env:REASON="..."; $env:SALT="0x..."; npx hardhat run scripts/cancelSlash.ts --network botTestnet
const TIMELOCK_ADDRESS = process.env.TIMELOCK_ADDRESS;
const BOND_MANAGER_ADDRESS = process.env.BOND_MANAGER_ADDRESS;
const NODE_ID = process.env.NODE_ID;
const REASON = process.env.REASON;
const SALT = process.env.SALT;

const require = createRequire(import.meta.url);
const timelockArtifact = require("@openzeppelin/contracts/build/contracts/TimelockController.json");

async function main() {
  if (!TIMELOCK_ADDRESS) throw new Error("Set TIMELOCK_ADDRESS env var");
  if (!BOND_MANAGER_ADDRESS) throw new Error("Set BOND_MANAGER_ADDRESS env var");
  if (!NODE_ID) throw new Error("Set NODE_ID env var");
  if (!REASON) throw new Error("Set REASON env var (must exactly match what the agent used)");
  if (!SALT) throw new Error("Set SALT env var (copy it from the agent's [bond] Salt for manual execute log line)");

  const { ethers } = await network.connect({ network: "botTestnet" });
  const [caller] = await ethers.getSigners();
  console.log("Cancelling from account:", caller.address, "(must hold CANCELLER_ROLE)");

  const bondManagerInterface = new ethers.Interface([
    "function slash(string calldata nodeId, string calldata reason) external",
  ]);
  const data = bondManagerInterface.encodeFunctionData("slash", [NODE_ID, REASON]);

  const timelock = new ethers.Contract(TIMELOCK_ADDRESS, timelockArtifact.abi, caller);

  const operationId = await timelock.hashOperation(BOND_MANAGER_ADDRESS, 0, data, ethers.ZeroHash, SALT);
  console.log("Operation id:", operationId);

  const tx = await timelock.cancel(operationId);
  console.log("Tx sent:", tx.hash);
  await tx.wait();

  console.log(`Pending slash cancelled for "${NODE_ID}". Bond was never touched.`);
  console.log("View tx:", `https://scan.bohr.life/tx/${tx.hash}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
