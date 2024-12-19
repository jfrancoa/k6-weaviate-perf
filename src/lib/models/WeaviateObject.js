import { durationMetrics } from '../metrics.js';

export class WeaviateObject {
    constructor(client, collection, tenant = null) {
        this.client = client;
        this.collection = collection;
        this.tenant = tenant;
    }

    // Generate a random vector of specified dimensions
    static generateRandomVector(dimensions = 1536) {
        return Array.from({ length: dimensions }, () => Math.random() * 2 - 1);
    }

    async create(properties = {}, vector = null) {
        const startTime = new Date();

        const objectData = {
            class: this.collection.name,
            properties,
            vector: vector || WeaviateObject.generateRandomVector()
        };

        // Add tenant to object body if we're in a multi-tenant collection
        if (this.tenant) {
            objectData.tenant = this.tenant.name;
        }
        
        const response = await this.client.makeRequest('POST', '/objects', objectData);
        const success = this.client.detailedCheck(response, 'object created successfully', 'Create Object');
        
        durationMetrics.createObject.add(new Date() - startTime);
        return success;
    }

    static async createMany(client, collection, tenants = null, count = 1, useBatch = false, batchSize = 100) {
        if (collection.isMultiTenant && !tenants) {
            throw new Error('Tenants are required for multi-tenant collections');
        }

        const objects = [];
        for (let i = 0; i < count; i++) {
            const properties = {
                testId: `test-${i}`,
                timestamp: new Date().toISOString()
            };

            const objectData = {
                properties,
                vector: this.generateRandomVector()
            };

            if (collection.isMultiTenant) {
                // For multi-tenant collections, distribute objects across tenants
                const tenant = tenants[i % tenants.length];
                objectData.tenant = tenant.name;
            }

            objects.push(objectData);
        }

        let success = true;
        if (useBatch) {
            // Process objects in batches
            for (let i = 0; i < objects.length; i += batchSize) {
                const batch = objects.slice(i, i + batchSize);
                success = await collection.batchObjects(batch) && success;
            }
        } else {
            // Create objects one by one
            for (const obj of objects) {
                const weaviateObj = collection.object(obj.tenant ? { name: obj.tenant } : null);
                success = await weaviateObj.create(obj.properties, obj.vector) && success;
            }
        }

        return success;
    }
} 