import { durationMetrics } from '../metrics.js';

export class WeaviateObject {
    // Generate a random vector of specified dimensions
    static generateRandomVector(dimensions = 1536) {
        return Array.from({ length: dimensions }, () => Math.random() * 2 - 1);
    }

    static async create(client, collection, tenant = null, properties = {}, vector = null) {
        const startTime = new Date();

        const objectData = {
            class: collection.name,
            properties,
            vector: vector || WeaviateObject.generateRandomVector()
        };

        // Add tenant to object body if we're in a multi-tenant collection
        if (collection.isMultiTenant && tenant) {
            objectData.tenant = tenant;
        }
        
        const response = await client.makeRequest('POST', '/objects', objectData);
        const success = client.detailedCheck(response, 'object created successfully', 'Create Object');
        
        durationMetrics.createObject.add(new Date() - startTime);
        return success;
    }

    // Batch object creation
    static async batchObjects(client, collection, objects) {
        const startTime = new Date();
        
        const response = await client.makeRequest('POST', '/batch/objects', {
            objects: objects.map(obj => ({
                class: collection.name,
                properties: obj.properties,
                ...(obj.tenant && { tenant: obj.tenant })
            }))
        });
        
        const success = client.detailedCheck(response, 
            'batch objects created successfully', 
            'Create Objects Batch'
        );

        durationMetrics.createBatchObjects.add(new Date() - startTime);
        return success;
    }

    static async createMany(client, collection, tenants = null, count = 1, useBatch = false, batchSize = 100) {
        const startTime = new Date();
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
                class: collection.name,
                properties,
                vector: this.generateRandomVector()
            };

            if (collection.isMultiTenant && tenants) {
                // For multi-tenant collections, distribute objects across tenants
                const tenantName = tenants[i % tenants.length];
                objectData.tenant = tenantName;
            }

            objects.push(objectData);
        }

        let success = true;
        if (useBatch) {
            // Process objects in batches
            for (let i = 0; i < objects.length; i += batchSize) {
                const batch = objects.slice(i, i + batchSize);
                success = await this.batchObjects(client, collection, batch) && success;
            }
        } else {
            // Create objects one by one
            for (const obj of objects) {
                success = await this.create(
                    client,
                    collection,
                    obj.tenant,
                    obj.properties,
                    obj.vector
                ) && success;
            }
        }

        // Add metrics
        if (useBatch) {
            durationMetrics.createBatchObjects.add(new Date() - startTime);
        } else {
            durationMetrics.total.add(new Date() - startTime);
        }

        return success;
    }

    static async getObjects(client, collection, tenant = null, count = 100) {
        const startTime = new Date();
        
        try {
            // Build query string with proper encoding
            const params = [
                'class=' + collection.name,
                'limit=' + count
            ];
            
            if (collection.isMultiTenant && tenant) {
                params.push('tenant=' + tenant.name);
            }

            const url = '/objects?' + params.join('&');
            const response = await client.makeRequest('GET', url);
            

            if (!response || response.status !== 200) {
                console.error('Failed to get objects:');
                console.error('- Status:', response?.status);
                console.error('- URL:', response?.request?.url);
                console.error('- Response body:', response?.body);
                return [];
            }

            if (!response.body) {
                console.error('Empty response body received');
                return [];
            }

            try {
                const result = JSON.parse(response.body);

                if (!result) {
                    console.error('Failed to parse response body:', response.body);
                    return [];
                }

                durationMetrics.fetchObjects.add(new Date() - startTime);
                return result.objects || [];
            } catch (parseError) {
                console.error('Failed to parse response:', {
                    error: parseError.message,
                    body: response.body
                });
                return [];
            }

        } catch (error) {
            console.error('Error getting objects:', {
                message: error.message,
                stack: error.stack,
                details: error
            });
            return [];
        }
    }

    static async deleteMany(client, collection, tenant = null, where = null) {
        const startTime = new Date();
        let success = true;
        let totalDeleted = 0;

        try {
            // Handle multi-tenancy check
            if (collection.isMultiTenant && !tenant) {
                throw new Error('Tenant is required for multi-tenant collections');
            }

            // Prepare the base request body
            const requestBody = {
                match: {
                    class: collection.name,
                    ...(tenant && { tenant: tenant.name })  // Add tenant to match if provided
                },
                output: 'minimal',
                dryRun: false
            };

            // Add where filter if provided
            if (where) {
                requestBody.match.where = where;
            }

            // Make the request
            const response = await client.makeRequest('DELETE', '/v1/batch/objects', requestBody);
            
            if (!response || response.status !== 200) {
                console.error('Batch deletion failed:', response);
                success = false;
            } else {
                const result = JSON.parse(response.body);
                totalDeleted = result.results.successful;

                if (result.results.failed > 0) {
                    console.warn(`Warning: ${result.results.failed} objects failed to delete`);
                    success = false;
                }

                console.log(`Deleted ${result.results.successful} objects${tenant ? ` for tenant ${tenant.name}` : ''}`);
            }

        } catch (error) {
            console.error('Error in batch deletion:', error);
            success = false;
        }

        // Add metrics
        durationMetrics.deleteBatchObjects.add(new Date() - startTime);

        return {
            success,
            totalDeleted
        };
    }
} 