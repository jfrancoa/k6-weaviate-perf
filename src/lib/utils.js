import { uuidv4, randomIntBetween } from 'https://jslib.k6.io/k6-utils/1.4.0/index.js';
import { sleep } from 'k6';
import { defaultConfig } from '../config/default.js';

export function getUniqueCollectionName(prefix = 'Collection') {
    return `${prefix}_VU${__VU}_${uuidv4().split('-')[0]}`;
}

export function generateTenantNames(count, collectionName) {
    return Array.from({ length: count }, (_, i) => `tenant${i + 1}_${collectionName}`);
}

export function randomSleep(config = defaultConfig.timing) {
    const thinkTime = randomIntBetween(config.minThinkTime, config.maxThinkTime);
    console.log(`\nWaiting ${thinkTime} seconds...`);
    sleep(thinkTime);
}

export function createCollectionConfig({
    class: className,
    description = "A collection",
    vectorizer = "none",
    replicationConfig = null,
    multiTenancyConfig = { enabled: false, autoTenantCreation: false }
} = {}) {
    return {
        class: className,
        description,
        vectorizer,
        replicationConfig,
        multiTenancyConfig
    };
}

export function createTenantConfig(name, status = "ACTIVE") {
    return {
        name,
        activityStatus: status
    };
}

// Add this utility function near the top
export function calculateTimeToIngest() {
    const buffer = 10; // 10-second buffer
    
    // Calculate total number of objects to be created
    const totalObjects = defaultConfig.tenant.enabled ? 
        defaultConfig.objects.count * defaultConfig.tenant.count : // multiply by number of tenants
        defaultConfig.objects.count;
    
    // Estimate objects per second based on batch settings and tenant configuration
    const objectsPerSecond = defaultConfig.objects.useBatch ?
        (defaultConfig.objects.batchSize * 0.25) : // 4 seconds per batch set, using concurrent workers
        10; // 10 objects/sec single inserts
    
    const estimatedSeconds = Math.ceil(
        totalObjects / objectsPerSecond
    ) + buffer;
    
    console.log(`Estimated setup time: ${estimatedSeconds}s for ${totalObjects} objects${defaultConfig.tenant.enabled ? ` across ${defaultConfig.tenant.count} tenants` : ''}`);
    
    return `${estimatedSeconds}s`;
}