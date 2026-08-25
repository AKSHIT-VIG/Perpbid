import { NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  const { data, error } = await supabase
    .from('listings')
    .select('id, code, platform, url, description, amount_cents, clicks, last_bid_at')
    .eq('active', true)
    .order('amount_cents', { ascending: false })
    .order('last_bid_at', { ascending: true })
    .limit(200);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ listings: data ?? [] });
}
