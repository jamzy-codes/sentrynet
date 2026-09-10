import { network } from "hardhat";

// $env:BOND_MANAGER_ADDRESS="0x..."; $env:FLAGGER_ADDRESS="0x..."; npx hardhat run scripts/setFlagger.ts --network botTestnet
const BOND_MANAGER_ADDRESS = process.env.BOND_MANAGER_ADDRESS;
const FLAGGER_ADDRESS = process.env.FLAGGER_ADDRESS; // the agent's wallet

async function main() {
  if (!BOND_MANAGER_ADDRESS) throw new Error("Set BOND_MANAGER_ADDRESS env var");
  if (!FLAGGER_ADDRESS) throw new Error("Set FLAGGER_ADDRESS env var");

  const { ethers } = await network.connect({ network: "botTestnet" });

  const [caller] = await ethers.getSigners();
  console.log("Calling setFlagger from account:", caller.address);
  console.log("(this must be the BondManager owner)");

  const bondManager = await ethers.getContractAt("BondManager", BOND_MANAGER_ADDRESS);

  const tx = await bondManager.setFlagger(FLAGGER_ADDRESS, true);
  console.log("Tx sent:", tx.hash);
  await tx.wait();

  console.log(`Flagger authorized: ${FLAGGER_ADDRESS} can now call flagPendingSlash().`);
  console.log("View tx:", `https://scan.bohr.life/tx/${tx.hash}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
