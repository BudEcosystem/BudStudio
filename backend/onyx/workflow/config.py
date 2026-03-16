import os

#####
# Neo4j Configs
#####
NEO4J_URI: str = os.environ.get("NEO4J_URI") or "bolt://localhost:7687"
NEO4J_USER: str = os.environ.get("NEO4J_USER") or "neo4j"
NEO4J_PASSWORD: str = os.environ.get("NEO4J_PASSWORD") or "password"
