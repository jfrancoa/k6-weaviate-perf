import { Rate, Trend, Counter } from 'k6/metrics';

// Error rates
export const errorRate = new Rate('errors');

// Duration metrics (in milliseconds)
export const durationMetrics = {
    createCollection: new Trend('create_collection_duration', true),
    deleteCollection: new Trend('delete_collection_duration', true),
    createTenants: new Trend('create_tenants_duration', true),
    createObject: new Trend('create_object_duration', true),
    createBatchObjects: new Trend('create_batch_objects_duration', true),
    deleteBatchObjects: new Trend('delete_batch_objects_duration', true),
    fetchObjects: new Trend('fetch_objects_duration', true),
    tenantDeactivation: new Trend('tenant_deactivation_duration', true),
    tenantActivation: new Trend('tenant_activation_duration', true),
    tenantDeletion: new Trend('tenant_deletion_duration', true),
    tenantOffload: new Trend('tenant_offload_duration', true),
    backup: new Trend('backup_duration', true),
    restore: new Trend('restore_duration', true),
    total: new Trend('total_duration', true)
};

// Operation counters
export const operationCounters = {
    tenantsCreated: new Counter('tenants_created'),
    objectsCreated: new Counter('objects_created'),
    tenantsDeactivated: new Counter('tenants_deactivated'),
    tenantsActivated: new Counter('tenants_activated'),
    tenantsDeleted: new Counter('tenants_deleted'),
    tenantsOffloaded: new Counter('tenants_offloaded'),
    backupsCreated: new Counter('backups_created'),
    restoresPerformed: new Counter('restores_performed')
}; 

// Convert duration string (e.g., '1m', '60s') to seconds
export function durationToSeconds(duration) {
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
