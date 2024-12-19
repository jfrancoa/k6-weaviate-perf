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