# Freshdesk Contact Cleanup Utility

A simple Node.js + Express.js + TypeScript utility to permanently delete all contacts from a Freshdesk test account.

## Setup

1. **Install Dependencies**:
   ```bash
   npm install
   ```

2. **Configure Environment Variables**:
   Update `.env` with your Freshdesk API key and account domain:
   ```env
   PORT=3000
   FRESHDESK_BASE_URL=your_freshdesk_bussines_url
   FRESHDESK_API_KEY=your_freshdesk_api_key_here
   ```

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

## Health Check

Check if the server is running:
```bash
curl http://localhost:3000/health
```

Response:
```json
{
  "status": "ok",
  "timestamp": "2026-10-08T12:24:00.000Z",
  "service": "freshdesk-contact-cleanup"
}
```

## Trigger Deletion

Make a `POST` request to the cleanup endpoint:

```bash
curl -X POST http://localhost:3000/delete-all-contacts
```

### Response Example:
```json
{
  "success": true,
  "totalFound": 11000,
  "deleted": 10998,
  "failed": 2
}
```

## Features
- **Pagination**: Automatically iterates through all contact pages (`per_page=100`) until all contacts are fetched.
- **Hard Delete**: Calls `DELETE /api/v2/contacts/{id}/hard_delete?force=true`.
- **Rate Limit Resilience**: Handles `429 Too Many Requests` responses using `Retry-After` headers and applies small delays between requests.
- **Live Progress Logging**: Real-time console logs showing `[X/Total]` status for each contact.
- **Fault-Tolerant**: Continues processing remaining contacts even if individual deletions fail.
