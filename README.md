# BOT Sentinel

**Autonomous AI security agent for the DePIN layer of BOT Chain.**

BOT Sentinel continuously monitors a DePIN compute-node registry deployed on BOT Chain testnet, detects anomalous node behavior in real time, generates human-readable security reports using Google Gemini, and publishes verifiable evidence — every alert links directly back to the exact on-chain transaction that triggered it.

🔗 **Live App:** https://bot-sentinel.up.railway.app
🔗 **Live API:** https://bot-sentinel-api.up.railway.app/api/identity
🔗 **GitHub:** https://github.com/jamzy-codes/bot-sentinel
🔗 **Contract on Explorer:** https://scan.bohr.life/address/0x170F34cc6EF948eb4e2b56DA643a80596d854Aa3

---

## Why this, why BOT Chain

BOT Chain's core identity is **DePIN + PoS dual mining** — a network of physical/compute infrastructure nodes contributing real work, secured by proof-of-stake. That combination introduces a real, non-trivial security problem: **how do you know a node is telling the truth about the work it claims to have done?**

BOT Sentinel answers that directly. Instead of building a generic EVM tool that happens to run on BOT Chain, it's purpose-built around BOT Chain's actual DePIN thesis — watching a node registry, catching nodes that claim implausible output or that submit proofs after being deactivated, and turning every detection into a transparent, AI-explained, on-chain-verifiable event.

---

## What it does

1. **Watches** a `NodeRegistry` smart contract on BOT Chain testnet for two categories of suspicious activity:
   - **Implausible Output Claims** — a node reports compute output that vastly exceeds a sane threshold
   - **Proofs From Inactive Nodes** — a node that has been deactivated still submits a proof, which should be impossible for a legitimate node
2. **Detects** these events live by polling the chain every 6 seconds (not relying on WebSocket filters, which are unreliable on public RPC endpoints)
3. **Explains** each detection using Google Gemini, generating a clear, professional security report describing what happened and what an operator should check next — with automatic retries and a safe fallback if the AI provider is temporarily unavailable, so no real on-chain anomaly is ever silently dropped
4. **Publishes** everything through a public HTTP API and a live dashboard, where every alert links directly to its transaction on the BOT Chain explorer

---

## Architecture

```
┌─────────────────────┐      ┌──────────────────────┐      ┌────────────────────┐
│   NodeRegistry.sol   │ ───► │   Sentinel Agent      │ ───► │   Sentinel API      │
│  (BOT Chain Testnet) │      │  (Node.js, polling)   │      │  (Express-style,     │
│                      │      │  + Gemini AI reports  │      │   deployed Railway)  │
└─────────────────────┘      └──────────────────────┘      └─────────┬──────────┘
                                                                        │
                                                                        ▼
                                                              ┌────────────────────┐
                                                              │   BOT Sentinel UI   │
                                                              │  (4-page dashboard,  │
                                                              │   deployed Railway)  │
                                                              └────────────────────┘
```

- **Smart contract** (`contracts/NodeRegistry.sol`) — registers nodes, accepts proof submissions, tracks active/inactive state, emits `ImplausibleOutputFlag` and `ProofFromInactiveNode` events on-chain
- **Agent** (`agent/sentinel.js`) — a standalone Node.js process that polls the contract's event logs, calls Gemini to generate a report on each anomaly, and serves the results via a small built-in HTTP API
- **Frontend** (`ui/`) — a 4-page dashboard (Overview, Agent Identity, Live Monitoring, Verification & Proof) that polls the agent's API and renders everything live, with every piece of evidence linking back to the real transaction on-chain

Both the agent and the frontend are deployed as independent services on Railway, each with their own public URL.

---

## Live demo walkthrough

- **Overview** — high-level dashboard: nodes monitored, threats detected, network uptime, and a live feed of the most recent security events
- **Agent Identity** — the agent's own on-chain identity: its address, the contract it watches, the network it's on, all independently verifiable on the explorer
- **Live Monitoring** — a real-time, filterable feed of every detected anomaly, polling every 6 seconds
- **Verification & Proof** — click into any alert to see the full on-chain evidence (transaction hash, node ID, raw details) side-by-side with the AI-generated security report explaining it

---

## Tech stack

| Layer | Technology |
|---|---|
| Smart contract | Solidity 0.8.24, Hardhat 3.9.1 |
| Chain | BOT Chain Testnet (chain ID `968`) |
| Agent | Node.js (ESM), ethers.js v6 |
| AI reporting | Google Gemini (`gemini-2.5-flash`) |
| Frontend | HTML / CSS / vanilla JS, hover-responsive shell UI |
| Deployment | Railway (agent + frontend as separate services) |

---

## Smart contract

**Address:** `0x170F34cc6EF948eb4e2b56DA643a80596d854Aa3`
**Network:** BOT Chain Testnet (chain ID `968`)
**Explorer:** https://scan.bohr.life/address/0x170F34cc6EF948eb4e2b56DA643a80596d854Aa3

Key functions:
- `registerNode(nodeId)` — registers a new compute node
- `submitProof(nodeId, outputClaimed)` — submits a proof of work; triggers `ImplausibleOutputFlag` if `outputClaimed >= 100000`, or `ProofFromInactiveNode` if the node is currently deactivated
- `deactivateNode(nodeId)` / `reactivateNode(nodeId)` — toggles a node's active status
- `getNode(nodeId)` / `getNodeCount()` — read node state

---

## API reference

**Base URL:** `https://bot-sentinel-api.up.railway.app`

### `GET /api/identity`
Returns the agent's own on-chain identity and current status.
```json
{
  "agentName": "BOT Sentinel",
  "agentAddress": "0x51f04E04C46d0aDBB67c3f55dc43f92c73FFF53A",
  "contractAddress": "0x170F34cc6EF948eb4e2b56DA643a80596d854Aa3",
  "network": "BOT Chain Testnet",
  "chainId": 968,
  "startedAt": "2026-07-08T...",
  "nodesMonitored": 1,
  "totalAlertsRaised": 2,
  "explorerAgentUrl": "...",
  "explorerContractUrl": "..."
}
```

### `GET /api/alerts`
Returns every detected anomaly, newest-first, each backed by a real transaction.
```json
[
  {
    "id": "0x...",
    "type": "ImplausibleOutputClaim",
    "severity": "high",
    "nodeId": "node-1",
    "detectedAt": "2026-07-08T...",
    "txHash": "0x...",
    "explorerTxUrl": "https://scan.bohr.life/tx/0x...",
    "details": { "nodeId": "node-1", "outputClaimed": "999999", "threshold": "100000" },
    "report": "SECURITY ALERT: Implausible Output Claim Detected..."
  }
]
```

---

## Running locally

**Prerequisites:** Node.js ≥18, a BOT Chain testnet wallet with a small amount of BOT (for gas), a Gemini API key (free tier from [aistudio.google.com](https://aistudio.google.com)).

```bash
git clone https://github.com/jamzy-codes/bot-sentinel.git
cd bot-sentinel
npm install
```

Create a `.env` file:
```
PRIVATE_KEY=your_wallet_private_key
CONTRACT_ADDRESS=0x170F34cc6EF948eb4e2b56DA643a80596d854Aa3
GEMINI_API_KEY=your_gemini_api_key
```

Run the agent:
```bash
node agent/sentinel.js
```

Run the frontend (in a separate terminal):
```bash
cd ui
npm install
npm start
```

Trigger an anomaly to see it live:
```bash
$env:CONTRACT_ADDRESS="0x170F34cc6EF948eb4e2b56DA643a80596d854Aa3"; $env:NODE_ID="node-1"; $env:OUTPUT_CLAIMED="999999"; npx hardhat run scripts/submitProof.ts --network botTestnet
```

---

## What's next (stretch goals not built for this submission)

- Real validator staking integration once feasible with sufficient BOT balance
- A bond/slash mechanism referencing BOT Chain's live `StakeHubContract`
- Gasless agent transactions via a paymaster sponsor
- Multi-node, multi-registry monitoring at scale

---

## Judging criteria alignment

- **BOT Chain Integration (35%)** — built directly around BOT Chain's DePIN + PoS identity; every alert is a real on-chain event with a real transaction hash, not simulated data
- **Product Completeness (25%)** — full pipeline is live and deployed end-to-end: contract → agent → API → dashboard, all publicly accessible right now
- **Innovation (20%)** — an autonomous AI agent that doesn't just detect anomalies but explains them in plain language, with resilient fallback handling so no real security event is ever lost
- **Presentation (20%)** — a premium, restrained dashboard UI designed to feel like a real product, not a hackathon prototype