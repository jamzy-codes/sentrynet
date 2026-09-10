import { network } from "hardhat";
import { createRequire } from "node:module";

// $env:TIMELOCK_ADDRESS="0x..."; $env:CANCELLER_ADDRESS="0x..."; npx hardhat run scripts/grantCanceller.ts --network botTestnet
const TIMELOCK_ADDRESS = process.env.TIMELOCK_ADDRESS;
const CANCELLER_ADDRESS = process.env.CANCELLER_ADDRESS;

const require = createRequire(import.meta.url);
const timelockArtifact = require("@openzeppelin/contracts/build/contracts/TimelockController.json");

async function main() {
  if (!TIMELOCK_ADDRESS) throw new Error("Set TIMELOCK_ADDRESS env var");
  if (!CANCELLER_ADDRESS) throw new Error("Set CANCELLER_ADDRESS env var");

  const { ethers } = await network.connect({ network: "botTestnet" });
  const [caller] = await ethers.getSigners();
  console.log("Calling from account:", caller.address, "(must hold admin role on the timelock)");

  const timelock = new ethers.Contract(TIMELOCK_ADDRESS, timelockArtifact.abi, caller);

  const CANCELLER_ROLE = await timelock.CANCELLER_ROLE();
  const tx = await timelock.grantRole(CANCELLER_ROLE, CANCELLER_ADDRESS);
  console.log("Tx sent:", tx.hash);
  await tx.wait();

  console.log(`CANCELLER_ROLE granted to ${CANCELLER_ADDRESS}`);
  console.log("View tx:", `https://scan.bohr.life/tx/${tx.hash}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
