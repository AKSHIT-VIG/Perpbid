export const USDC_BASE = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913' as const;

export const MIN_BID_CENTS = 100;         // $1
export const MAX_BID_CENTS = 10_000 * 100; // $10,000 sanity cap

export const PERPBID_CONTRACT = process.env.PERPBID_CONTRACT as `0x${string}`;

// Client-side (exposed at build time)
export const CLIENT_PERPBID = process.env.NEXT_PUBLIC_PERPBID_CONTRACT as `0x${string}`;
export const CLIENT_USDC = process.env.NEXT_PUBLIC_USDC_BASE as `0x${string}`;
