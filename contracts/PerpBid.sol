// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title PerpBid
/// @notice Accepts USDC bids on Base. Each bid carries an off-chain nonce
///         (`bidId`) so the indexer can match the event to a pending bid row
///         in the database. Funds go straight to `treasury` — the contract
///         holds no balance.
/// @dev USDC on Base: 0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913
///      USDC has 6 decimals. Backend stores cents; on-chain amount = cents * 1e4.
interface IERC20 {
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
}

contract PerpBid {
    address public owner;
    address public treasury;
    IERC20  public immutable usdc;

    event Bid(
        bytes32 indexed bidId,
        address indexed from,
        uint256 amount,
        uint64  timestamp
    );
    event TreasuryUpdated(address newTreasury);
    event OwnerTransferred(address newOwner);

    error NotOwner();
    error ZeroAmount();
    error TransferFailed();
    error ZeroAddress();

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    constructor(address _usdc, address _treasury) {
        if (_usdc == address(0) || _treasury == address(0)) revert ZeroAddress();
        usdc     = IERC20(_usdc);
        treasury = _treasury;
        owner    = msg.sender;
    }

    /// @notice Place a bid. Caller must have approved this contract for `amount` USDC.
    /// @param bidId Off-chain nonce (bytes32) issued by /api/bids/prepare.
    /// @param amount USDC amount (6 decimals — $1 = 1_000_000).
    function bid(bytes32 bidId, uint256 amount) external {
        if (amount == 0) revert ZeroAmount();
        bool ok = usdc.transferFrom(msg.sender, treasury, amount);
        if (!ok) revert TransferFailed();
        emit Bid(bidId, msg.sender, amount, uint64(block.timestamp));
    }

    function setTreasury(address t) external onlyOwner {
        if (t == address(0)) revert ZeroAddress();
        treasury = t;
        emit TreasuryUpdated(t);
    }

    function transferOwnership(address o) external onlyOwner {
        if (o == address(0)) revert ZeroAddress();
        owner = o;
        emit OwnerTransferred(o);
    }
}
