import { durationMetrics } from '../metrics.js';
import { Tenant } from './Tenant.js';
import { WeaviateObject } from './WeaviateObject.js';

export class Collection {
    constructor(name, isMultiTenant = true, autoTenantCreation = false, autoTenantActivation = false) {
        this.name = name;
        this.isMultiTenant = isMultiTenant;
        this.autoTenantCreation = autoTenantCreation;
        this.autoTenantActivation = autoTenantActivation;
    }

    static async create(client, collection, {
        description = "A collection",
        vectorizer = "none",
        replicationConfig = null
    } = {}) {
        const startTime = new Date();
        
        const formattedReplicationConfig = replicationConfig ? {
            factor: replicationConfig.factor || 1,
            asyncEnabled: replicationConfig.asyncEnabled !== undefined ? replicationConfig.asyncEnabled : false,
            deletionStrategy: replicationConfig.deletionStrategy || "NoAutomatedResolution"
        } : null;

        // Add vector index configuration for "none" vectorizer
        const config = {
            "description": description,
            "vectorizer": vectorizer,
            "replicationConfig": formattedReplicationConfig,
            "multiTenancy": collection.isMultiTenant
                ? { 
                    enabled: true, 
                    autoTenantCreation: collection.autoTenantCreation, 
                    autoTenantActivation: collection.autoTenantActivation 
                  }
                : { enabled: false }
        };

        try {
            await client.createCollection(collection.name, config);
        } catch (error) {
            console.error("Collection creation failed:", {
                error: error.message,
                config: config  // Log the full config for debugging
            });
            throw error;
        }
        durationMetrics.createCollection.add(new Date() - startTime);
        return true; // Fixed missing return value
    }

    static async delete(client, collection) {
        const startTime = new Date();
        let success = false;
        
        try {
            await client.deleteCollection(collection.name);
            success = true;
        } catch (error) {
            console.error("Collection deletion failed", error.message);
            success = false;
        }
        
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