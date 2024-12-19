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
        ...(replicationConfig && { replicationConfig }),
        multiTenancyConfig
    };
}

export function createTenantConfig(name, status = "ACTIVE") {
    return {
        name,
        activityStatus: status
    };
}
