import { network } from "hardhat";

async function main() {
  const { ethers } = await network.connect({ network: "botTestnet" });

  const [deployer] = await ethers.getSigners();
  console.log("Deploying with account:", deployer.address);

  const balance = await ethers.provider.getBalance(deployer.address);
  console.log("Account balance:", ethers.formatEther(balance), "BOT");

  const NodeRegistry = await ethers.getContractFactory("NodeRegistry");
  const registry = await NodeRegistry.deploy();
  await registry.waitForDeployment();

  const address = await registry.getAddress();
  console.log("NodeRegistry deployed to:", address);
  console.log("View on explorer:", `https://scan.bohr.life/address/${address}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});