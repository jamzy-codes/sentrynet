import { network } from "hardhat";
import { createRequire } from "node:module";

// $env:MIN_DELAY_HOURS="24"; $env:PROPOSER_ADDRESS="0x..."; npx hardhat run scripts/deployTimelock.ts --network botTestnet
const MIN_DELAY_HOURS = process.env.MIN_DELAY_HOURS || "24";
const PROPOSER_ADDRESS = process.env.PROPOSER_ADDRESS; // the agent's wallet

// Deploy straight from OpenZeppelin's own pre-built artifact (ships with the
// package) instead of relying on Hardhat to generate one for an externally
// imported contract, sidesteps an artifact-generation quirk in this Hardhat
// 3 setup where solc compiles TimelockController fine but no standalone
// artifact file gets written out for it.
const require = createRequire(import.meta.url);
const timelockArtifact = require("@openzeppelin/contracts/build/contracts/TimelockController.json");

async function main() {
  if (!PROPOSER_ADDRESS) throw new Error("Set PROPOSER_ADDRESS env var to the agent's wallet address");

  const { ethers } = await network.connect({ network: "botTestnet" });

  const [deployer] = await ethers.getSigners();
  console.log("Deploying TimelockController with account:", deployer.address);

  const minDelay = Math.round(Number(MIN_DELAY_HOURS) * 60 * 60);
  console.log(`Min delay: ${MIN_DELAY_HOURS}h (${minDelay}s)`);

  const proposers = [PROPOSER_ADDRESS];
  const executors = [ethers.ZeroAddress]; // anyone can execute once ready
  const admin = deployer.address; // temporary, for granting CANCELLER_ROLE next

  const Timelock = new ethers.ContractFactory(
    timelockArtifact.abi,
    timelockArtifact.bytecode,
    deployer
  );
  const timelock = await Timelock.deploy(minDelay, proposers, executors, admin);
  await timelock.waitForDeployment();

  const address = await timelock.getAddress();
  console.log("TimelockController deployed to:", address);
  console.log("View on explorer:", `https://scan.bohr.life/address/${address}`);
  console.log("");
  console.log("Next steps:");
  console.log("1. Grant CANCELLER_ROLE to whoever will hold veto power (you + BOT Chain rep)");
  console.log("2. Call BondManager.setSlasher(timelockAddress) so only this timelock can execute slash()");
  console.log("3. Call BondManager.setFlagger(agentAddress, true) so the agent can still flag pending slashes directly");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});