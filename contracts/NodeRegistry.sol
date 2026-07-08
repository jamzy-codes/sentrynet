// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

contract NodeRegistry {
    struct Node {
        address owner;
        bool active;
        uint256 registeredAt;
        uint256 lastProofAt;
        uint256 proofCount;
        uint256 totalOutputClaimed;
    }

    mapping(string => Node) public nodes;
    string[] public nodeIds;

    uint256 public constant IMPLAUSIBLE_OUTPUT_THRESHOLD = 100000;

    event NodeRegistered(string nodeId, address indexed owner, uint256 timestamp);
    event NodeDeactivated(string nodeId, uint256 timestamp);
    event NodeReactivated(string nodeId, uint256 timestamp);
    event ProofSubmitted(
        string nodeId,
        address indexed submitter,
        uint256 outputClaimed,
        uint256 timestamp
    );
    event ImplausibleOutputFlag(
        string nodeId,
        uint256 outputClaimed,
        uint256 timestamp
    );
    event ProofFromInactiveNode(
        string nodeId,
        address indexed submitter,
        uint256 timestamp
    );

    modifier onlyNodeOwner(string memory nodeId) {
        require(nodes[nodeId].owner == msg.sender, "Not node owner");
        _;
    }

    function registerNode(string calldata nodeId) external {
        require(nodes[nodeId].owner == address(0), "Node ID already registered");

        nodes[nodeId] = Node({
            owner: msg.sender,
            active: true,
            registeredAt: block.timestamp,
            lastProofAt: 0,
            proofCount: 0,
            totalOutputClaimed: 0
        });
        nodeIds.push(nodeId);

        emit NodeRegistered(nodeId, msg.sender, block.timestamp);
    }

    function submitProof(string calldata nodeId, uint256 outputClaimed)
        external
        onlyNodeOwner(nodeId)
    {
        Node storage node = nodes[nodeId];

        if (!node.active) {
            emit ProofFromInactiveNode(nodeId, msg.sender, block.timestamp);
        }

        node.proofCount += 1;
        node.totalOutputClaimed += outputClaimed;
        node.lastProofAt = block.timestamp;

        emit ProofSubmitted(nodeId, msg.sender, outputClaimed, block.timestamp);

        if (outputClaimed >= IMPLAUSIBLE_OUTPUT_THRESHOLD) {
            emit ImplausibleOutputFlag(nodeId, outputClaimed, block.timestamp);
        }
    }

    function deactivateNode(string calldata nodeId) external onlyNodeOwner(nodeId) {
        require(nodes[nodeId].active, "Node already inactive");
        nodes[nodeId].active = false;
        emit NodeDeactivated(nodeId, block.timestamp);
    }

    function reactivateNode(string calldata nodeId) external onlyNodeOwner(nodeId) {
        require(!nodes[nodeId].active, "Node already active");
        nodes[nodeId].active = true;
        emit NodeReactivated(nodeId, block.timestamp);
    }

    function getNode(string calldata nodeId) external view returns (Node memory) {
        return nodes[nodeId];
    }

    function getNodeCount() external view returns (uint256) {
        return nodeIds.length;
    }
}