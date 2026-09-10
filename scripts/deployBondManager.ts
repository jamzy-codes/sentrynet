import { network } from "hardhat";

async function main() {
  const { ethers } = await network.connect({ network: "botTestnet" });

  const [deployer] = await ethers.getSigners();
  console.log("Deploying BondManager with account:", deployer.address);

  const balance = await ethers.provider.getBalance(deployer.address);
  console.log("Account balance:", ethers.formatEther(balance), "BOT");

  const BondManager = await ethers.getContractFactory("BondManager");
  const bondManager = await BondManager.deploy();
  await bondManager.waitForDeployment();

  const address = await bondManager.getAddress();
  console.log("BondManager deployed to:", address);
  console.log("View on explorer:", `https://scan.bohr.life/address/${address}`);
  console.log("");
  console.log("Next: set your agent as an authorized slasher by running scripts/setSlasher.ts");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});