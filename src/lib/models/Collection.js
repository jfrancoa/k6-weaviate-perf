import { durationMetrics } from '../metrics.js';
import { createCollectionConfig } from '../utils.js';
import { Tenant } from './Tenant.js';
import { WeaviateObject } from './WeaviateObject.js';

export class Collection {
    constructor(name, isMultiTenant = true, autoTenantCreation = false) {
        this.name = name;
        this.isMultiTenant = isMultiTenant;
        this.autoTenantCreation = autoTenantCreation;
    }

    static async create(client, collection, {
        description = "A collection",
        vectorizer = "none",
        replicationConfig = null
    } = {}) {
        const startTime = new Date();
        
        const formattedReplicationConfig = replicationConfig ? {
            factor: replicationConfig.factor || 1,
            asyncEnabled: replicationConfig.asyncEnabled || false,
            deletionStrategy: replicationConfig.deletionStrategy || "NoAutomatedResolution"
        } : null;

        // Only include multiTenancyConfig if this is a multi-tenant collection
        const config = createCollectionConfig({
            class: collection.name,
            description,
            vectorizer,
            replicationConfig: formattedReplicationConfig,
            multiTenancyConfig: collection.isMultiTenant
                ? { enabled: true, autoTenantCreation: collection.autoTenantCreation }
                : { enabled: false, autoTenantCreation: false }
        });

        const response = await client.makeRequest('POST', '/schema', config);
        const success = client.detailedCheck(response, 'collection created successfully', 'Create Collection');
        
        durationMetrics.createCollection.add(new Date() - startTime);
        return success;
    }

    static async delete(client, collection) {
        const startTime = new Date();
        
        const response = await client.makeRequest('DELETE', `/schema/${collection.name}`);
        const success = client.detailedCheck(response, 'collection deleted successfully', 'Delete Collection');
        
        durationMetrics.deleteCollection.add(new Date() - startTime);
        return success;
    }

    static async backup(client, collection, backupId, include = ["*"]) {
        const startTime = new Date();
        
        const config = {
            id: backupId,
            include
        };
        
        const response = await client.makeRequest('POST', `/backups/${collection.name}`, config);
        const success = client.detailedCheck(response, 'backup created successfully', 'Create Backup');
        
        durationMetrics.backup.add(new Date() - startTime);
        return success;
    }

    static async restore(client, collection, backupId) {
        const startTime = new Date();
        
        const response = await client.makeRequest('POST', `/backups/${collection.name}/${backupId}/restore`);
        const success = client.detailedCheck(response, 'restore completed successfully', 'Restore Backup');
        
        durationMetrics.restore.add(new Date() - startTime);
        return success;
    }

} 