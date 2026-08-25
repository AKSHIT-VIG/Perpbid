'use client';

import { useEffect, useMemo, useState } from 'react';
import { useAccount, useConnect, useSwitchChain, useWriteContract } from 'wagmi';
import { base } from 'wagmi/chains';
import { createPublicClient, http, type Address, type Hex } from 'viem';
import { CLIENT_PERPBID, CLIENT_USDC } from '@/lib/constants';
import { ERC20_ABI, PERPBID_WRITE_ABI } from '@/lib/chain';

// ---------- types ----------
type Listing = {
  id: number;
  code: string;
  platform: string;
  url: string;
  description: string;
  amount_cents: number;
  clicks: number;
  last_bid_at: string;
};
type Stats = { listings: number; visitors24h: number; potUsd: number };

// ---------- helpers ----------
const publicClient = createPublicClient({ chain: base, transport: http() });
const fmt = (n: number) => n.toLocaleString();
const centsToUsd = (c: number) => Math.round(c / 100);

async function apiPost<T>(path: string, body: unknown): Promise<T> {
  const r = await fetch(path, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  const j = await r.json();
  if (!r.ok) throw new Error(j.error ?? 'request failed');
  return j;
}

// ---------- page ----------
export default function Page() {
  const [listings, setListings] = useState<Listing[]>([]);
  const [stats, setStats] = useState<Stats>({ listings: 0, visitors24h: 0, potUsd: 0 });
  const [codeInput, setCodeInput] = useState('');
  const [currentBid, setCurrentBid] = useState(32);
  const [status, setStatus] = useState<{ kind: 'error' | 'info' | 'success'; msg: string } | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const { address, isConnected, chainId } = useAccount();
  const { connectAsync, connectors } = useConnect();
  const { switchChainAsync } = useSwitchChain();
  const { writeContractAsync } = useWriteContract();

  // Poll listings + stats
  useEffect(() => {
    let alive = true;
    async function tick() {
      try {
        const [l, s] = await Promise.all([
          fetch('/api/listings').then(r => r.json()),
          fetch('/api/stats').then(r => r.json()),
        ]);
        if (!alive) return;
        setListings(l.listings ?? []);
        setStats(s);
      } catch {}
    }
    tick();
    const i = setInterval(tick, 4000);
    return () => { alive = false; clearInterval(i); };
  }, []);

  const sortedListings = useMemo(
    () => [...listings].sort((a, b) => b.amount_cents - a.amount_cents),
    [listings],
  );

  async function ensureWallet(): Promise<Address> {
    let addr = address as Address | undefined;
    if (!isConnected || !addr) {
      const injected = connectors.find(c => c.type === 'injected') ?? connectors[0];
      const res = await connectAsync({ connector: injected, chainId: base.id });
      addr = res.accounts[0] as Address;
    }
    if (chainId && chainId !== base.id) {
      await switchChainAsync({ chainId: base.id });
    }
    return addr;
  }

  async function submitBid() {
    setStatus(null);
    const raw = codeInput.trim();
    if (!raw) { setStatus({ kind: 'error', msg: 'Enter a referral code or link first.' }); return; }

    // Normalize input → URL + display code + platform
    let url = raw;
    let displayCode = raw;
    let platform = 'Hyperliquid';
    if (/^https?:\/\//i.test(raw)) {
      try {
        const u = new URL(raw);
        displayCode = (u.searchParams.get('ref') || u.pathname.split('/').pop() || u.hostname).slice(0, 24);
        if (u.hostname.includes('gmx')) platform = 'GMX';
        else if (u.hostname.includes('drift')) platform = 'Drift';
        else if (u.hostname.includes('vertex')) platform = 'Vertex';
        else if (u.hostname.includes('hyperliquid')) platform = 'Hyperliquid';
        else platform = u.hostname.replace(/^www\./, '').split('.')[0];
      } catch {}
    } else {
      url = `https://app.hyperliquid.xyz/join/${encodeURIComponent(raw.toUpperCase())}`;
    }

    setSubmitting(true);
    try {
      // 1. Wallet
      setStatus({ kind: 'info', msg: 'Connect your wallet…' });
      const wallet = await ensureWallet();

      // 2. Prepare
      setStatus({ kind: 'info', msg: 'Preparing bid…' });
      const prep = await apiPost<{
        bidId: Hex; listingId: number; contract: Address; usdc: Address; usdcAmount: string;
      }>('/api/bids/prepare', {
        walletAddress: wallet,
        amountCents: currentBid * 100,
        code: displayCode, platform, url,
      });
      const usdcAmount = BigInt(prep.usdcAmount);

      // 3. Approve USDC if needed
      const allowance = await publicClient.readContract({
        address: prep.usdc, abi: ERC20_ABI, functionName: 'allowance',
        args: [wallet, prep.contract],
      });
      if (allowance < usdcAmount) {
        setStatus({ kind: 'info', msg: 'Approving USDC (1/2)…' });
        const approveHash = await writeContractAsync({
          address: prep.usdc, abi: ERC20_ABI, functionName: 'approve',
          args: [prep.contract, usdcAmount],
        });
        await publicClient.waitForTransactionReceipt({ hash: approveHash });
      }

      // 4. Bid
      setStatus({ kind: 'info', msg: 'Sending bid (2/2)…' });
      const txHash = await writeContractAsync({
        address: prep.contract, abi: PERPBID_WRITE_ABI, functionName: 'bid',
        args: [prep.bidId, usdcAmount],
      });

      // 5. Confirm (retry loop — RPC can be slower than us)
      setStatus({ kind: 'info', msg: 'Confirming on-chain…' });
      let confirmed = false;
      for (let i = 0; i < 8 && !confirmed; i++) {
        const r = await fetch('/api/bids/confirm', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ bidId: prep.bidId, txHash }),
        });
        if (r.ok) { confirmed = true; break; }
        await new Promise(res => setTimeout(res, 2000));
      }
      if (!confirmed) throw new Error('Bid sent but backend timed out confirming. Refresh in a minute.');

      setStatus({ kind: 'success', msg: `Bid confirmed — you're on the board.` });
      setCodeInput('');
    } catch (e: any) {
      setStatus({ kind: 'error', msg: e?.shortMessage ?? e?.message ?? 'Something went wrong.' });
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <>
      <header>
        <div className="logo">
          <div className="mark">P</div>perpbid<span className="dim">.lol</span>
        </div>
        <div className="header-right">
          <div className="stat"><span className="dot" /><span><b>{stats.listings}</b> live</span></div>
          <div className="stat"><span className="dot" /><span><b>{fmt(stats.visitors24h)}</b> visitors / 24h</span></div>
          <div className="fullstats">${fmt(stats.potUsd)} pot ↗</div>
          <button
            className={`wallet-btn ${isConnected ? 'connected' : ''}`}
            onClick={() => ensureWallet().catch(() => {})}
          >
            {isConnected && address ? `${address.slice(0, 6)}…${address.slice(-4)}` : 'Connect wallet'}
          </button>
        </div>
      </header>

      <div className="ticker-wrap">
        <div className="ticker">
          {[...sortedListings, ...sortedListings].map((l, i) => (
            <div key={`${l.id}-${i}`} className="tick-item">
              <span className="tick-rank">#{(i % sortedListings.length) + 1}</span>
              <span className="tick-name">{l.code}</span>
              <span className="tick-amt">${centsToUsd(l.amount_cents)}</span>
              <span className="tick-sep">•</span>
            </div>
          ))}
        </div>
      </div>

      <main>
        <div>
          <h1 className="headline">
            <span className="soft">Bigger bid.</span>
            <span className="strong">Better position.</span>
          </h1>
          <p className="sub">
            No votes, no judges, no algorithm. Bid USDC on Base to put your referral code at the top.
            Traders see #1 first — hold it until someone brings a bigger bid.
          </p>

          <div className="bid-card">
            <input
              className="field"
              placeholder="Referral code or full link (Hyperliquid, GMX, Drift, Vertex)"
              value={codeInput}
              onChange={e => setCodeInput(e.target.value)}
              disabled={submitting}
            />
            <div className="stepper">
              <button onClick={() => setCurrentBid(v => Math.max(1, v - 1))} disabled={submitting}>−</button>
              <div className="amount">${currentBid}</div>
              <button onClick={() => setCurrentBid(v => v + 1)} disabled={submitting}>+</button>
            </div>
            <button className="submit" onClick={submitBid} disabled={submitting}>
              {submitting ? 'Working…' : `Bid $${currentBid}`}
            </button>
            {status && <div className={`form-status ${status.kind}`}>{status.msg}</div>}
            <p className="form-note">
              Whole dollars, paid in USDC on Base. Non-refundable. Someone can outbid you at any time —
              your listing stays on the board either way.
            </p>
          </div>
        </div>

        <div>
          <div className="board-header">
            <div className="board-header-left">
              <span className="refresh" onClick={() => fetch('/api/listings').then(r => r.json()).then(d => setListings(d.listings ?? []))}>↻ Refresh</span>
              <span>{sortedListings.length} listings · ${fmt(stats.potUsd)} pot · updated just now</span>
            </div>
          </div>

          {sortedListings.length === 0 ? (
            <div className="empty">No bids yet. Be #1 for $1.</div>
          ) : (
            sortedListings.map((l, i) => (
              <a key={l.id} href={`/go/${l.id}`} className={`listing ${i === 0 ? 'rank1' : ''}`}>
                <div className="rank-badge">#{i + 1}</div>
                <div className="icon">{l.code.slice(0, 1).toUpperCase()}</div>
                <div className="listing-body">
                  <div className="listing-name">
                    {l.code} <span className="platform-tag">{l.platform}</span>
                  </div>
                  <div className="listing-desc">{l.description || 'New listing.'}</div>
                  <div className="listing-meta">
                    <span>{new Date(l.last_bid_at).toLocaleString()}</span>
                    <span className="meta-dot" />
                    <span>{l.clicks} clicks</span>
                  </div>
                </div>
                <div className="listing-amt">${centsToUsd(l.amount_cents)}</div>
              </a>
            ))
          )}
        </div>
      </main>
    </>
  );
}
