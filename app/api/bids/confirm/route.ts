import { NextResponse } from 'next/server';
import { decodeEventLog, type Hex } from 'viem';
import { supabase } from '@/lib/supabase';
import { chain, BID_ABI } from '@/lib/chain';
import { PERPBID_CONTRACT } from '@/lib/constants';

export const runtime = 'nodejs';
export const maxDuration = 60;

export async function POST(req: Request) {
  const { bidId, txHash } = await req.json().catch(() => ({}));
  if (!bidId || !txHash)
    return NextResponse.json({ error: 'bidId and txHash required' }, { status: 400 });

  const { data: bid } = await supabase
    .from('bids').select('*').eq('bid_id_hex', bidId).maybeSingle();
  if (!bid) return NextResponse.json({ error: 'bid not found' }, { status: 404 });
  if (bid.status === 'confirmed')
    return NextResponse.json({ ok: true, alreadyConfirmed: true, listingId: bid.listing_id });

  const receipt = await chain.waitForTransactionReceipt({
    hash: txHash as Hex,
    timeout: 45_000,
  }).catch(() => null);
  if (!receipt || receipt.status !== 'success')
    return NextResponse.json({ error: 'tx not confirmed or failed' }, { status: 400 });

  let matched = false;
  for (const log of receipt.logs) {
    if (log.address.toLowerCase() !== PERPBID_CONTRACT.toLowerCase()) continue;
    try {
      const decoded = decodeEventLog({ abi: BID_ABI, data: log.data, topics: log.topics });
      if (decoded.eventName !== 'Bid') continue;
      const { bidId: onchainId, from, amount } = decoded.args;
      const expected = BigInt(bid.amount_cents) * 10_000n;
      if (
        onchainId.toLowerCase() === bidId.toLowerCase() &&
        from.toLowerCase() === bid.wallet_address.toLowerCase() &&
        amount === expected
      ) { matched = true; break; }
    } catch {}
  }
  if (!matched)
    return NextResponse.json({ error: 'no matching Bid event in tx' }, { status: 400 });

  const { data: result, error } = await supabase.rpc('confirm_bid', {
    p_bid_id_hex:   bidId,
    p_tx_hash:      txHash,
    p_block_number: Number(receipt.blockNumber),
  });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ ok: true, listingId: bid.listing_id, result });
}
