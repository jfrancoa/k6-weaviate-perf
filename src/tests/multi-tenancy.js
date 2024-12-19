import { sleep } from 'k6';
import { errorRate, durationMetrics } from '../lib/metrics.js';
import { defaultConfig } from '../config/default.js';
import { WeaviateClient } from '../lib/http.js';
import { getUniqueCollectionName, generateTenantNames, randomSleep } from '../lib/utils.js';
import { Collection } from '../lib/models/Collection.js';
import { Tenant } from '../lib/models/Tenant.js';
import { WeaviateObject } from '../lib/models/WeaviateObject.js';

export let options = {
    vus: defaultConfig.test.vus,
    duration: defaultConfig.timing.duration,
    thresholds: defaultConfig.thresholds,
    noConnectionReuse: defaultConfig.test.noConnectionReuse,
    discardResponseBodies: defaultConfig.test.discardResponseBodies,
    setupTimeout: defaultConfig.test.setupTimeout,
    teardownTimeout: defaultConfig.test.teardownTimeout,
    cloud: {
        distribution: {
            distributionLabel: { loadZone: defaultConfig.test.cloudZone, percent: 100 }
        }
    }
};

export function setup() {
    console.log('\nTest configuration:');
    console.log(`- Virtual Users: ${defaultConfig.test.vus}`);
    console.log(`- Duration: ${defaultConfig.timing.duration}`);
    console.log(`- Multi-tenancy: ${defaultConfig.tenant.enabled}`);
    console.log(`- Objects per VU: ${defaultConfig.objects.count}`);
    console.log(`- Batch mode: ${defaultConfig.objects.useBatch}`);
    console.log(`- Replication factor: ${defaultConfig.collection.replicationFactor}`);
    console.log(`- Async replication: ${defaultConfig.collection.asyncReplication}`);
}

export default async function () {
    let startTime = new Date();
    let success = true;

    // Initialize client
    const client = new WeaviateClient();

    // Generate unique collection name and tenant names for this iteration
    const collectionName = getUniqueCollectionName();
    const tenantNames = generateTenantNames(defaultConfig.tenant.count, collectionName);

    // Create collection instance
    const collection = new Collection(client, collectionName, true, defaultConfig.tenant.autoCreation);

    // Create collection with multi-tenancy enabled
    success = await collection.create({
        replicationConfig: defaultConfig.collection.replicationFactor > 1 ? {
            factor: defaultConfig.collection.replicationFactor,
            asyncEnabled: defaultConfig.collection.asyncReplication,
            deletionStrategy: "NoAutomatedResolution"
        } : null
    }) && success;

    // Create tenant instances
    const tenants = tenantNames.map(name => collection.tenant(name));

    // Create tenants explicitly if autoTenantCreation is false
    if (!defaultConfig.tenant.autoCreation) {
        success = await Tenant.createMany(client, collection, tenantNames) && success;
    }

    // Create objects for each tenant
    success = await WeaviateObject.createMany(
        client,
        collection,
        tenants,
        defaultConfig.objects.count,
        defaultConfig.objects.useBatch,
        defaultConfig.objects.batchSize
    ) && success;

    // Deactivate tenants (HOT to COLD)
    success = await Promise.all(tenants.map(tenant => tenant.deactivate()))
        .then(results => results.every(result => result)) && success;

    // Random sleep between state changes
    randomSleep();

    // Reactivate tenants (COLD to HOT)
    success = await Promise.all(tenants.map(tenant => tenant.activate()))
        .then(results => results.every(result => result)) && success;

    // Optional: Test offloading if configured
    if (defaultConfig.collection.s3OffloadEnabled) {
        // Offload tenants
        success = await Promise.all(tenants.map(tenant => tenant.offload()))
            .then(results => results.every(result => result)) && success;
        
        randomSleep();
        
        // Reactivate from offloaded state
        success = await Promise.all(tenants.map(tenant => tenant.activate()))
            .then(results => results.every(result => result)) && success;
    }

    // Delete tenants
    success = await Promise.all(tenants.map(tenant => tenant.delete()))
        .then(results => results.every(result => result)) && success;

    // Clean up - delete the collection
    success = await collection.delete() && success;

    // Calculate total duration
    durationMetrics.total.add(new Date() - startTime);

    // Record error rate
    errorRate.add(!success);
    
    sleep(1); // Small delay between iterations
} 