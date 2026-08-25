import { NextResponse, type NextRequest } from 'next/server';
import { keccak256, toHex } from 'viem';
import { supabase } from '@/lib/supabase';

export const runtime = 'nodejs';

export async function GET(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id: idParam } = await ctx.params;
  const id = Number(idParam);
  if (!Number.isInteger(id)) return new NextResponse('bad id', { status: 400 });

  const { data: listing } = await supabase
    .from('listings').select('url, active').eq('id', id).maybeSingle();
  if (!listing || !listing.active) return new NextResponse('not found', { status: 404 });

  const ip =
    req.headers.get('cf-connecting-ip') ??
    req.headers.get('x-forwarded-for')?.split(',')[0].trim() ??
    'unknown';
  const ipHash = keccak256(toHex(ip + (process.env.IP_SALT ?? ''))).slice(0, 18);

  // Fire and forget so the redirect isn't blocked by the DB round-trip
  supabase.rpc('log_click_and_bump', {
    p_listing_id: id,
    p_ip_hash:    ipHash,
    p_user_agent: req.headers.get('user-agent') ?? '',
  });

  let outbound: string;
  try {
    const u = new URL(listing.url);
    u.searchParams.set('utm_source', 'perpbid');
    outbound = u.toString();
  } catch { outbound = listing.url; }

  return NextResponse.redirect(outbound, 302);
}
