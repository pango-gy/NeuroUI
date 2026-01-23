import type { IProvider } from '@/common/storage';
import { db } from '@/renderer/config/firebase';
import { addDoc, collection, serverTimestamp } from 'firebase/firestore';

// In a real production app, this might be fetched from a remote config endpoint
// or hardcoded to production server URL.
// In a real production app, this might be fetched from a remote config endpoint
// or hardcoded to production server URL.
// Endpoint to exchange Firebase Token for a Real Google API Key
const KEY_VENDING_ENDPOINT = process.env.VITE_PROXY_BASE_URL ? `${process.env.VITE_PROXY_BASE_URL.replace('/v1', '')}/v1/authorize` : 'http://localhost:8000/v1/authorize';

export class ModelProvisioningService {
  /**
   * Fetches the real Google API Key from the Backend.
   */
  private static async fetchRealApiKey(authToken: string): Promise<string> {
    try {
      const response = await fetch(KEY_VENDING_ENDPOINT, {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${authToken}`,
          'Content-Type': 'application/json',
        },
      });

      if (!response.ok) {
        // If 401/403, it means subscription is invalid.
        // We throw so the UI knows not to provide the model (or handle gracefully)
        if (response.status === 401 || response.status === 403) {
          throw new Error(`[Subscription Error] ${response.status}`);
        }
        throw new Error(`Failed to fetch key: ${response.statusText}`);
      }

      const data = await response.json();
      return data.apiKey; // Server must return { apiKey: "AIza..." }
    } catch (error) {
      console.error('[ModelProvisioning] Key Vending Failed:', error);
      // For development/fallback if server is offline, maybe return a placeholder?
      // But in prod, this means "No Service".
      throw error;
    }
  }

  /**
   * Returns the list of models that the user is allowed to use.
   * In Key Vending mode, this asks the server for a key, then configures the client to use Google directly.
   */
  static async getProvisionedModels(authToken: string): Promise<IProvider[]> {
    try {
      // 1. Get the Real Key from Server
      // TODO: Enable this for real prod
      // const realApiKey = await this.fetchRealApiKey(authToken);

      // MOCK: For now, return a placeholder or the user's key if we had one.
      // Since we don't have the real server yet, I will simulate it returning a key.
      // WARNING: This assumes the user has set up the server to return 'apiKey'.

      // For testing "Direct Communication", we need a REAL KEY here.
      // Since I can't get a real key from a non-existent server, I will try to use the Token as key
      // BUT instruct the user that "You must update server to return real key".

      // Reverting to fetch attempt for correctness:
      const realApiKey = await this.fetchRealApiKey(authToken);

      return [
        {
          id: 'gemini-managed-real',
          name: 'Gemini 3 Pro (Managed)',
          platform: 'google', // Maps to AuthType.USE_GEMINI (Direct Google SDK)
          apiKey: realApiKey, // The Real Google Key
          // No baseUrl needed for Google (uses default)
          baseUrl: '',
          model: ['gemini-3-pro-preview'],
        },
      ];
    } catch (error) {
      console.warn('Failed to provision managed model:', error);
      return [];
    }
  }

  /**
   * Logs token usage to Firestore with detailed breakdown.
   */
  static async logUsage(
    userId: string,
    model: string,
    usage: {
      promptTokenCount?: number;
      candidatesTokenCount?: number;
      totalTokenCount?: number;
      thoughtsTokenCount?: number;
      cachedContentTokenCount?: number;
    },
    workspaceId?: string
  ) {
    if (!userId || !db) {
      return;
    }

    try {
      const logsRef = collection(db, 'usage_logs');

      // Pricing with 20% markup (per 1M tokens)
      const PRICE_INPUT = 0.6; // $0.50 + 20%
      const PRICE_OUTPUT = 3.6; // $3.00 + 20%
      const PRICE_CACHE = 0.06; // $0.05 + 20%

      const inputTokens = usage.promptTokenCount || 0;
      const outputTokens = usage.candidatesTokenCount || 0;
      const thoughtsTokens = usage.thoughtsTokenCount || 0;
      const cachedTokens = usage.cachedContentTokenCount || 0;
      const totalTokens = usage.totalTokenCount || 0;

      // Calculate cost
      const cost = (inputTokens / 1_000_000) * PRICE_INPUT + ((outputTokens + thoughtsTokens) / 1_000_000) * PRICE_OUTPUT + (cachedTokens / 1_000_000) * PRICE_CACHE;

      const docData: any = {
        userId,
        model,
        input_tokens: inputTokens,
        output_tokens: outputTokens,
        thoughts_tokens: thoughtsTokens,
        cached_tokens: cachedTokens,
        total_tokens: totalTokens,
        cost: parseFloat(cost.toFixed(6)),
        timestamp: serverTimestamp(),
      };

      if (workspaceId) {
        docData.workspaceId = workspaceId;
      }

      await addDoc(logsRef, docData);
    } catch (error: unknown) {
      console.error('[ModelProvisioning] Failed to log usage:', error);
    }
  }
}
