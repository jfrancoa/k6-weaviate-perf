import { durationMetrics, operationCounters } from '../metrics.js';
import { createTenantConfig } from '../utils.js';
import { WeaviateObject } from './WeaviateObject.js';

export class Tenant {
    constructor(name) {
        this.name = name;
    }

    static async create(client, collectionName, tenantName) {
        const startTime = new Date();
        
        const config = [createTenantConfig(tenantName)];
        try {
            await client.createTenant(collectionName, config);
        } catch (error) {
            console.error("Tenant creation failed", error.message);
            throw error;
        }
        
        durationMetrics.createTenants.add(new Date() - startTime);
        if (success) {
            operationCounters.tenantsCreated.add(1);
        }
        
        return success;
    }

    static async delete(client, collectionName, tenantName) {
        const startTime = new Date();
        try {
            // Pass tenant name as array to match Go extension expectation
            await client.deleteTenant(collectionName, [tenantName]);
            durationMetrics.tenantDeletion.add(new Date() - startTime);
            operationCounters.tenantsDeleted.add(1);
            return true;
        } catch (error) {
            console.error("Tenant deletion failed", error.message);
            return false;
        }
    }

    static async updateStatus(client, collectionName, tenantName, status) {
        const startTime = new Date();
        let success = false;
        
        try {
            const config = [createTenantConfig(tenantName, status)];
            await client.updateTenant(collectionName, config);
            success = true;
        } catch (error) {
            console.error("Tenant update failed", error.message);
            success = false;
        }

        // Update metrics based on status
        switch(status) {
            case 'ACTIVE':
                durationMetrics.tenantActivation.add(new Date() - startTime);
                operationCounters.tenantsActivated.add(success ? 1 : 0);
                break;
            case 'INACTIVE':
                durationMetrics.tenantDeactivation.add(new Date() - startTime);
                operationCounters.tenantsDeactivated.add(success ? 1 : 0);
                break;
            case 'OFFLOADED':
                durationMetrics.tenantOffload.add(new Date() - startTime);
                operationCounters.tenantsOffloaded.add(success ? 1 : 0);
                break;
        }
        
        return success;
    }

    static async activate(client, collectionName, tenantName) {
        return this.updateStatus(client, collectionName, tenantName, 'ACTIVE');
    }

    static async deactivate(client, collectionName, tenantName) {
        return this.updateStatus(client, collectionName, tenantName, 'INACTIVE');
    }

    static async offload(client, collectionName, tenantName) {
        return this.updateStatus(client, collectionName, tenantName, 'OFFLOADED');
    }

    static async createMany(client, collection, tenantNames) {
        const startTime = new Date();
        let success = true;

        try {
            const tenants = tenantNames.map(name => ({
                name: name,
                activityStatus: "ACTIVE"
            }));

            await client.createTenant(collection.name, tenants);
        } catch (error) {
            console.error('Error creating tenants:', error);
            success = false;
        }

        durationMetrics.createTenants.add(new Date() - startTime);
        return success;
    }
} 