# perpbid

Pay-to-rank leaderboard for perp trading referral codes. USDC on Base, all revenue to your treasury.

Next.js 15 App Router. Deploys to Vercel in one command. Custom-domain-ready.

## Structure

```
app/
  page.tsx                          — leaderboard UI (React port of the mock)
  layout.tsx, providers.tsx         — wagmi + react-query providers
  globals.css                       — styles
  api/listings/route.ts             — GET board
  api/bids/prepare/route.ts         — POST create pending bid + issue bidId
  api/bids/confirm/route.ts         — POST verify tx event, promote bid
  api/stats/route.ts                — GET header numbers
  go/[id]/route.ts                  — GET redirect + click track (public /go/:id URL)
lib/
  supabase.ts                       — server-only Supabase client (service role)
  chain.ts                          — viem Base client + ABIs
  constants.ts                      — USDC, bid caps
contracts/PerpBid.sol               — 30-line USDC bid contract
db/schema.sql                       — Postgres tables + atomic RPCs
```

## First-time setup (~30 min)

### 1. Deploy the contract to Base
```bash
cd contracts
forge create PerpBid \
  --rpc-url https://mainnet.base.org \
  --private-key $DEPLOYER_KEY \
  --constructor-args \
    0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913 \
    $YOUR_TREASURY_ADDRESS
```
Verify on BaseScan. Copy the deployed address — you need it for env vars.

### 2. Set up Supabase (free tier is fine)
- Create a new project at https://supabase.com
- In the SQL editor, paste and run `db/schema.sql`
- Grab `Project URL` and `service_role` key from Settings → API

### 3. Grab a Base RPC URL
- Alchemy: free tier, 300M compute units/month — plenty
- Or use the public `https://mainnet.base.org` to start, upgrade later

### 4. Deploy to Vercel
```bash
npm i -g vercel        # once
vercel                 # link + first deploy
vercel --prod          # promote to prod
```

In the Vercel dashboard → Project → Settings → Environment Variables, add:
```
SUPABASE_URL                  = https://xxx.supabase.co
SUPABASE_SERVICE_KEY          = eyJ...  (service_role, keep secret)
BASE_RPC_URL                  = https://base-mainnet.g.alchemy.com/v2/xxx
PERPBID_CONTRACT              = 0x...  (from step 1)
IP_SALT                       = <32 random hex bytes, e.g. `openssl rand -hex 32`>
NEXT_PUBLIC_PERPBID_CONTRACT  = 0x...  (same as above; exposed to browser)
NEXT_PUBLIC_USDC_BASE         = 0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913
NEXT_PUBLIC_APP_URL           = https://perpbid.lol  (your custom domain)
```

Redeploy once vars are set: `vercel --prod`.

### 5. Custom domain
In Vercel → Project → Settings → Domains → **Add** → enter e.g. `perpbid.lol`.

Vercel will show one of two DNS setups depending on your registrar:

**Option A — Nameservers (easiest, full delegation):**
Point your domain's nameservers to `ns1.vercel-dns.com` + `ns2.vercel-dns.com`. Vercel handles the rest, including SSL.

**Option B — CNAME/A records (keep DNS at your registrar):**
- For the root (`perpbid.lol`): A record → `76.76.21.21`
- For `www.perpbid.lol`: CNAME → `cname.vercel-dns.com`

SSL auto-provisions in a few minutes. DNS can take up to 24h to propagate globally but usually clears in minutes on Cloudflare / Namecheap / Porkbun.

## Local dev

```bash
cp .env.example .env.local  # fill in the same vars as Vercel
npm install
npm run dev                 # http://localhost:3000
```

For local testing without deploying the contract to mainnet, deploy to Base Sepolia (`https://sepolia.base.org`) and point `PERPBID_CONTRACT` at that. Use Sepolia USDC: `0x036CbD53842c5426634e7929541eC2318f3dCF7e`.

## The bid flow, end-to-end

```
User clicks Bid $32
  1. FE → wagmi: connect wallet + switch to Base if needed
  2. FE → POST /api/bids/prepare  → backend inserts pending bid row,
                                     returns bidId (bytes32 nonce)
  3. FE → USDC.approve(PerpBid, 32_000_000)   (skipped if allowance is enough)
  4. FE → PerpBid.bid(bidId, 32_000_000)      → USDC transfers to treasury,
                                                 event Bid(bidId, from, amount, ts) emitted
  5. FE → POST /api/bids/confirm { bidId, txHash }
     backend fetches the receipt, decodes the Bid event, verifies bidId+from+amount all match,
     then calls confirm_bid RPC → promotes bid to 'confirmed' + bumps listings.amount_cents.
```

## What's deliberately not built (yet)

- **Realtime updates** — frontend polls `/api/listings` every 4s. Fine at MVP scale. Swap for Supabase realtime subscription on the `listings` table when you outgrow it.
- **Rate limiting** — `/api/bids/prepare` accepts unlimited draft listings + pending bids. Add IP-based rate limit (5/min) via Vercel middleware, or require a wallet signature before insert.
- **Pending bid expiry** — a Vercel cron job that runs every 15min, marks bids `status='expired'` if older than 30min and never confirmed, and hard-deletes unconfirmed draft listings. Prevents DB bloat.
- **Admin surface** — no UI for you to edit descriptions, hide spam, or refund. Direct SQL against Supabase is fine to start.

## What's live vs mock

Every number on the page comes from the backend now — no mock data left. If the DB is empty, you get the "No bids yet. Be #1 for $1" empty state. Bid once yourself to seed it.
