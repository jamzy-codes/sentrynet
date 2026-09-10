import { network } from "hardhat";

// $env:BOND_MANAGER_ADDRESS="0x..."; $env:SLASHER_ADDRESS="0x..."; npx hardhat run scripts/setSlasher.ts --network botTestnet
const BOND_MANAGER_ADDRESS = process.env.BOND_MANAGER_ADDRESS;
const SLASHER_ADDRESS = process.env.SLASHER_ADDRESS; // the TimelockController address, not a personal wallet

async function main() {
  if (!BOND_MANAGER_ADDRESS) throw new Error("Set BOND_MANAGER_ADDRESS env var");
  if (!SLASHER_ADDRESS) throw new Error("Set SLASHER_ADDRESS env var (the TimelockController address)");

  const { ethers } = await network.connect({ network: "botTestnet" });

  const [caller] = await ethers.getSigners();
  console.log("Calling setSlasher from account:", caller.address);
  console.log("(this must be the BondManager owner, i.e. whoever deployed it)");

  const bondManager = await ethers.getContractAt("BondManager", BOND_MANAGER_ADDRESS);

  const tx = await bondManager.setSlasher(SLASHER_ADDRESS);
  console.log("Tx sent:", tx.hash);
  await tx.wait();

  console.log(`Slasher set to: ${SLASHER_ADDRESS}`);
  console.log("View tx:", `https://scan.bohr.life/tx/${tx.hash}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});