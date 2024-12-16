import json
import sys
from typing import Dict, Any
from collections import defaultdict

def process_metrics(file_path: str) -> Dict[str, Dict[str, float]]:
    metrics = defaultdict(lambda: {'values': [], 'tags': defaultdict(set)})
    
    with open(file_path, 'r') as f:
        for line in f:
            try:
                data = json.loads(line.strip())
                if data['type'] == 'Point':
                    metric_name = data['metric']
                    value = data['data']['value']
                    metrics[metric_name]['values'].append(value)
                    
                    # Store tags
                    if 'tags' in data['data']:
                        for tag_key, tag_value in data['data']['tags'].items():
                            metrics[metric_name]['tags'][tag_key].add(str(tag_value))
            except json.JSONDecodeError:
                continue
    
    # Calculate statistics for each metric
    result = {}
    for metric_name, data in metrics.items():
        values = data['values']
        if values:
            result[metric_name] = {
                'avg': sum(values) / len(values),
                'min': min(values),
                'max': max(values),
                'count': len(values),
                'tags': {k: sorted(v) for k, v in data['tags'].items()}
            }
    
    return result

def format_value(value: float) -> str:
    if value >= 1000000:
        return f"{value/1000000:.2f}M"
    elif value >= 1000:
        return f"{value/1000:.2f}K"
    else:
        return f"{value:.2f}"

def compare_metrics(metrics1: Dict[str, Dict], metrics2: Dict[str, Dict], threshold: float = 30.0) -> None:
    all_metrics = sorted(set(metrics1.keys()) | set(metrics2.keys()))
    
    print(f"\nComparing metrics (threshold: {threshold}% difference):")
    print("=" * 100)
    print(f"{'Metric':<40} {'V1':<15} {'V2':<15} {'Diff %':<10} {'Count V1':<10} {'Count V2':<10} {'Status'}")
    print("-" * 100)

    for metric_name in all_metrics:
        m1 = metrics1.get(metric_name, {})
        m2 = metrics2.get(metric_name, {})
        
        if m1 and m2:  # Metric exists in both versions
            v1 = m1['avg']
            v2 = m2['avg']
            count1 = m1['count']
            count2 = m2['count']
            
            if v1 != 0:
                diff_percent = abs((v2 - v1) / v1 * 100)
                status = "⚠️ " if diff_percent > threshold else "✅"
                
                print(f"{metric_name:<40} {format_value(v1):<15} {format_value(v2):<15} "
                      f"{diff_percent:>6.1f}%    {count1:<10} {count2:<10} {status}")

def main():
    metrics1 = process_metrics('k6_results/metrics_v1.json')
    metrics2 = process_metrics('k6_results/metrics_v2.json')
    
    print(f"\nComparing Weaviate versions:")
    print(f"Version 1: {sys.argv[1]} (RBAC={sys.argv[3]}) (Auth={sys.argv[5]})")
    print(f"Version 2: {sys.argv[2]} (RBAC={sys.argv[4]}) (Auth={sys.argv[6]})")
    
    compare_metrics(metrics1, metrics2)
    
    # Print detailed stats for specific metrics of interest
    interesting_metrics = [
        'tenant_deletion_duration',
        'tenant_activation_duration',
        'tenant_deactivation_duration',
        'create_collection_duration',
        'create_object_duration',
        'http_req_duration'
    ]
    
    print("\nDetailed statistics for key metrics:")
    print("=" * 80)
    for metric in interesting_metrics:
        if metric in metrics1 and metric in metrics2:
            print(f"\n{metric}:")
            print(f"  V1: min={format_value(metrics1[metric]['min'])}, "
                  f"avg={format_value(metrics1[metric]['avg'])}, "
                  f"max={format_value(metrics1[metric]['max'])}, "
                  f"count={metrics1[metric]['count']}")
            print(f"  V2: min={format_value(metrics2[metric]['min'])}, "
                  f"avg={format_value(metrics2[metric]['avg'])}, "
                  f"max={format_value(metrics2[metric]['max'])}, "
                  f"count={metrics2[metric]['count']}")

if __name__ == "__main__":
    main()
