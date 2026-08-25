import { NextResponse } from 'next/server';
import { randomBytes } from 'node:crypto';
import { supabase } from '@/lib/supabase';
import { MIN_BID_CENTS, MAX_BID_CENTS, USDC_BASE, PERPBID_CONTRACT } from '@/lib/constants';
import { base } from 'viem/chains';

export const runtime = 'nodejs';

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const { walletAddress, amountCents, listingId, code, platform, url, description } = body;

  if (!walletAddress || !/^0x[0-9a-fA-F]{40}$/.test(walletAddress))
    return NextResponse.json({ error: 'invalid walletAddress' }, { status: 400 });

  if (!Number.isInteger(amountCents) || amountCents < MIN_BID_CENTS || amountCents > MAX_BID_CENTS)
    return NextResponse.json(
      { error: `amountCents must be integer between ${MIN_BID_CENTS} and ${MAX_BID_CENTS}` },
      { status: 400 },
    );

  let targetListingId: number | undefined = listingId;

  if (targetListingId) {
    const { data: existing } = await supabase
      .from('listings').select('id').eq('id', targetListingId).maybeSingle();
    if (!existing) return NextResponse.json({ error: 'listing not found' }, { status: 404 });
  } else {
    if (!code || !url)
      return NextResponse.json({ error: 'code and url required for new listing' }, { status: 400 });
    try { new URL(url); }
    catch { return NextResponse.json({ error: 'invalid url' }, { status: 400 }); }

    const { data: created, error } = await supabase.from('listings').insert({
      code:        String(code).slice(0, 40),
      platform:    String(platform ?? 'Hyperliquid').slice(0, 24),
      url:         String(url).slice(0, 2000),
      description: String(description ?? '').slice(0, 200),
      amount_cents: 0,
      active:      false,
    }).select('id').single();

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    targetListingId = created.id;
  }

  const bidIdHex = '0x' + randomBytes(32).toString('hex');
  const { error: bidErr } = await supabase.from('bids').insert({
    listing_id:     targetListingId,
    wallet_address: walletAddress.toLowerCase(),
    amount_cents:   amountCents,
    bid_id_hex:     bidIdHex,
    status:         'pending',
  });
  if (bidErr) return NextResponse.json({ error: bidErr.message }, { status: 500 });

  return NextResponse.json({
    bidId:      bidIdHex,
    listingId:  targetListingId,
    contract:   PERPBID_CONTRACT,
    usdc:       USDC_BASE,
    usdcAmount: (BigInt(amountCents) * 10_000n).toString(),
    chainId:    base.id,
  });
}
