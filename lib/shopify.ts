const SHOPIFY_API_VERSION = "2026-01";

export class ShopifyClient {
  private shop: string;
  private accessToken: string;

  constructor(shop: string, accessToken: string) {
    this.shop = shop;
    this.accessToken = accessToken;
  }

  async graphql<T = Record<string, unknown>>(
    query: string,
    variables?: Record<string, unknown>
  ): Promise<T> {
    const res = await fetch(
      `https://${this.shop}/admin/api/${SHOPIFY_API_VERSION}/graphql.json`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Shopify-Access-Token": this.accessToken,
        },
        body: JSON.stringify({ query, variables }),
      }
    );

    if (!res.ok) {
      throw new Error(
        `Shopify GraphQL request failed: ${res.status} ${res.statusText}`
      );
    }

    const json = await res.json();

    if (json.errors) {
      throw new ShopifyGraphQLError(json.errors);
    }

    return json.data as T;
  }

  async graphqlWithRetry<T = Record<string, unknown>>(
    query: string,
    variables?: Record<string, unknown>,
    maxRetries = 3
  ): Promise<T> {
    for (let attempt = 0; attempt < maxRetries; attempt++) {
      try {
        return await this.graphql<T>(query, variables);
      } catch (err) {
        const isThrottled =
          err instanceof ShopifyGraphQLError && err.isThrottled();
        const hasRetriesLeft = attempt < maxRetries - 1;

        if (isThrottled && hasRetriesLeft) {
          const backoffMs = Math.pow(2, attempt) * 1000;
          await new Promise((r) => setTimeout(r, backoffMs));
          continue;
        }
        throw err;
      }
    }

    throw new Error("Max retries exhausted");
  }
}

export class ShopifyGraphQLError extends Error {
  public errors: Array<{ message: string; extensions?: Record<string, unknown> }>;

  constructor(
    errors: Array<{ message: string; extensions?: Record<string, unknown> }>
  ) {
    const messages = errors.map((e) => e.message).join("; ");
    super(`Shopify GraphQL errors: ${messages}`);
    this.name = "ShopifyGraphQLError";
    this.errors = errors;
  }

  isThrottled(): boolean {
    return this.errors.some(
      (e) => e.extensions?.code === "THROTTLED" || e.message.includes("THROTTLED")
    );
  }
}
