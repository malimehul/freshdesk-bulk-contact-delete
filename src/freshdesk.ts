import axios, { AxiosInstance, AxiosResponse } from 'axios';

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export class FreshdeskService {
  private client: AxiosInstance;
  private rateLimitResetUntil = 0;
  private delayBetweenRequestsMs = Number(process.env.DELETE_DELAY_MS || 250);

  constructor() {
    const baseURL = process.env.FRESHDESK_BASE_URL || 'https://iblfinance-help.freshdesk.com';
    const apiKey = process.env.FRESHDESK_API_KEY || '';

    if (!apiKey) {
      console.warn('⚠️ WARNING: FRESHDESK_API_KEY is not set in .env');
    }

    const authHeader = `Basic ${Buffer.from(`${apiKey}:X`).toString('base64')}`;

    this.client = axios.create({
      baseURL,
      headers: {
        Authorization: authHeader,
        'Content-Type': 'application/json',
      },
    });
  }

  /**
   * Proactively pauses if we are currently in a rate limit cooldown window
   */
  private async checkRateLimitCooldown(): Promise<void> {
    const now = Date.now();
    if (now < this.rateLimitResetUntil) {
      const waitMs = this.rateLimitResetUntil - now;
      console.log(`⏳ Pausing for ${Math.ceil(waitMs / 1000)}s due to active rate-limit window...`);
      await sleep(waitMs);
      console.log(`▶️ Cooldown finished. Resuming requests.`);
    }
  }

  /**
   * Inspects response headers to anticipate rate limit exhaustion
   */
  private handleRateLimitHeaders(response?: AxiosResponse): void {
    if (!response || !response.headers) return;

    const remaining = response.headers['x-ratelimit-remaining'];
    if (remaining !== undefined && Number(remaining) <= 2) {
      console.warn(`⚠️ Freshdesk rate limit remaining is low (${remaining}). Adding brief pause.`);
      this.rateLimitResetUntil = Date.now() + 3000;
    }
  }

  /**
   * Fetches all contact IDs using pagination (per_page = 100)
   */
  async getAllContactIds(): Promise<number[]> {
    const contactIds: number[] = [];
    let page = 1;
    const perPage = 100;

    console.log('🔍 Fetching all contacts from Freshdesk...');

    while (true) {
      await this.checkRateLimitCooldown();

      try {
        console.log(`📄 Fetching page ${page}...`);
        const response = await this.client.get<{ id: number }[]>('/api/v2/contacts', {
          params: { per_page: perPage, page },
        });

        this.handleRateLimitHeaders(response);

        const contacts = response.data;
        if (!contacts || contacts.length === 0) {
          break;
        }

        const ids = contacts.map((c) => c.id);
        contactIds.push(...ids);
        console.log(`   Fetched ${ids.length} contacts (Total so far: ${contactIds.length})`);

        if (contacts.length < perPage) {
          break;
        }

        page++;
        await sleep(this.delayBetweenRequestsMs);
      } catch (error: any) {
        if (error.response?.status === 429) {
          const retryAfter = Number(error.response.headers['retry-after'] || 30);
          console.warn(`⏳ Rate limit reached on page ${page}. Waiting ${retryAfter}s before retrying...`);
          this.rateLimitResetUntil = Date.now() + (retryAfter + 1) * 1000;
          await sleep((retryAfter + 1) * 1000);
          console.log(`▶️ Rate limit wait over. Retrying page ${page}...`);
          continue;
        }
        console.error(`❌ Error fetching contacts on page ${page}:`, error.response?.data || error.message);
        throw error;
      }
    }

    console.log(`✅ Total contacts fetched: ${contactIds.length}`);
    return contactIds;
  }

  /**
   * Hard deletes a single contact by ID with automatic rate-limit retry
   */
  async hardDeleteContact(contactId: number): Promise<boolean> {
    const maxRetries = 5;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      await this.checkRateLimitCooldown();

      try {
        const response = await this.client.delete(`/api/v2/contacts/${contactId}/hard_delete`, {
          params: { force: true },
        });

        this.handleRateLimitHeaders(response);
        return true;
      } catch (error: any) {
        if (error.response?.status === 429) {
          const retryAfter = Number(error.response.headers['retry-after'] || 30);
          console.warn(`⏳ Rate limit reached on contact ${contactId}. Waiting ${retryAfter}s (attempt ${attempt}/${maxRetries})...`);
          this.rateLimitResetUntil = Date.now() + (retryAfter + 1) * 1000;
          await sleep((retryAfter + 1) * 1000);
          console.log(`▶️ Rate limit wait over. Retrying contact ${contactId}...`);
          continue;
        }

        if (error.response?.status === 404) {
          // Already deleted or not found
          console.warn(`⚠️ Contact ${contactId} not found (already deleted).`);
          return true;
        }

        console.error(`❌ Failed to delete contact ${contactId}:`, error.response?.data || error.message);
        return false;
      }
    }

    return false;
  }

  /**
   * Deletes all given contacts sequentially with progress logging
   */
  async deleteAllContacts(
    onProgress?: (progress: { total: number; current: number; deleted: number; failed: number; percentage: number }) => Promise<void> | void
  ): Promise<{ totalFound: number; deleted: number; failed: number }> {
    const contactIds = await this.getAllContactIds();
    const totalFound = contactIds.length;
    let deleted = 0;
    let failed = 0;

    if (totalFound === 0) {
      console.log('ℹ️ No contacts found to delete.');
      return { totalFound: 0, deleted: 0, failed: 0 };
    }

    console.log(`🚀 Starting hard deletion of ${totalFound} contacts (Pacing delay: ${this.delayBetweenRequestsMs}ms)...`);

    for (let i = 0; i < totalFound; i++) {
      const id = contactIds[i];
      const success = await this.hardDeleteContact(id);

      if (success) {
        deleted++;
        console.log(`[${i + 1}/${totalFound}] ✅ Hard-deleted contact ID: ${id}`);
      } else {
        failed++;
        console.log(`[${i + 1}/${totalFound}] ❌ Failed to delete contact ID: ${id}`);
      }

      if (onProgress && ((i + 1) % 10 === 0 || i + 1 === totalFound)) {
        const percentage = Math.round(((i + 1) / totalFound) * 100);
        await onProgress({
          total: totalFound,
          current: i + 1,
          deleted,
          failed,
          percentage,
        });
      }

      // Safe pacing delay between deletes
      await sleep(this.delayBetweenRequestsMs);
    }

    console.log(`\n🎉 Deletion complete: Total=${totalFound}, Deleted=${deleted}, Failed=${failed}`);
    return { totalFound, deleted, failed };
  }
}
