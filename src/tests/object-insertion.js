import { sleep } from 'k6';
import { errorRate, durationMetrics } from '../lib/metrics.js';
import { defaultConfig } from '../config/default.js';
import { WeaviateClient } from '../lib/http.js';
import { getUniqueCollectionName, generateTenantNames } from '../lib/utils.js';
import { Collection } from '../lib/models/Collection.js';
import { WeaviateObject } from '../lib/models/WeaviateObject.js';
import { Counter } from 'k6/metrics';

// Create a counter to track collections
const collectionsCounter = new Counter('collections_created');

// Convert duration string (e.g., '1m', '60s') to seconds
function durationToSeconds(duration) {
    const match = duration.match(/^(\d+)([smh])$/);
    if (!match) return 60; // default to 60 seconds if invalid format
    
    const value = parseInt(match[1]);
    const unit = match[2];
    
    switch(unit) {
        case 'h': return value * 3600;
        case 'm': return value * 60;
        case 's': return value;
        default: return 60;
    }
}

// Add some buffer time to ensure cleanup completes
const teardownTime = durationToSeconds(defaultConfig.timing.duration) + 60; // Add 1 minute buffer

export let options = {
    vus: defaultConfig.test.vus,
    duration: defaultConfig.timing.duration,
    thresholds: defaultConfig.thresholds,
    noConnectionReuse: defaultConfig.test.noConnectionReuse,
    discardResponseBodies: false,
    setupTimeout: '1m',
    teardownTimeout: `${teardownTime}s`,  // Use converted seconds plus buffer
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
    let collection = null;

    try {
        // Initialize client
        const client = new WeaviateClient();

        // Generate unique collection name for this VU
        const collectionName = getUniqueCollectionName();
        collectionsCounter.add(1);
        
        console.log(`\nVU ${__VU}: Creating collection ${collectionName}`);

        // Create collection instance with multi-tenancy configuration
        collection = new Collection(
            client, 
            collectionName, 
            defaultConfig.tenant.enabled,
            defaultConfig.tenant.autoCreation
        );

        // Create collection
        success = await collection.create({
            replicationConfig: defaultConfig.collection.replicationFactor > 1 ? {
                factor: defaultConfig.collection.replicationFactor,
                asyncEnabled: defaultConfig.collection.asyncReplication,
                deletionStrategy: "NoAutomatedResolution"
            } : null
        }) && success;

        let tenants = null;
        if (defaultConfig.tenant.enabled) {
            // Generate tenant names and create tenants if multi-tenancy is enabled
            const tenantNames = generateTenantNames(defaultConfig.tenant.count, collectionName);
            tenants = tenantNames.map(name => collection.tenant(name));
            
            if (!defaultConfig.tenant.autoCreation) {
                for (const tenant of tenants) {
                    success = await tenant.create() && success;
                }
            }
        }

        // Create objects
        success = await WeaviateObject.createMany(
            client,
            collection,
            tenants,
            defaultConfig.objects.count,
            defaultConfig.objects.useBatch,
            defaultConfig.objects.batchSize
        ) && success;

        // Calculate total duration for this iteration
        durationMetrics.total.add(new Date() - startTime);

        // Record error rate
        errorRate.add(!success);

    } catch (error) {
        console.error(`VU ${__VU}: Test failed:`, error);
        success = false;
        errorRate.add(true);
    }
}

export async function teardown() {
    // Clean up all collections created during the test
    const client = new WeaviateClient();
    console.log('\nCleaning up collections...');
    
    try {
        // Get all collections from schema
        const response = await client.makeRequest('GET', '/schema');
        if (!response || response.status !== 200) {
            console.error('Failed to get schema:', response ? response.status : 'No response');
            console.error('Response details:', response);
            return;
        }

        let schema;
        try {
            schema = JSON.parse(response.body);
            console.log('Successfully parsed schema response');
        } catch (error) {
            console.error('Failed to parse schema response:', error);
            console.error('Response body:', response.body);
            return;
        }

        if (!schema || !schema.classes) {
            console.error('Invalid schema response format:', schema);
            console.error('Full response:', response);
            return;
        }

        // Filter collections created by this test (they start with Collection_VU)
        const testCollections = schema.classes
            .filter(c => c.class && c.class.startsWith('Collection_VU'))
            .map(c => c.class);

        console.log(`Found ${testCollections.length} collections to clean up`);

        // Delete each collection
        for (const collectionName of testCollections) {
            try {
                const collection = new Collection(client, collectionName);
                await collection.delete();
                console.log(`Deleted collection: ${collectionName}`);
            } catch (error) {
                console.error(`Failed to delete collection ${collectionName}:`, error);
            }
        }
    } catch (error) {
        console.error('Cleanup failed:', error);
        if (error.response) {
            console.error('Response details:', {
                status: error.response.status,
                body: error.response.body,
                headers: error.response.headers
            });
        }
    }

    console.log('Cleanup completed');
} 