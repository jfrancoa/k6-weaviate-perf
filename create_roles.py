import time
import argparse
import weaviate
from weaviate.rbac.models import Permissions
import weaviate.classes as wvc

def main():

    with weaviate.connect_to_local(
        port=8080, grpc_port=50051, auth_credentials=wvc.init.Auth.api_key("admin-key")
    ) as admin_client:
        roles = [
            ("custom-1", [Permissions.cluster(read=True)]),
            ("custom-2", [Permissions.nodes(verbosity="verbose", collection="*", read=True)]),
            ("custom-3", [Permissions.nodes(verbosity="minimal", collection="*", read=True)]),
            ("custom-4", [Permissions.backup(collection="*", manage=True)]),
            ("custom-5", [Permissions.roles(role="*", manage=True)]),
            ("custom-6", [Permissions.roles(role="*", read=True)]),
            ("custom-7", [Permissions.collections(collection="*", create_collection=True)]),
            ("custom-8", [Permissions.collections(collection="*", read_config=True)]),
            ("custom-9", [Permissions.collections(collection="*", update_config=True)]),
            ("custom-10", [Permissions.collections(collection="*", delete_collection=True)]),
            ("custom-11", [Permissions.data(collection="*", create=True)]),
            ("custom-12", [Permissions.data(collection="*", read=True)]),
            ("custom-13", [Permissions.data(collection="*", update=True)]),
            ("custom-14", [Permissions.data(collection="*", delete=True)])
        ]

        
        # Create roles with individual permissions
        for role_name, permissions in roles:
            admin_client.roles.create(
                role_name=role_name,
                permissions=permissions
            )
            time.sleep(1) # Wait for role to be created in all nodes

            # Assign each role to custom-user
            admin_client.roles.assign_to_user(role_names=role_name, user="custom-user")



# End of Selection

if __name__ == "__main__":
    main()