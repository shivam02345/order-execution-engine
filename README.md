# **Order Execution Engine – Market Orders with DEX Routing & WebSocket Updates**

This project implements a **mock Order Execution Engine** that processes **Market Orders**, selects the best price between **Raydium** and **Meteora**, executes the order via a simulated DEX, and streams **real-time updates** to the client via **WebSockets**.

This solution is built as part of **Backend Task 2 – Order Execution Engine** (specification from the provided PDF).

---

## 🚀 **Why I Chose MARKET Orders**
Market orders best demonstrate the **full architecture** required in the assignment:

- immediate execution  
- DEX price comparison  
- full lifecycle streaming via WebSockets  
- queue concurrency, retries & failure handling  

They allow showcasing **all required components** clearly without needing external price or launch triggers.

### 🔧 Extending to Limit & Sniper Orders
- **Limit Orders**: same routing pipeline, but execute only when `currentPrice >= targetPrice`. Worker polls or consumes a price feed.
- **Sniper Orders**: same engine but triggered when token mint appears on-chain or during migration events.

---

# 🧱 **Architecture Overview**

```
Client → POST /api/orders/execute  
       → returns { orderId }  
       → upgrades to WS:  /ws/orders/:orderId  

Fastify HTTP + WS Server  
│  
├── BullMQ Queue (Redis)  
│     ├─ up to 10 concurrent jobs  
│     ├─ exponential backoff  
│     └─ retries ≤ 3  
│  
├── Worker  
│     ├─ pending  
│     ├─ routing  
│     ├─ building  
│     ├─ submitted  
│     ├─ confirmed / failed (with error)  
│  
├── Mock DEX Router  
│     ├─ Raydium quote  
│     ├─ Meteora quote  
│     └─ simulate execution  
│  
└── PostgreSQL (order history)
```

---

# 📡 **Real-Time Order Statuses**

Every order streams the following statuses over WebSocket:

| Status | Meaning |
|--------|---------|
| `pending` | Accepted & queued |
| `routing` | Fetching Raydium & Meteora quotes |
| `building` | Building simulated transaction |
| `submitted` | Simulated tx submitted |
| `confirmed` | Execution succeeded (includes txHash + price) |
| `failed` | Any unexpected failure |

---

# 🔄 **DEX Routing Logic**

The engine fetches mock quotes from:

- **Raydium**: ±2% variance  
- **Meteora**: ±3–5% variance  

Routing selection:

```ts
best = quote.price >= otherQuote.price ? quote : otherQuote
```

Includes logs for transparency:

```
[ROUTER] Raydium=1.01  Meteora=0.98 → Selected Raydium
```

---

# 🧵 **Queue & Retry Behavior (BullMQ)**

- **Concurrency:** 10 jobs  
- **Retry attempts:** 3  
- **Backoff:** Exponential (500ms, 1000ms, 2000ms)  
- **Persists final failure reason**  
- **WS emits `failed`** if all retries exhausted  

This satisfies concurrency + retry requirements from the PDF.

---

# 🗄️ **Database Schema (PostgreSQL)**

Table: `orders`

Includes:

- orderId  
- type  
- tokenIn / tokenOut  
- amount  
- side  
- dex selected  
- executed price  
- txHash  
- error (for failures)  
- timestamps  

---

# 📁 **Project Structure**

```
order-execution-engine/
├── src/
│   ├── index.ts          # Fastify server + WebSockets
│   ├── routes.ts         # HTTP + WS routes
│   ├── queue.ts          # BullMQ queue + worker
│   ├── dexRouter.ts      # Mock DEX router (Raydium/Meteora)
│   ├── events.ts         # EventEmitter for WS broadcasts
│   ├── db.ts             # PostgreSQL helper
│   ├── types.ts          # Order types & interfaces
│
├── package.json
├── tsconfig.json
├── .env
└── README.md
```

---

# ⚙️ **Setup & Installation**

### 1. Clone Repo
```bash
git clone <your-repo-url>
cd order-execution-engine
```

### 2. Install Dependencies
```bash
npm install
```

### 3. Setup `.env`
Create:

```
PORT=3000
REDIS_URL=redis://127.0.0.1:6379
DATABASE_URL=postgres://postgres:postgres@localhost:5432/order_engine_db
```

Adjust credentials to match your system.

### 4. Start Redis
```bash
redis-server
```

### 5. Start PostgreSQL & Create DB + Table
```sql
CREATE DATABASE order_engine_db;

CREATE TABLE IF NOT EXISTS orders (
  id UUID PRIMARY KEY,
  type VARCHAR(20),
  token_in VARCHAR(50),
  token_out VARCHAR(50),
  amount NUMERIC,
  side VARCHAR(10),
  status VARCHAR(20),
  dex VARCHAR(20),
  executed_price NUMERIC,
  tx_hash TEXT,
  error TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
```

### 6. Run the Engine (Dev Mode)
```bash
npm run dev
```

You should see:

```
🚀 Server running at http://localhost:3000
```

---

# 🧪 **How to Test the API**

### 1. Create Order (HTTP)
POST → `http://localhost:3000/api/orders/execute`

Body:
```json
{
  "tokenIn": "SOL",
  "tokenOut": "USDC",
  "amount": 1.5,
  "side": "buy"
}
```

Response:
```json
{
  "orderId": "xxxx-uuid",
  "wsUrl": "/ws/orders/xxxx-uuid"
}
```

### 2. Connect WebSocket  
`ws://localhost:3000/ws/orders/<orderId>`

You will receive:

```
pending → routing → building → submitted → confirmed
```

Or:

```
failed
```

if retries exhausted.

---

# 🧪 **Unit & Integration Tests (≥10 Tests Included)**

Included test coverage:

### **Routing Tests**
✔ Raydium vs Meteora price comparison  
✔ Returned best DEX  
✔ Variance % boundaries

### **Queue Tests**
✔ Job enqueued successfully  
✔ Concurrency behavior  
✔ Retry logic  
✔ Failed job emits proper WS message  

### **WebSocket Tests**
✔ WS connection acknowledged  
✔ Messages stream in correct order  
✔ Client disconnect cleanup  

*(Jest + Supertest included in project repo.)*

---

# 📦 **Postman / Insomnia Collection**

Collection is located at:

```
/postman/OrderEngineCollection.json
```

This includes:

- POST order  
- WebSocket test  
- 3 simultaneous order testing  

---
# 🎥 **Demo Video (Required by PDF)**

🎬 **YouTube Link:**  
[https://youtu.be/<your-video-id>](https://youtu.be/k-3THCyvJGE)

Video shows:


- 3–5 simultaneous orders  
- WebSocket updates  
- Routing logs  
- Queue concurrency  
- Confirmed executions  

---

# 📘 **Design Decisions Summary**

- **Fastify** chosen for native WS and high performance.  
- **BullMQ** chosen for concurrency, retry, and job persistence.  
- **PostgreSQL** for durable order history.  
- **EventEmitter** for WS fan-out per order.  
- **Mock DEX Router** simulates real Solana RPC latency & price variance.  

Architecture is intentionally modular so the DEX layer can be replaced with **real devnet execution** using Raydium & Meteora SDKs.

---

# ✔ **Conclusion**

This project fulfills **100% of the Task 2 requirements**:

- Market order pipeline  
- DEX routing (Raydium + Meteora)  
- WS lifecycle streaming  
- Queue concurrency + retry  
- DB persistence  
- Mock execution with realistic timing  
- Unit tests + Postman collection  
- Deployment-ready  
- Clean, modular, documented 



