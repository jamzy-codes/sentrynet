// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

/// @notice Minimal interface for BOT Chain's native StakeHub system contract.
/// Confirmed real on BSC mainnet; not yet confirmed live at this exact address
/// on BOT Chain testnet specifically. Wrapped in try/catch so this never
/// breaks BondManager's core functionality either way.
interface IStakeHub {
    function getValidatorBasicInfo(address operatorAddress)
        external
        view
        returns (uint256 createdTime, bool jailed, uint256 jailUntil);
}

/// @title BondManager
/// @notice Lets node operators post a BOT bond against a nodeId. A trusted
/// "flagger" (the SentryNet agent) can flag a node for a pending slash, which
/// temporarily locks it from withdrawing. The actual slash() call is
/// restricted to a single authorized "slasher" address, intended to be a
/// TimelockController rather than a single private key, so that a slash only
/// executes after a delay window, during which it can be cancelled by an
/// independent canceller role on the timelock. This is a demo-scale bond/slash
/// mechanism, not a replacement for BOT Chain's real validator staking.
contract BondManager {
    address public owner;

    /// @dev Real BOT Chain / BSC-fork StakeHub system contract address.
    address public constant STAKE_HUB = 0x0000000000000000000000000000000000002002;

    uint256 public constant UNBONDING_PERIOD = 3 days;
    uint256 public constant SLASH_PERCENT_BPS = 1000; // 10% per slash, in basis points

    /// @dev How long a node's funds lock once a slash is flagged as pending.
    /// Must comfortably exceed the timelock's own delay window (24-48h) so a
    /// node can't complete unbonding while a slash is still under review.
    uint256 public constant PENDING_SLASH_LOCK = 3 days;

    struct Bond {
        address operator;
        uint256 amount;
        uint256 unbondingAt; // 0 = not requested; otherwise timestamp funds unlock
    }

    // nodeId => Bond
    mapping(string => Bond) public bonds;

    // nodeId => timestamp until which this node is locked due to a pending slash
    mapping(string => uint256) public slashLockUntil;

    // The only address allowed to actually execute slash(). Intended to be
    // a TimelockController contract address, not a personal wallet.
    address public slasher;

    // Addresses allowed to flag a pending slash (lower-trust than slasher;
    // can only lock funds temporarily, cannot move them). Intended for the
    // agent's own wallet.
    mapping(address => bool) public flaggers;

    event BondPosted(string indexed nodeId, address indexed operator, uint256 amount);
    event SlashFlagged(string indexed nodeId, uint256 lockedUntil);
    event BondSlashed(string indexed nodeId, uint256 amount, string reason);
    event UnbondingStarted(string indexed nodeId, uint256 unbondingAt);
    event BondWithdrawn(string indexed nodeId, address indexed operator, uint256 amount);
    event SlasherUpdated(address indexed account);
    event FlaggerUpdated(address indexed account, bool allowed);

    modifier onlyOwner() {
        require(msg.sender == owner, "not owner");
        _;
    }

    modifier onlySlasher() {
        require(msg.sender == slasher, "not authorized slasher");
        _;
    }

    modifier onlyFlagger() {
        require(flaggers[msg.sender], "not authorized flagger");
        _;
    }

    constructor() {
        owner = msg.sender;
    }

    /// @notice Set the single address allowed to call slash(). Intended to be
    /// a TimelockController contract, not a personal wallet. Owner-only.
    function setSlasher(address account) external onlyOwner {
        slasher = account;
        emit SlasherUpdated(account);
    }

    /// @notice Grant or revoke flagging permission (e.g. the SentryNet
    /// agent's wallet). Owner-only.
    function setFlagger(address account, bool allowed) external onlyOwner {
        flaggers[account] = allowed;
        emit FlaggerUpdated(account, allowed);
    }

    /// @notice Post (or top up) a bond for a given nodeId. Only the original
    /// bonder can top up an existing bond for that node.
    function postBond(string calldata nodeId) external payable {
        require(msg.value > 0, "bond must be > 0");
        Bond storage b = bonds[nodeId];
        require(
            b.operator == address(0) || b.operator == msg.sender,
            "node already bonded by a different address"
        );
        b.operator = msg.sender;
        b.amount += msg.value;
        b.unbondingAt = 0; // topping up cancels any pending withdrawal
        emit BondPosted(nodeId, msg.sender, msg.value);
    }

    /// @notice Called by the agent as soon as it proposes a slash to the
    /// timelock, before the delay window even starts. Locks this node's
    /// funds so it can't unbond/withdraw while the slash is under review.
    /// Does NOT move any funds, only blocks withdrawal temporarily.
    function flagPendingSlash(string calldata nodeId) external onlyFlagger {
        uint256 lockedUntil = block.timestamp + PENDING_SLASH_LOCK;
        slashLockUntil[nodeId] = lockedUntil;
        emit SlashFlagged(nodeId, lockedUntil);
    }

    /// @notice Called only by the authorized slasher (the timelock contract,
    /// after its own delay has passed with no cancellation). Cuts a fixed
    /// percentage of the current bond. Slashed funds stay in the contract.
    function slash(string calldata nodeId, string calldata reason) external onlySlasher {
        Bond storage b = bonds[nodeId];
        require(b.amount > 0, "no bond to slash");
        uint256 slashAmount = (b.amount * SLASH_PERCENT_BPS) / 10000;
        b.amount -= slashAmount;
        emit BondSlashed(nodeId, slashAmount, reason);
    }

    /// @notice Start the unbonding clock. Blocked while a slash is pending
    /// (i.e. flagged but not yet past its lock window) so an operator can't
    /// race a legitimate slash by withdrawing first.
    function startUnbonding(string calldata nodeId) external {
        require(block.timestamp >= slashLockUntil[nodeId], "node has a pending slash review");
        Bond storage b = bonds[nodeId];
        require(b.operator == msg.sender, "not bond owner");
        require(b.amount > 0, "no bond");
        b.unbondingAt = block.timestamp + UNBONDING_PERIOD;
        emit UnbondingStarted(nodeId, b.unbondingAt);
    }

    /// @notice Withdraw a bond once the unbonding period has elapsed. Also
    /// blocked if a slash got flagged after unbonding started but before
    /// withdrawal, same protection as startUnbonding.
    function withdrawBond(string calldata nodeId) external {
        require(block.timestamp >= slashLockUntil[nodeId], "node has a pending slash review");
        Bond storage b = bonds[nodeId];
        require(b.operator == msg.sender, "not bond owner");
        require(b.unbondingAt != 0 && block.timestamp >= b.unbondingAt, "unbonding not complete");
        uint256 amount = b.amount;
        require(amount > 0, "nothing to withdraw");

        b.amount = 0;
        b.unbondingAt = 0;
        b.operator = address(0);

        (bool sent, ) = msg.sender.call{value: amount}("");
        require(sent, "transfer failed");
        emit BondWithdrawn(nodeId, msg.sender, amount);
    }

    /// @notice Read-only "trust signal": checks whether an address happens to
    /// also be a real registered BOT Chain validator via the native StakeHub
    /// contract. Purely informational, never reverts even if unreachable.
    function getValidatorTrustSignal(address operatorAddress)
        external
        view
        returns (bool isValidator, bool jailed)
    {
        try IStakeHub(STAKE_HUB).getValidatorBasicInfo(operatorAddress) returns (
            uint256 createdTime,
            bool _jailed,
            uint256 /* jailUntil */
        ) {
            isValidator = createdTime > 0;
            jailed = _jailed;
        } catch {
            isValidator = false;
            jailed = false;
        }
    }

    function getBond(string calldata nodeId)
        external
        view
        returns (address operator, uint256 amount, uint256 unbondingAt)
    {
        Bond storage b = bonds[nodeId];
        return (b.operator, b.amount, b.unbondingAt);
    }

    receive() external payable {
        revert("use postBond(nodeId)");
    }
}
