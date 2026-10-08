# Freshdesk Contact Cleanup Utility (BullMQ)

A simple Node.js + Express.js + TypeScript utility using **BullMQ** to permanently hard delete all Freshdesk contacts in the background.

## Prerequisites
- **Node.js** (v18+)
- **Redis Server** running locally or remotely (default: `localhost:6379`)

---

## Setup

1. **Install Dependencies**:
   ```bash
   npm install
   ```

2. **Configure Environment Variables**:
   Update `.env` with your Freshdesk and Redis settings:
   ```env
   PORT=3000
   FRESHDESK_BASE_URL=https://iblfinance-help.freshdesk.com
   FRESHDESK_API_KEY=your_freshdesk_api_key_here

   # Redis Configuration
   REDIS_HOST=localhost
   REDIS_PORT=6379
   REDIS_PASSWORD=
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
**Response:**
```json
{
  "status": "ok",
  "timestamp": "2026-10-08T12:24:00.000Z",
  "service": "freshdesk-contact-cleanup"
}
```

### 2. Trigger Deletion (Background BullMQ Job)
```bash
curl -X POST http://localhost:3000/delete-all-contacts
```
**Response:**
```json
{
  "success": true,
  "message": "Contact cleanup job started in background",
  "jobId": "1",
  "statusUrl": "/job-status/1"
}
```

### 3. Check Job Status
```bash
curl http://localhost:3000/job-status/1
```
**Response:**
```json
{
  "success": true,
  "jobId": "1",
  "state": "completed",
  "progress": 100,
  "result": {
    "totalFound": 11000,
    "deleted": 10998,
    "failed": 2
  },
  "failedReason": null
}
```

---

## How It Works
1. `POST /delete-all-contacts` enqueues a job in BullMQ and immediately returns `202 Accepted` with the `jobId`.
2. The BullMQ background worker processes the job:
   - Fetches contacts in pages of 100 (`GET /api/v2/contacts`).
   - Hard-deletes each contact (`DELETE /api/v2/contacts/:id/hard_delete?force=true`).
   - Updates BullMQ job progress in real-time.
   - Respects rate limits with `429` retry handling.
