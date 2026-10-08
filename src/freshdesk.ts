import axios, { AxiosInstance } from 'axios';

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export class FreshdeskService {
  private client: AxiosInstance;

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
   * Fetches all contact IDs using pagination (per_page = 100)
   */
  async getAllContactIds(): Promise<number[]> {
    const contactIds: number[] = [];
    let page = 1;
    const perPage = 100;

    console.log('🔍 Fetching all contacts from Freshdesk...');

    while (true) {
      try {
        console.log(`📄 Fetching page ${page}...`);
        const response = await this.client.get<{ id: number }[]>('/api/v2/contacts', {
          params: { per_page: perPage, page },
        });

        const contacts = response.data;
        if (!contacts || contacts.length === 0) {
          break;
        }

        const ids = contacts.map((c) => c.id);
        contactIds.push(...ids);
        console.log(`   Fetched ${ids.length} contacts (Total so far: ${contactIds.length})`);

        if (contacts.length < perPage) {
          // No more pages left
          break;
        }

        page++;
        // Small delay between page fetches to avoid rate limits
        await sleep(100);
      } catch (error: any) {
        if (error.response?.status === 429) {
          const retryAfter = Number(error.response.headers['retry-after'] || 5);
          console.warn(`⏳ Rate limited while fetching contacts. Waiting ${retryAfter}s...`);
          await sleep(retryAfter * 1000);
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
    const maxRetries = 3;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        await this.client.delete(`/api/v2/contacts/${contactId}/hard_delete`, {
          params: { force: true },
        });
        return true;
      } catch (error: any) {
        if (error.response?.status === 429) {
          const retryAfter = Number(error.response.headers['retry-after'] || 5);
          console.warn(`⏳ Rate limit reached on contact ${contactId}. Waiting ${retryAfter}s (attempt ${attempt}/${maxRetries})...`);
          await sleep(retryAfter * 1000);
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

    console.log(`🚀 Starting hard deletion of ${totalFound} contacts...`);

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

      // Small delay between deletes to respect Freshdesk API limits
      await sleep(50);
    }

    console.log(`\n🎉 Deletion complete: Total=${totalFound}, Deleted=${deleted}, Failed=${failed}`);
    return { totalFound, deleted, failed };
  }
}
