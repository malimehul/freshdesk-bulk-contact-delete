# Freshdesk Contact Cleanup Utility (BullMQ Batched)

A robust Node.js + Express.js + TypeScript utility using **BullMQ** to permanently hard delete all Freshdesk contacts in background batches.

---

## Architecture: Why Batched Processing?

Instead of 1 monolithic job taking 45 minutes and risking 5-minute timeout / stalled worker locks:
1. `POST /delete-all-contacts` enqueues a `START_CLEANUP` job.
2. The worker fetches all contact IDs and automatically creates **small batch jobs (25 contacts per job)**.
3. Each batch job finishes in **~5–8 seconds**.
4. If a rate limit (HTTP 429) or deployment restart happens:
   - Only that specific batch waits for cooldown and resumes.
   - All completed batches remain saved in Redis and are never repeated.
   - Zero lock expiration / stall timeouts.

---

## Setup

1. **Install Dependencies**:
   ```bash
   npm install
   ```

2. **Configure Environment Variables** in `.env`:
   ```env
   PORT=3000
   FRESHDESK_BASE_URL=https://iblfinance-help.freshdesk.com
   FRESHDESK_API_KEY=your_freshdesk_api_key_here
   REDIS_URL=rediss://default:your_password@your-endpoint.upstash.io:6379
   ```

---

## Running the Application

### Development Mode
```bash
npm run dev
```

### Production Mode
```bash
npm run build
npm start
```

---

## API Endpoints

### 1. Health Check
```bash
curl http://localhost:3000/health
```

### 2. Trigger Cleanup
```bash
curl -X POST http://localhost:3000/delete-all-contacts
```
**Response:**
```json
{
  "success": true,
  "message": "Contact cleanup job started in background (batched processing)",
  "jobId": "1",
  "queueStatusUrl": "/queue-status"
}
```

### 3. Check Queue Status (Monitor Progress)
```bash
curl http://localhost:3000/queue-status
```
**Response:**
```json
{
  "success": true,
  "queue": "freshdesk-contact-cleanup",
  "counts": {
    "waiting": 120,
    "active": 1,
    "completed": 45,
    "failed": 0,
    "delayed": 0
  }
}
```

### 4. Clean / Reset Queue (If Needed)
```bash
curl -X POST http://localhost:3000/clean-queue
```
