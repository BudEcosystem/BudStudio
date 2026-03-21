"""Async Neo4j client for workflow graph storage."""

from typing import Any

from neo4j import AsyncGraphDatabase
from neo4j import AsyncDriver
from neo4j.time import DateTime as Neo4jDateTime

from onyx.utils.logger import setup_logger


def _convert_neo4j_types(value: Any) -> Any:
    """Recursively convert Neo4j-specific types to Python builtins."""
    if isinstance(value, Neo4jDateTime):
        return value.to_native().isoformat() if value else None
    if isinstance(value, dict):
        return {k: _convert_neo4j_types(v) for k, v in value.items()}
    if isinstance(value, list):
        return [_convert_neo4j_types(v) for v in value]
    return value

logger = setup_logger()

_client: "Neo4jClient | None" = None


class Neo4jClient:
    """Async wrapper around the Neo4j Python driver."""

    def __init__(self, uri: str, user: str, password: str) -> None:
        self._driver: AsyncDriver = AsyncGraphDatabase.driver(
            uri, auth=(user, password)
        )
        self._initialized: bool = False

    async def initialize(self) -> None:
        """Create indexes and constraints. Called once on first use."""
        if self._initialized:
            return

        async with self._driver.session() as session:
            # Create uniqueness constraints (also creates indexes)
            constraints: list[str] = [
                "CREATE CONSTRAINT IF NOT EXISTS FOR (w:Workflow) REQUIRE w.id IS UNIQUE",
                "CREATE CONSTRAINT IF NOT EXISTS FOR (e:Execution) REQUIRE e.id IS UNIQUE",
                "CREATE CONSTRAINT IF NOT EXISTS FOR (s:Step) REQUIRE s.id IS UNIQUE",
                "CREATE CONSTRAINT IF NOT EXISTS FOR (rs:RawStep) REQUIRE rs.id IS UNIQUE",
                "CREATE CONSTRAINT IF NOT EXISTS FOR (a:Artifact) REQUIRE a.id IS UNIQUE",
                "CREATE CONSTRAINT IF NOT EXISTS FOR (an:Annotation) REQUIRE an.id IS UNIQUE",
                "CREATE CONSTRAINT IF NOT EXISTS FOR (sv:SkillVersion) REQUIRE sv.id IS UNIQUE",
            ]
            for constraint in constraints:
                await session.run(constraint)

            # Additional indexes for common queries
            # Note: (:Skill)-[:DERIVED_FROM]->(:Workflow) relationships link
            # PostgreSQL Skill records to Neo4j Workflow nodes for evolution tracking.
            indexes: list[str] = [
                "CREATE INDEX IF NOT EXISTS FOR (w:Workflow) ON (w.user_id)",
                "CREATE INDEX IF NOT EXISTS FOR (w:Workflow) ON (w.tenant_id)",
                "CREATE INDEX IF NOT EXISTS FOR (w:Workflow) ON (w.pattern_summary)",
                "CREATE INDEX IF NOT EXISTS FOR (e:Execution) ON (e.agent_session_id)",
                "CREATE INDEX IF NOT EXISTS FOR (s:Step) ON (s.canonical_action)",
                "CREATE INDEX IF NOT EXISTS FOR (rs:RawStep) ON (rs.agent_message_id)",
                "CREATE INDEX IF NOT EXISTS FOR (sv:SkillVersion) ON (sv.skill_id)",
            ]
            for index in indexes:
                await session.run(index)

        self._initialized = True
        logger.info("Neo4j indexes and constraints initialized")

    async def execute_read(
        self, query: str, parameters: dict[str, object] | None = None
    ) -> list[dict[str, Any]]:
        """Execute a read query and return results as list of dicts."""
        await self.initialize()
        async with self._driver.session() as session:
            result = await session.run(query, parameters or {})
            return [_convert_neo4j_types(record.data()) async for record in result]

    async def execute_write(
        self, query: str, parameters: dict[str, object] | None = None
    ) -> list[dict[str, Any]]:
        """Execute a write query and return results as list of dicts."""
        await self.initialize()
        async with self._driver.session() as session:
            result = await session.run(query, parameters or {})
            return [_convert_neo4j_types(record.data()) async for record in result]

    async def execute_write_tx(
        self, queries: list[tuple[str, dict[str, object]]]
    ) -> None:
        """Execute multiple write queries in a single transaction."""
        await self.initialize()
        async with self._driver.session() as session:
            tx = await session.begin_transaction()
            try:
                for query, params in queries:
                    result = await tx.run(query, params)
                    await result.consume()  # must consume before next query
                await tx.commit()
            except Exception:
                await tx.rollback()
                raise

    async def health_check(self) -> bool:
        """Check if Neo4j is reachable."""
        try:
            await self._driver.verify_connectivity()
            return True
        except Exception:
            return False

    async def close(self) -> None:
        """Close the driver connection."""
        await self._driver.close()


async def get_neo4j_client() -> Neo4jClient:
    """Get or create the singleton Neo4j client."""
    global _client
    if _client is None:
        from onyx.workflow.config import NEO4J_PASSWORD
        from onyx.workflow.config import NEO4J_URI
        from onyx.workflow.config import NEO4J_USER

        _client = Neo4jClient(NEO4J_URI, NEO4J_USER, NEO4J_PASSWORD)
    return _client


async def close_neo4j_client() -> None:
    """Close the Neo4j client on shutdown."""
    global _client
    if _client is not None:
        await _client.close()
        _client = None
