import { NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

  const [{ count: activeListings }, { count: visitors24h }, { data: pot }] = await Promise.all([
    supabase.from('listings').select('*', { count: 'exact', head: true }).eq('active', true),
    supabase.from('clicks').select('*', { count: 'exact', head: true }).gt('created_at', since),
    supabase.from('listings').select('amount_cents').eq('active', true),
  ]);

  const potCents = (pot ?? []).reduce((s, l) => s + (l.amount_cents ?? 0), 0);

  return NextResponse.json({
    listings:    activeListings ?? 0,
    visitors24h: visitors24h ?? 0,
    potCents,
    potUsd:      Math.round(potCents / 100),
  });
}
