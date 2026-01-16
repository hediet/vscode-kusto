import {
    KustoLanguageService,
    KustoSchema,
    createKustoLanguageService,
} from '../language/kusto/kustoLanguageService';

/**
 * Cache key for a cluster+database pair.
 */
function cacheKey(cluster: string, database: string): string {
    return `${cluster.toLowerCase()}|${database.toLowerCase()}`;
}

/**
 * Caches KustoLanguageService instances per cluster+database.
 * Each service has the schema baked in for completions.
 */
export class LanguageServiceCache {
    private readonly cache = new Map<string, KustoLanguageService>();
    private readonly pending = new Map<string, Promise<KustoLanguageService>>();
    private readonly defaultService: KustoLanguageService;

    constructor() {
        // Default service without schema (for when no connection is configured)
        this.defaultService = createKustoLanguageService();
    }

    /**
     * Get a language service for a cluster+database.
     * Returns immediately with cached service, or default if fetching.
     */
    get(cluster: string, database: string): KustoLanguageService {
        const key = cacheKey(cluster, database);
        return this.cache.get(key) ?? this.defaultService;
    }

    /**
     * Get the default (schema-less) language service.
     */
    getDefault(): KustoLanguageService {
        return this.defaultService;
    }

    /**
     * Check if schema is cached for a cluster+database.
     */
    has(cluster: string, database: string): boolean {
        return this.cache.has(cacheKey(cluster, database));
    }

    /**
     * Get or create a language service for a cluster+database.
     * If not cached, fetches schema using the provided function.
     * Returns pending promise to avoid duplicate fetches.
     */
    async getOrCreate(
        cluster: string,
        database: string,
        fetchSchema: () => Promise<KustoSchema>
    ): Promise<KustoLanguageService> {
        const key = cacheKey(cluster, database);

        // Return cached service
        const cached = this.cache.get(key);
        if (cached) {
            return cached;
        }

        // Return pending fetch - don't start another one
        const pending = this.pending.get(key);
        if (pending) {
            return pending;
        }

        // Start new fetch
        const promise = (async () => {
            try {
                const schema = await fetchSchema();
                const service = createKustoLanguageService(schema);
                this.cache.set(key, service);
                return service;
            } finally {
                this.pending.delete(key);
            }
        })();

        this.pending.set(key, promise);
        return promise;
    }

    /**
     * Manually set a cached service (useful for testing or preloading).
     */
    set(cluster: string, database: string, service: KustoLanguageService): void {
        this.cache.set(cacheKey(cluster, database), service);
    }

    /**
     * Set from schema directly.
     */
    setFromSchema(schema: KustoSchema): KustoLanguageService {
        const service = createKustoLanguageService(schema);
        this.cache.set(cacheKey(schema.cluster, schema.database), service);
        return service;
    }

    /**
     * Invalidate cached service for a cluster (optionally specific database).
     */
    invalidate(cluster: string, database?: string): void {
        if (database) {
            this.cache.delete(cacheKey(cluster, database));
        } else {
            // Invalidate all databases for this cluster
            const prefix = cluster.toLowerCase() + '|';
            for (const key of this.cache.keys()) {
                if (key.startsWith(prefix)) {
                    this.cache.delete(key);
                }
            }
        }
    }

    /**
     * Clear all cached services.
     */
    clear(): void {
        this.cache.clear();
        this.pending.clear();
    }
}

/**
 * Singleton cache instance.
 */
let _languageServiceCache: LanguageServiceCache | undefined;

export function getLanguageServiceCache(): LanguageServiceCache {
    if (!_languageServiceCache) {
        _languageServiceCache = new LanguageServiceCache();
    }
    return _languageServiceCache;
}
