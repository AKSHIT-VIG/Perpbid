import { createPublicClient, http, parseAbi } from 'viem';
import { base } from 'viem/chains';

export const chain = createPublicClient({
  chain: base,
  transport: http(process.env.BASE_RPC_URL),
});

export const BID_ABI = parseAbi([
  'event Bid(bytes32 indexed bidId, address indexed from, uint256 amount, uint64 timestamp)',
]);

export const PERPBID_WRITE_ABI = parseAbi([
  'function bid(bytes32 bidId, uint256 amount)',
]);

export const ERC20_ABI = parseAbi([
  'function allowance(address owner, address spender) view returns (uint256)',
  'function approve(address spender, uint256 amount) returns (bool)',
]);
