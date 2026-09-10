// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

// This file exists purely so Hardhat's compiler picks up and compiles
// OpenZeppelin's TimelockController, generating an artifact we can deploy
// via ethers.getContractFactory("TimelockController"). Nothing in this
// project actually calls into this import directly, it's just a compile-time
// hook, not logic we've written ourselves.
import "@openzeppelin/contracts/governance/TimelockController.sol";
